// Lista de ação: dinheiro parado no funil AGORA — pro closer humano trabalhar hoje.
//
// Dois blocos, por urgência:
//   1) Aguardando Pagamento — já disse que vai pagar e não pagou. Mostra há quantos dias parou,
//      se o link de pagamento chegou a ser enviado e se o lead falou em comprovante/pagamento.
//   2) Conexão QUENTES — chegou a ouvir o preço, deu sinal de compra (link/pix/parcelar/...) e a
//      última palavra foi da IA (ghosting). É o lead que sumiu no melhor momento.
//
// Uso: bun run src/scripts/leads-parados.ts
// Gera também output/leads-parados-<data>.csv

import { mkdirSync, writeFileSync } from "node:fs";
import { env } from "../config/env.ts";
import type { KanbanTaskResumo } from "../services/chatwoot.ts";
import { varrerBoard, analisarConversa, STEP, type Analise } from "../lib/lista-quente.ts";

const ACC = env.CHATWOOT_ACCOUNT_ID;
const STEP_AG_PAGTO = STEP.aguardandoPagamento;
const STEP_CONEXAO = STEP.conexao;
const CRM = `${env.CHATWOOT_BASE_URL}/app/accounts/${ACC}/conversations`;

const hoje = Date.now();
const diasDe = (iso?: string | null) =>
  iso ? Math.floor((hoje - new Date(iso).getTime()) / 86_400_000) : -1;

type Linha = {
  bloco: string;
  nome: string;
  dias: number;
  link: string;
  linkPagto: string;
  sinal: string;
  ultimaLead: string;
};

const cards = await varrerBoard();
const conexao = cards.filter((c) => c.board_step_id === STEP_CONEXAO);
const agPagto = cards.filter((c) => c.board_step_id === STEP_AG_PAGTO);
console.log(
  `Board varrido: ${cards.length} cards. Analisando ${agPagto.length} em Aguardando Pagamento e ` +
  `${conexao.length} em Conexão...\n`,
);

const linhas: Linha[] = [];
let semConversa = 0;

// ── Bloco 1: Aguardando Pagamento ───────────────────────────────────────────
const ag = agPagto
  .map((c) => ({ card: c, dias: diasDe(c.step_changed_at ?? c.created_at) }))
  .sort((a, b) => b.dias - a.dias);

console.log(`💰 AGUARDANDO PAGAMENTO — ${ag.length} leads (disseram que iam pagar)\n`);
for (const { card, dias } of ag) {
  const displayId = card.conversation_ids?.[0] ?? card.conversations?.[0]?.display_id;
  if (!displayId) { semConversa++; continue; }
  const a = await analisarConversa(displayId);
  const link = `${CRM}/${displayId}`;
  console.log(`  ${String(dias).padStart(3)}d parado | ${card.title}`);
  console.log(`         ${link}`);
  if (a) {
    console.log(
      `         link de pagamento enviado: ${a.linkEnviado ? "SIM" : "NÃO"} | ` +
      `última msg: ${a.ultimaEhIa ? "IA (lead sumiu)" : "LEAD (esperando resposta!)"}`,
    );
    if (a.ultimaLead) console.log(`         último dito pelo lead: "${a.ultimaLead}"`);
  }
  console.log();
  linhas.push({
    bloco: "Aguardando Pagamento", nome: card.title, dias, link,
    linkPagto: a?.linkEnviado ? "sim" : "nao",
    sinal: a?.ultimaEhIa ? "lead sumiu" : "aguardando nossa resposta",
    ultimaLead: a?.ultimaLead ?? "",
  });
}

// ── Bloco 2: Conexão quentes ────────────────────────────────────────────────
const quentes: Array<{ card: KanbanTaskResumo; a: Analise; link: string }> = [];
for (const card of conexao) {
  const displayId = card.conversation_ids?.[0] ?? card.conversations?.[0]?.display_id;
  if (!displayId) { semConversa++; continue; }
  const a = await analisarConversa(displayId);
  if (!a || !a.chegouPreco || !a.sinalCompra || !a.ultimaEhIa) continue;
  quentes.push({ card, a, link: `${CRM}/${displayId}` });
}
quentes.sort((x, y) => y.a.ultimaEm - x.a.ultimaEm);

console.log(`\n🔥 CONEXÃO QUENTES — ${quentes.length} de ${conexao.length} leads`);
console.log(`   (ouviram o preço, deram sinal de compra e sumiram — a última palavra foi da IA)\n`);
for (const { card, a, link } of quentes) {
  const dias = Math.floor((hoje - a.ultimaEm * 1000) / 86_400_000);
  console.log(`  ${String(dias).padStart(3)}d sem resposta | ${card.title}`);
  console.log(`         ${link}`);
  console.log(`         link de pagamento enviado: ${a.linkEnviado ? "SIM" : "NÃO"}`);
  if (a.ultimaLead) console.log(`         último dito pelo lead: "${a.ultimaLead}"`);
  console.log();
  linhas.push({
    bloco: "Conexão quente", nome: card.title, dias, link,
    linkPagto: a.linkEnviado ? "sim" : "nao",
    sinal: "ouviu preço + sinal de compra, sumiu",
    ultimaLead: a.ultimaLead,
  });
}

// ── CSV ─────────────────────────────────────────────────────────────────────
const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const csv = [
  ["bloco", "lead", "dias_parado", "link_crm", "link_pagamento_enviado", "situacao", "ultima_msg_do_lead"].join(","),
  ...linhas.map((l) => [l.bloco, l.nome, l.dias, l.link, l.linkPagto, l.sinal, l.ultimaLead].map(esc).join(",")),
].join("\n");

mkdirSync("output", { recursive: true });
const data = new Date().toISOString().slice(0, 10);
const arquivo = `output/leads-parados-${data}.csv`;
writeFileSync(arquivo, csv);

console.log(`\n📄 ${linhas.length} leads no CSV: ${arquivo}`);
if (semConversa) console.log(`(${semConversa} cards sem conversa vinculada, ignorados)`);
process.exit(0);
