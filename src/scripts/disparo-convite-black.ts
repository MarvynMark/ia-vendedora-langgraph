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

/** Todos os contatos com este telefone (com e sem o 9 — o Chatwoot tem muitos duplicados). */
async function contatosDoTelefone(tel: string): Promise<Array<{ id: number; phone_number: string }>> {
  const j = await chamar(`${BASE}/contacts/search?q=${tel.slice(-8)}`);
  return (j.payload ?? []).filter((x: any) => x.phone_number && chave(x.phone_number) === chave(tel));
}

/**
 * Conversas na inbox comercial de TODOS os contatos do telefone, da mais ativa para a menos.
 * A mais ativa é a que a pessoa usa: é nela que as respostas chegam. Em 02–03/11 o convite saiu
 * pelo duplicado sem o 9 e a resposta caiu em outra conversa (ver src/lib/convite-duplicatas.ts).
 */
async function convsDoTelefone(tel: string): Promise<Array<{ id: number; ultima: number; contato: { id: number; phone_number: string } }>> {
  const out: Array<{ id: number; ultima: number; contato: { id: number; phone_number: string } }> = [];
  for (const c of await contatosDoTelefone(tel)) {
    for (const v of (await buscarConversasDoContato(ACC, c.id).catch(() => [])) as any[]) {
      if (v.inbox_id === INBOX) out.push({ id: v.id, ultima: v.last_activity_at ?? 0, contato: c });
    }
  }
  return out.sort((a, b) => b.ultima - a.ultima);
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
  const [mNome, mTel, mCancelou, mCompra] = [colM("Nome Completo"), colM("Telefone"), colM("Cancelou a Mentoria"), colM("Data Compra")];
  if ([mNome, mTel, mCancelou, mCompra].includes(-1)) throw new Error("planilha de matriculados: colunas não encontradas");
  // Quem comprou nos últimos 30 dias fica fora do convite de alunos (decidido em 02/11/2026): ainda
  // está no prazo de arrependimento ou acabou de pagar a tabela, e a condição de renovação só geraria
  // reembolso e atrito. Continua fora também de leads/médicos (é matriculado).
  const corteRecentes = Date.now() - 30 * 86_400_000;
  const chavesAlunos = new Set<string>(), chavesCancelados = new Set<string>(), chavesRecentes = new Set<string>();
  const porAluno = new Map<string, { nome: string; tel: string }>();
  let semTelefone = 0;
  for (const l of mat.slice(2)) {
    const tel = (l[mTel] ?? "").replace(/\D/g, "");
    if (tel.length < 10) { if ((l[mNome] ?? "").trim()) semTelefone++; continue; }
    const k = chave(tel);
    chavesAlunos.add(k);
    if ((l[mCancelou] ?? "").trim().toUpperCase() === "SIM") chavesCancelados.add(k);
    const compra = (l[mCompra] ?? "").match(/(\d+)\/(\d+)\/(\d{4})/);
    if (compra && new Date(`${compra[3]}-${compra[2]!.padStart(2, "0")}-${compra[1]!.padStart(2, "0")}T00:00:00-03:00`).getTime() >= corteRecentes) chavesRecentes.add(k);
    porAluno.set(k, { nome: (l[mNome] ?? "").trim(), tel });
  }
  const alunos: Alvo[] = [...porAluno.entries()].filter(([k]) => !chavesCancelados.has(k) && !chavesRecentes.has(k)).map(([, a]) => ({
    nome: a.nome, whatsapp: a.tel.startsWith("55") ? a.tel : `55${a.tel}`, formacao: null, aplicou: null,
    contato: null, telefoneContato: null, conv: null,
  }));
  console.log(`matriculados: ${porAluno.size} números únicos, ${chavesCancelados.size} cancelados, ${chavesRecentes.size} compraram nos últimos 30 dias, ${semTelefone} linhas sem telefone`);

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
// O que a IA passa a saber quando o lead voltar a falar. Perguntas sobre a Black já são pausadas
// e passadas ao comercial pelo webhook (perguntaDaBlack); isto cobre o que escapar do filtro.
const ESCALAR = "Se a pessoa perguntar da Black (preço, condição, desconto, como comprar), NÃO informe valores nem cupom: use Escalar_humano para o comercial atender com a condição Black.";
const MEMORIA: Record<Publico, string> = {
  leads: `[convite da Black enviado] Convidei para a BLACK VESTIGIUM 2026: aula AO VIVO no YouTube no domingo, 08/11, às 20h; a oferta é revelada só na live. O link da live e os avisos vão SOMENTE no Grupo VIP: https://chat.whatsapp.com/KNtt3cuiTPO41AHWEzq0Y5. ${ESCALAR}`,
  alunos: `[convite da Black enviado] Esta pessoa é ALUNA ou ex-aluna da mentoria. Convidei para a BLACK EXCLUSIVA DE ALUNOS: as condições de alunos saem SOMENTE no grupo de alunos na sexta, 06/11, às 10h: https://chat.whatsapp.com/FGvOpeUse37684e2BKhEaZ. Não trate como lead novo. ${ESCALAR}`,
  medicos: `[convite da Black enviado] Médico(a) ou estudante de medicina. Convidei para a BLACK DE MÉDICO LEGISTA: as condições para médicos saem no domingo, 08/11, às 20h, SOMENTE no grupo de médicos: https://chat.whatsapp.com/Cu9GVmjY0bMHkD80mQ96yv. ${ESCALAR}`,
};

const template = (p: Publico) => `convite_black_${p}_acesso`;
const ledger = (p: Publico) => `${SAIDA}-${p}-enviados.tsv`;

// Lembrete: template próprio, com data perto ("amanhã"/"hoje"), para quem leu e não tocou.
// Alunos na véspera (05/11 19h), leads e médicos no dia da live (08/11 10h).
// v2: a v1 ("ainda não foi ativado" + "hoje/amanhã") foi reclassificada para MARKETING em 03/11.
// Formato de lembrete de evento registrado; a urgência vem do dia do envio e da arte.
const R = "\n\n👇🏻 Toque no botão abaixo para ver os detalhes de acesso";
const LEMBRETES: Record<Publico, { template: string; texto: string; imagem: string }> = {
  alunos: { template: "lembrete_black_alunos_v2", texto: "Lembrete do seu registro na BLACK EXCLUSIVA DE ALUNOS.\n\nAs condições de alunos serão liberadas dia 06/11 às 10h." + R, imagem: "https://chat.stkd.site/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBL250QVE9PSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--ff3991ed1401226ec7fb7963243aea62c8071e03/lembrete_black_alunos.jpg" },
  leads: { template: "lembrete_black_leads_v2", texto: "Lembrete do seu registro na BLACK VESTIGIUM.\n\nA aula ao vivo acontecerá dia 08/11 às 20h." + R, imagem: "https://chat.stkd.site/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBL2Z0QVE9PSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--df58dd03e0a9753e9cccd6d31edc058911b5e86c/lembrete_black_leads.jpg" },
  medicos: { template: "lembrete_black_medicos_v2", texto: "Lembrete do seu registro na BLACK DE MÉDICO LEGISTA.\n\nAs condições para médicos serão liberadas dia 08/11 às 20h." + R, imagem: "https://chat.stkd.site/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBL0h0QVE9PSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--330bf6409ed4ad36513f9b671b5a77828411905c/lembrete_black_medicos.jpg" },
};

/** Lembrete só sai como UTILITY (decisão do Gusthavo, 03/11/2026): consulta a categoria na Meta. */
async function categoriaNaMeta(nome: string): Promise<string | null> {
  const inbox = await chamar(`${BASE}/inboxes/${INBOX}`);
  const { business_account_id: waba, api_key: tok } = inbox.provider_config ?? {};
  const r = await fetchComTimeout(`https://graph.facebook.com/v21.0/${waba}/message_templates?name=${nome}&fields=name,status,category`, { headers: { Authorization: `Bearer ${tok}` } });
  const t = (((await r.json()) as any).data ?? []).find((x: any) => x.name === nome);
  return t && t.status === "APPROVED" ? t.category : null;
}

async function enviarConvite(p: Publico, convId: number, modo: "convite" | "lembrete" = "convite"): Promise<number> {
  const t = modo === "lembrete"
    ? LEMBRETES[p]
    : { template: template(p), texto: TEXTOS[p], imagem: CONVITES_BLACK[template(p)]!.imagem };
  const j = await chamar(`${BASE}/conversations/${convId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      message_type: "outgoing", content_type: "text", content: t.texto,
      template_params: {
        name: t.template, category: "UTILITY", language: "pt_BR",
        processed_params: { body: {}, header: { media_url: t.imagem, media_type: "image" } },
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
  const convs = await convsDoTelefone(a.whatsapp);
  if (convs[0]) return { convId: convs[0].id, telefone: convs[0].contato.phone_number, novo: false };
  const contatos = await contatosDoTelefone(a.whatsapp);
  // Sem conversa: prefere o contato com o 9 (13 dígitos com o 55), que é o formato atual.
  const c = contatos.find((x) => x.phone_number.replace(/\D/g, "").length === 13) ?? contatos[0];
  if (c) return { convId: (await criarConversa(ACC, { inbox_id: INBOX, contact_id: c.id })).id, telefone: c.phone_number, novo: true };
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
  await emLotes(lista, 3, async (a) => comLimite(60_000, async () => {
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
        type: "ai", content: MEMORIA[p], tool_calls: [], invalid_tool_calls: [], response_metadata: {},
        additional_kwargs: { origem: "disparo-convite-black", template: template(p) },
      });
      ok++;
    } catch (e) {
      falhas++;
      console.log(`✗ ${a.nome} (${a.whatsapp}): ${(e as Error).message.slice(0, 160)}`);
      logger.error("disparo-convite-black", "falha no envio", { publico: p, telefone: a.whatsapp, erro: (e as Error).message });
    }
  }).catch((e) => { falhas++; console.log(`✗ ${a.nome} (${a.whatsapp}): ${(e as Error).message}`); }));
  console.log(`\n${ok} enviados, ${falhas} falhas · fora: ${JSON.stringify(fora)}`);
}

/** Um contato travado (fetch ou banco sem resposta) não pode parar o disparo inteiro: em 02/11 o
 *  lote 4 dos leads ficou 10h parado num único contato. */
function comLimite<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return Promise.race([fn(), new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`tempo esgotado (${ms / 1000}s)`)), ms))]);
}

/** Pediu para não receber mais ("Cancelar recebimento", "sair", "parar"...). */
const RE_OPTOUT = /cancelar recebimento|parar (de )?receber|n[aã]o (quero|desejo) (mais )?receber|^(sair|parar|pare|stop|descadastrar)$|parar mensagens/i;

/**
 * Lembrete: reenvia o convite para quem LEU e não fez nada depois — não tocou no botão, não
 * escreveu, não foi escalado e não pediu para sair. Ledger próprio: lembra uma vez só.
 */
async function lembrete(p: Publico, valendo: boolean) {
  const cat = await categoriaNaMeta(LEMBRETES[p].template);
  if (cat !== "UTILITY") { console.log(`${p} lembrete: NÃO ENVIADO — ${LEMBRETES[p].template} está ${cat ?? "não aprovado"} (só sai como UTILITY)`); return; }
  const enviados = [...(await jaEnviados(p)).entries()];
  const arqLedger = `${SAIDA}-${p}-lembrete.tsv`;
  const f = Bun.file(arqLedger);
  const jaLembrados = new Set((await f.exists()) ? (await f.text()).split("\n").filter(Boolean).map((l) => l.split("\t")[0]) : []);
  let ok = 0, falhas = 0;
  const fora: Record<string, number> = {};
  const conta = (m: string) => { fora[m] = (fora[m] ?? 0) + 1; };
  await emLotes(enviados.filter(([tel]) => !jaLembrados.has(tel)), 3, async ([tel, [convId, msgId]]) => comLimite(60_000, async () => {
    // Junta as conversas de todos os contatos do telefone: o convite pode ter saído pelo duplicado
    // e o toque/resposta ter chegado na conversa verdadeira.
    const convs = await convsDoTelefone(tel);
    const ids = [...new Set([Number(convId), ...convs.map((c) => c.id)])];
    const msgs: any[] = (await Promise.all(ids.map(async (id) => ((await listarMensagens(ACC, String(id))) as any).payload ?? []))).flat();
    const convite = msgs.find((x) => String(x.id) === msgId);
    if (convite?.status !== "read") return conta(convite?.status ? `convite ${convite.status}` : "convite não encontrado");
    const depois = msgs.filter((x) => x.id > Number(msgId));
    if (depois.some((x) => x.message_type === 0 && RE_OPTOUT.test((x.content ?? "").trim()))) return conta("pediu para sair");
    if (depois.some((x) => x.message_type === 0)) return conta("interagiu");
    if (depois.some((x) => x.private && /Pergunta sobre a Black/.test(x.content ?? ""))) return conta("escalado");
    const destino = convs[0]?.id ?? Number(convId);
    const conv: any = await buscarConversa(ACC, destino);
    if (conv.meta?.sender?.blocked) return conta("bloqueado");
    if (!valendo) { ok++; return; }
    const id = await enviarConvite(p, destino, "lembrete");
    await appendFile(arqLedger, `${tel}\t${destino}\t${id}\n`);
    ok++;
  }).catch((e) => { falhas++; console.log(`✗ ${tel}: ${(e as Error).message.slice(0, 120)}`); }));
  console.log(`${p} lembrete: ${valendo ? `${ok} enviados, ${falhas} falhas` : `dry-run: ${ok} receberiam`} · fora: ${JSON.stringify(fora)}`);
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
else if (cmd === "teste-lembrete" && publico && resto[0]) console.log(`✓ ${LEMBRETES[publico].template} → conv ${resto[0]} (msg ${await enviarConvite(publico, Number(resto[0]), "lembrete")})`);
else if (cmd === "enviar" && publico) {
  const i = resto.indexOf("--limite");
  await enviar(publico, i >= 0 ? Number(resto[i + 1]) : Infinity, resto.includes("--enviar"));
} else if (cmd === "verificar" && publico) await verificar(publico);
else if (cmd === "lembrete" && publico) await lembrete(publico, resto.includes("--enviar"));
else console.log("uso: montar <respostas.csv> <matriculados.csv> | teste <publico> <conv> | enviar <publico> [--limite N] [--enviar] | verificar <publico> | lembrete <publico> [--enviar]");
await pool.end();
