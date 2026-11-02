// Convites da Black 2026 para os grupos do WhatsApp: 3 públicos, 3 templates UTILITY (arte + Confirmar /
// Parar mensagens). Quem toca "Confirmar" recebe o link do grupo pelo webhook (CONVITES_EVENTO).
//
//   bun run src/scripts/disparo-convite-black.ts montar <respostas.csv> <matriculados.csv>
//   bun run src/scripts/disparo-convite-black.ts teste <alunos|leads|medicos> <idConversa>
//   bun run src/scripts/disparo-convite-black.ts enviar <alunos|leads|medicos> [--limite N] [--enviar]
//   bun run src/scripts/disparo-convite-black.ts verificar <alunos|leads|medicos>
//
// Públicos (definidos pelo Gusthavo em 02/11/2026):
//   alunos  → planilha "Gestão de Alunos Matriculados" (ativos e vencidos), sem cancelados
//   leads   → preencheram o formulário de aplicação, não são médicos e não são matriculados
//   medicos → preencheram o formulário, formação em medicina (inclui estudantes), não são matriculados
// Cancelado = coluna "Cancelou a Mentoria?" = SIM: não recebe nenhum dos três.
// A etiqueta `mentoria` do Chatwoot NÃO é referência de aluno (muitos matriculados não a têm).
// Um número cai em um público só.

import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { buscarConversa, buscarConversasDoContato, criarContato, criarConversa, listarMensagens } from "../services/chatwoot.ts";
import { salvarMensagemSeNova } from "../db/memoria.ts";
import { pool } from "../db/pool.ts";
import { logger } from "../lib/logger.ts";
import { appendFile } from "node:fs/promises";
import { CONVITES_BLACK } from "../routes/webhook-filtros.ts";

