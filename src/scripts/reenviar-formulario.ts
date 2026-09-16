// Reenvia ao webhook do formulário as respostas de uma planilha exportada da plataforma do
// formulário — para os leads cujo webhook do n8n NÃO disparou (16/09/2026: 4 leads do form
// Médico Legista de 14–15/09 ficaram sem contato).
//
// Cada linha vira o mesmo payload que o n8n manda ({"pergunta": "resposta"}), então o lead passa
// pelo caminho normal: banco, contato com atributos, conversa, card em "Novo Lead" e abertura.
//
//   bun run src/scripts/reenviar-formulario.ts <planilha.csv> [--telefones 5535997754645,5532...] [--enviar]
//
// Sem --enviar é dry-run: mostra quem seria enviado e não manda nada. Testes (e-mail teste@)
// são ignorados sempre. Leads que JÁ existem no banco são pulados, a não ser que estejam em
// --telefones (aí você está dizendo que sabe o que faz).

import { pool } from "../db/pool.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { buscarContatoPorQuery, buscarConversasDoContato } from "../services/chatwoot.ts";
import { env } from "../config/env.ts";

/** Menos que isto respondido = formulário abandonado no meio; só vai com --incluir-incompletos. */
const MINIMO_CAMPOS = 6;

const COLUNAS_IGNORADAS = new Set(["Pontuação", "Data", "ID", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]);
const WEBHOOK = process.env.WEBHOOK_FORMULARIO_URL ?? "https://wh-chatwoot-stkd.softaxon.tech/webhook/cadastrar-lead-formulario-mentoria";

function lerCsv(texto: string): Array<Record<string, string>> {
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); campo = ""; linha = [];
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas.filter((l) => l.some((v) => v.trim()));
  return resto.map((vals) => Object.fromEntries(cab!.map((c, i) => [c.replace(/^﻿/, ""), vals[i] ?? ""])));
}

const [arquivo, ...flags] = process.argv.slice(2);
if (!arquivo) { console.error("uso: bun run src/scripts/reenviar-formulario.ts <planilha.csv> [--telefones a,b] [--enviar]"); process.exit(1); }
const enviar = flags.includes("--enviar");
const incluirIncompletos = flags.includes("--incluir-incompletos");
const idxTel = flags.indexOf("--telefones");
const somente = idxTel >= 0 ? new Set((flags[idxTel + 1] ?? "").split(",").map((t) => t.replace(/\D/g, "")).filter(Boolean)) : null;

const linhas = lerCsv(await Bun.file(arquivo).text());
const colTel = Object.keys(linhas[0] ?? {}).find((c) => /whatsapp/i.test(c))!;
const colEmail = Object.keys(linhas[0] ?? {}).find((c) => /e-?mail/i.test(c))!;
const colNome = Object.keys(linhas[0] ?? {}).find((c) => /nome completo/i.test(c))!;

const payloadDe = (r: Record<string, string>) =>
  Object.fromEntries(Object.entries(r).filter(([k, v]) => !COLUNAS_IGNORADAS.has(k) && v.trim() !== ""));
const telDe = (r: Record<string, string>) => (r[colTel] ?? "").replace(/\D/g, "");

// Um lead, uma linha: quem preencheu duas vezes (ou errou um dígito e refez) fica só com a
// linha mais completa. Chave = últimos 8 dígitos, que é como o banco também reconhece o telefone.
const porTelefone = new Map<string, Record<string, string>>();
for (const r of linhas) {
  const tel = telDe(r);
  if (!tel || /teste@/i.test(r[colEmail] ?? "")) { console.log(`· pulando (teste/sem telefone): ${r[colNome] ?? "?"}`); continue; }
  const chave = tel.slice(-8);
  // Telefone com 13 dígitos (55 + DDD + 9 dígitos) vale mais que campo a mais: o Luiz Claudio
  // refez o formulário sem o 9 e a linha "mais nova" era a que não chegaria no WhatsApp.
  const pontos = (x: Record<string, string>) => Object.keys(payloadDe(x)).length + (telDe(x).length === 13 ? 100 : 0);
  const atual = porTelefone.get(chave);
  if (!atual || pontos(r) >= pontos(atual)) porTelefone.set(chave, r);
}
if (porTelefone.size < linhas.length) console.log(`(${linhas.length} linhas → ${porTelefone.size} leads distintos)\n`);

let enviados = 0;
const resumo = { enviar: [] as string[], banco: [] as string[], chatwoot: [] as string[], incompletos: [] as string[] };
for (const r of porTelefone.values()) {
  const tel = telDe(r);
  const nome = r[colNome] ?? "?";
  const payload = payloadDe(r);
  if (somente && !somente.has(tel)) continue;
  if (!somente) {
    const { rows } = await pool.query(`SELECT 1 FROM leads_formulario_mentoria WHERE RIGHT(REGEXP_REPLACE(whatsapp, '\\D', '', 'g'), 8) = $1 LIMIT 1`, [tel.slice(-8)]);
    if (rows.length) { console.log(`· já no banco (webhook chegou): ${nome} (${tel})`); resumo.banco.push(nome); continue; }
    // Sem webhook mas COM conversa no Chatwoot = alguém já falou com ele (ou ele chamou). A abertura
    // "vi seu formulário" chegaria no meio de uma conversa que já existe. Fica para tratamento humano.
    const contato = await buscarContatoPorQuery(env.CHATWOOT_ACCOUNT_ID, `+${tel}`).catch(() => null);
    if (contato) {
      const conversas = await buscarConversasDoContato(env.CHATWOOT_ACCOUNT_ID, contato.id).catch(() => []);
      if (conversas.length) { console.log(`· já tem conversa no Chatwoot (${conversas.map((c) => c.id).join(", ")}): ${nome} (${tel})`); resumo.chatwoot.push(`${nome} — conv ${conversas.map((c) => c.id).join(", ")}`); continue; }
    }
  }
  if (Object.keys(payload).length < MINIMO_CAMPOS && !incluirIncompletos) {
    console.log(`· incompleto (${Object.keys(payload).length} campos), pulando: ${nome} (${tel})`); resumo.incompletos.push(nome); continue;
  }
  if (!enviar) { console.log(`→ (dry-run) enviaria: ${nome} (${tel}) — ${Object.keys(payload).length} campos, data ${r["Data"]}`); resumo.enviar.push(nome); continue; }
  const resp = await fetchComTimeout(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), timeout: 30_000 });
  console.log(`✓ ${nome} (${tel}) → ${resp.status} ${(await resp.text()).slice(0, 120)}`);
  enviados++;
  await Bun.sleep(3000); // um por vez: cada envio cria contato, conversa, card e dispara abertura
}
console.log(`\nResumo: ${resumo.enviar.length} a enviar · ${resumo.banco.length} já no banco · ${resumo.chatwoot.length} já com conversa · ${resumo.incompletos.length} incompletos`);
console.log(enviar ? `${enviados} reenviado(s).` : "Dry-run: nada foi enviado. Repita com --enviar para mandar.");
await pool.end();