const ACC = env.CHATWOOT_ACCOUNT_ID;
const INBOX = Number(env.CHATWOOT_INBOX_ID);
const BASE = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${ACC}`;
const H = { api_access_token: env.CHATWOOT_API_TOKEN, "content-type": "application/json" };
const SAIDA = "output/disparo-convite-black";

export type Publico = "alunos" | "leads" | "medicos";

interface Alvo {
  nome: string; whatsapp: string; formacao: string | null; aplicou: string | null;
  contato: number | null; telefoneContato: string | null; conv: number | null;
  declarouAluno?: string;
}

// Celular brasileiro aparece com e sem o 9: compara DDD + últimos 8 dígitos.
const chave = (tel: string) => { const d = tel.replace(/\D/g, "").replace(/^55/, ""); return d.slice(0, 2) + d.slice(-8); };
const MEDICO = (f: string) => /m[eé]dic|medicina|mediciba|medicona/i.test(f) && !/veter|biom/i.test(f);

// O Chatwoot devolve 429 em rajada: toda chamada tenta de novo com espera crescente.
async function chamar(url: string, init?: RequestInit): Promise<any> {
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const res = await fetchComTimeout(url, { headers: H, ...init });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`Chatwoot ${res.status}: ${(await res.text()).slice(0, 160)}`);
    await Bun.sleep(2000 * (tentativa + 1));
  }
  throw new Error("Chatwoot: tentativas esgotadas");
}

async function contatosComEtiqueta(etiqueta: string) {
  const todos: Array<{ id: number; name: string; phone_number?: string }> = [];
  for (let page = 1; ; page++) {
    const j = await chamar(`${BASE}/contacts/filter?page=${page}`, {
      method: "POST",
      body: JSON.stringify({ payload: [{ attribute_key: "labels", filter_operator: "equal_to", values: [etiqueta], query_operator: null }] }),
    });
    const p = j.payload ?? [];
    todos.push(...p);
    if (p.length === 0 || todos.length >= (j.meta?.count ?? 0)) break;
  }
  return todos;
}

async function acharContato(tel: string): Promise<{ id: number; phone_number: string } | null> {
  const j = await chamar(`${BASE}/contacts/search?q=${tel.slice(-8)}`);
  const c = (j.payload ?? []).find((x: any) => x.phone_number && chave(x.phone_number) === chave(tel));
  return c ? { id: c.id, phone_number: c.phone_number } : null;
}

async function convDaInbox(contato: number): Promise<number | null> {
  const convs = await buscarConversasDoContato(ACC, contato).catch(() => []);
  return convs.filter((v) => v.inbox_id === INBOX).sort((a, b) => b.id - a.id)[0]?.id ?? null;
}

async function emLotes<T>(itens: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0, feitos = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < itens.length) {
      await fn(itens[i++]!);
      if (++feitos % 200 === 0) console.log(`  … ${feitos}/${itens.length}`);
    }
  }));
}

// CSV do Google Sheets: aspas duplas, vírgulas e quebras de linha dentro das células.
function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ",") { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

async function montar(arquivoCsv: string, arquivoMatriculados: string) {
  // 1. Alunos: planilha de matriculados. A 1ª linha é o cabeçalho de controle ("Data de Hoje"),
  // a 2ª tem os nomes das colunas. Um aluno pode ter várias linhas (renovações): se qualquer
  // uma marca "Cancelou a Mentoria? = SIM", ele é cancelado.
  const mat = parseCsv(await Bun.file(arquivoMatriculados).text());
  const cabM = mat[1]!;
  const colM = (ini: string) => cabM.findIndex((h) => h.trim().startsWith(ini));
  const [mNome, mTel, mCancelou] = [colM("Nome Completo"), colM("Telefone"), colM("Cancelou a Mentoria")];
  if ([mNome, mTel, mCancelou].includes(-1)) throw new Error("planilha de matriculados: colunas não encontradas");
  const chavesAlunos = new Set<string>(), chavesCancelados = new Set<string>();
  const porAluno = new Map<string, { nome: string; tel: string }>();
  let semTelefone = 0;
  for (const l of mat.slice(2)) {
    const tel = (l[mTel] ?? "").replace(/\D/g, "");
    if (tel.length < 10) { if ((l[mNome] ?? "").trim()) semTelefone++; continue; }
    const k = chave(tel);
    chavesAlunos.add(k);
    if ((l[mCancelou] ?? "").trim().toUpperCase() === "SIM") chavesCancelados.add(k);
    porAluno.set(k, { nome: (l[mNome] ?? "").trim(), tel });
  }
  const alunos: Alvo[] = [...porAluno.entries()].filter(([k]) => !chavesCancelados.has(k)).map(([, a]) => ({
    nome: a.nome, whatsapp: a.tel.startsWith("55") ? a.tel : `55${a.tel}`, formacao: null, aplicou: null,
    contato: null, telefoneContato: null, conv: null,
  }));
  console.log(`matriculados: ${porAluno.size} números únicos, ${chavesCancelados.size} cancelados, ${semTelefone} linhas sem telefone`);

  // 2. Formulário de aplicação: o CSV exportado da planilha do Google Forms (desde 04/2025) é
  // bem mais completo que a tabela leads_formulario_mentoria (só desde a migração do n8n).
  // Um registro por número: o mais recente.
  const csv = parseCsv(await Bun.file(arquivoCsv).text());
  const cab = csv[0]!;
  const col = (ini: string) => cab.findIndex((h) => h.startsWith(ini));
  const [cData, cNome, cTel, cForm, cAluno] = [col("Carimbo"), col("Qual é o seu nome"), col("Qual é o seu WhatsApp"), col("Qual é a sua área"), col("Já foi ou é aluno")];
  const dataBr = (s: string) => { const m = s.match(/(\d+)\/(\d+)\/(\d+)\s*(\d+:\d+:\d+)?/); return m ? new Date(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}T${m[4] ?? "00:00:00"}-03:00`) : new Date(0); };
  const porChave = new Map<string, { nome: string; tel: string; formacao: string; aplicou: Date; declarouAluno: string }>();
  let linhas = 0;
  for (const l of csv.slice(1)) {
    const tel = (l[cTel] ?? "").replace(/\D/g, "");
    if (tel.length < 10) continue;
    linhas++;
    const r = { nome: (l[cNome] ?? "").trim(), tel, formacao: (l[cForm] ?? "").trim(), aplicou: dataBr(l[cData] ?? ""), declarouAluno: (l[cAluno] ?? "").trim() };
    const atual = porChave.get(chave(tel));
    if (!atual || r.aplicou >= atual.aplicou) porChave.set(chave(tel), r);
  }
  const formulario = [...porChave.entries()].filter(([k]) => !chavesAlunos.has(k)).map(([, r]) => r);
  console.log(`formulário: ${linhas} respostas, ${porChave.size} números únicos, ${porChave.size - formulario.length} são matriculados (inclui cancelados)`);

  const leads: Alvo[] = [], medicos: Alvo[] = [];
  // Contato e conversa no Chatwoot são resolvidos na hora do envio (acharContato), não aqui.
  for (const r of formulario) {
    const whatsapp = r.tel.startsWith("55") ? r.tel : `55${r.tel}`;
    const alvo: Alvo = {
      nome: r.nome, whatsapp, formacao: r.formacao, aplicou: r.aplicou.toISOString(),
      contato: null, telefoneContato: null, conv: null, declarouAluno: r.declarouAluno,
    };
    (MEDICO(r.formacao ?? "") ? medicos : leads).push(alvo);
  }

  const gerado = new Date().toISOString();
  for (const [publico, alvos] of [["alunos", alunos], ["leads", leads], ["medicos", medicos]] as const) {
    await Bun.write(`${SAIDA}-${publico}.json`, JSON.stringify({ gerado, publico, alvos }, null, 1));
    const semTelefone = alvos.filter((a) => !a.whatsapp).length;
    const declarados = alvos.filter((a) => /já sou aluno|^sim/i.test(a.declarouAluno ?? "")).length;
    console.log(`${publico.padEnd(8)} ${String(alvos.length).padStart(5)}` +
      (semTelefone ? ` · ${semTelefone} sem telefone` : "") +
      (publico === "alunos" ? "" : ` · ${declarados} disseram no formulário que já são alunos`));
  }
}

// --- Envio ---------------------------------------------------------------------------------

const TEXTOS: Record<Publico, string> = {
  leads: "Seu registro na BLACK VESTIGIUM foi confirmado.\n\nA aula ao vivo acontecerá dia 08/11 às 20h.\n\n👇🏻 Toque no botão abaixo para ver os detalhes de acesso",
  alunos: "Seu acesso à BLACK EXCLUSIVA DE ALUNOS foi confirmado.\n\nAs condições de alunos serão liberadas dia 06/11 às 10h.\n\n👇🏻 Toque no botão abaixo para ver os detalhes de acesso",
  medicos: "Seu registro na BLACK DE MÉDICO LEGISTA foi confirmado.\n\nAs condições para médicos serão liberadas dia 08/11 às 20h.\n\n👇🏻 Toque no botão abaixo para ver os detalhes de acesso",
};
// medicos_v2: o v1 virou MARKETING na Meta por causa de "a melhor condição do ano".
// *_acesso: botão "Quero meu acesso" ("Ver detalhes" colidia com um gatilho antigo do app Vestigium WTD).
const template = (p: Publico) => `convite_black_${p}_acesso`;
const ledger = (p: Publico) => `${SAIDA}-${p}-enviados.tsv`;

async function enviarConvite(p: Publico, convId: number): Promise<number> {
  const j = await chamar(`${BASE}/conversations/${convId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      message_type: "outgoing", content_type: "text", content: TEXTOS[p],
      template_params: {
        name: template(p), category: "UTILITY", language: "pt_BR",
        processed_params: { body: {}, header: { media_url: CONVITES_BLACK[template(p)]!.imagem, media_type: "image" } },
      },
    }),
  });
  return j.id;
}

async function jaEnviados(p: Publico): Promise<Map<string, string[]>> {
  const f = Bun.file(ledger(p));
  const linhas = (await f.exists()) ? (await f.text()).split("\n").filter(Boolean) : [];
  return new Map(linhas.map((l) => { const [tel, ...resto] = l.split("\t"); return [tel!, resto]; }));
}

/** Contato e conversa na inbox comercial; cria o que faltar. */
async function resolverConversa(a: Alvo): Promise<{ convId: number; telefone: string; novo: boolean }> {
  const c = await acharContato(a.whatsapp);
  if (c) {
    const conv = await convDaInbox(c.id);
    if (conv) return { convId: conv, telefone: c.phone_number, novo: false };
    return { convId: (await criarConversa(ACC, { inbox_id: INBOX, contact_id: c.id })).id, telefone: c.phone_number, novo: true };
  }
  const telefone = `+${a.whatsapp}`;
  const novo = await criarContato(ACC, { name: a.nome || telefone, phone_number: telefone });
  const convId = (await criarConversa(ACC, { inbox_id: INBOX, contact_id: novo.id, source_id: a.whatsapp })).id;
  return { convId, telefone, novo: true };
}

async function enviar(p: Publico, limite: number, valendo: boolean) {
  const { alvos } = JSON.parse(await Bun.file(`${SAIDA}-${p}.json`).text()) as { alvos: Alvo[] };
  const enviados = await jaEnviados(p);
  const lista = alvos.filter((a) => a.whatsapp && !enviados.has(a.whatsapp)).slice(0, limite);
  console.log(`${p}: ${lista.length} alvos (${enviados.size} já enviados antes) · ${template(p)} · ${valendo ? "VALENDO" : "dry-run"}\n`);
  if (!valendo) { console.log(`Dry-run: ${lista.length} receberiam. Use --enviar.`); return; }

  let ok = 0, falhas = 0;
  const fora: Record<string, number> = {};
  await emLotes(lista, 3, async (a) => {
    try {
      const { convId, telefone, novo } = await resolverConversa(a);
      // Na hora do envio: fica fora quem está bloqueado ou conversou nas últimas 2h.
      if (!novo) {
        const conv: any = await buscarConversa(ACC, convId);
        const motivo = conv.meta?.sender?.blocked ? "bloqueado"
          : Date.now() - (conv.last_activity_at ?? 0) * 1000 < 2 * 3_600_000 ? "ativo nas últimas 2h" : null;
        if (motivo) { fora[motivo] = (fora[motivo] ?? 0) + 1; return; }
      }
      const msgId = await enviarConvite(p, convId);
      await appendFile(ledger(p), `${a.whatsapp}\t${convId}\t${msgId}\n`);
      await salvarMensagemSeNova(telefone, {
        type: "ai", content: `[convite enviado] ${TEXTOS[p]}`, tool_calls: [], invalid_tool_calls: [], response_metadata: {},
        additional_kwargs: { origem: "disparo-convite-black", template: template(p) },
      });
      ok++;
    } catch (e) {
      falhas++;
      console.log(`✗ ${a.nome} (${a.whatsapp}): ${(e as Error).message.slice(0, 160)}`);
      logger.error("disparo-convite-black", "falha no envio", { publico: p, telefone: a.whatsapp, erro: (e as Error).message });
    }
  });
  console.log(`\n${ok} enviados, ${falhas} falhas · fora: ${JSON.stringify(fora)}`);
}

// Status que a Meta devolveu (sent/delivered/read/failed) para cada envio do ledger.
async function verificar(p: Publico) {
  const status: Record<string, number> = {}, erros: Record<string, number> = {};
  await emLotes([...(await jaEnviados(p)).values()], 3, async ([convId, msgId]) => {
    const msgs = ((await listarMensagens(ACC, convId!)) as any).payload ?? [];
    const m = msgs.find((x: any) => String(x.id) === msgId);
    const s = m?.status ?? "não encontrada";
    status[s] = (status[s] ?? 0) + 1;
    if (s === "failed") { const e = String(m?.content_attributes?.external_error ?? "?").slice(0, 80); erros[e] = (erros[e] ?? 0) + 1; }
  });
  console.log(JSON.stringify(status), Object.keys(erros).length ? `\nfalhas: ${JSON.stringify(erros, null, 1)}` : "");
}

const PUBLICOS: Publico[] = ["alunos", "leads", "medicos"];
const [cmd, arg, ...resto] = process.argv.slice(2);
const publico = PUBLICOS.find((x) => x === arg);
if (cmd === "montar" && arg && resto[0]) await montar(arg, resto[0]);
else if (cmd === "teste" && publico && resto[0]) console.log(`✓ ${template(publico)} → conv ${resto[0]} (msg ${await enviarConvite(publico, Number(resto[0]))})`);
else if (cmd === "enviar" && publico) {
  const i = resto.indexOf("--limite");
  await enviar(publico, i >= 0 ? Number(resto[i + 1]) : Infinity, resto.includes("--enviar"));
} else if (cmd === "verificar" && publico) await verificar(publico);
else console.log("uso: montar <respostas.csv> <matriculados.csv> | teste <publico> <conv> | enviar <publico> [--limite N] [--enviar] | verificar <publico>");
await pool.end();
