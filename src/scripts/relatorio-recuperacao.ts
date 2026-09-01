// Relatório de retorno da recuperação em massa de 21/08 (os ~140 leads engajados que estavam
// presos em "Primeira mensagem" e foram movidos p/ Conexão). Rastreia a MESMA coorte (salva em
// output/cohort-recuperacao-2026-08-21.json) e mede: quantos responderam ao toque, onde estão
// agora no funil, e quantas vendas.
//
// Uso: bun run src/scripts/relatorio-recuperacao.ts
import { env } from "../config/env.ts";
import { listarKanbanTasks, listarMensagens } from "../services/chatwoot.ts";
import { readFileSync } from "fs";

const COORTE = "output/cohort-recuperacao-2026-08-21.json";
const acc = env.CHATWOOT_ACCOUNT_ID, board = env.KANBAN_BOARD_ID;
const NOME_ETAPA: Record<number, string> = { 1: "Novo Lead", 7: "Primeira msg", 10: "Conexão", 8: "Aguardando Pagto", 9: "GANHO", 11: "Perdido", 12: "Nutrir" };

const data = JSON.parse(readFileSync(COORTE, "utf8")) as { total: number; leads: Array<{ cardId: number; convId: number | null; title: string; movedAt: string }> };
console.log(`Coorte de recuperação (21/08): ${data.total} leads. Levantando estado atual...`);

// 1) Mapa cardId → etapa atual (re-pull do board)
const seen = new Set<number>(); const stepById = new Map<number, number>();
for (let p = 1; p <= 400; p++) {
  const t = await listarKanbanTasks(acc, board, 8, p);
  for (const c of t as any[]) { if (seen.has(c.id)) continue; seen.add(c.id); stepById.set(c.id, c.board_step_id); }
  if (t.length < 25) break;
}

// 2) Por lead: respondeu ao toque? (mensagem incoming DEPOIS do movedAt)
let responderam = 0, semConv = 0, erros = 0;
const porEtapa: Record<string, number> = {};
const respondentes: string[] = [];
for (const L of data.leads) {
  const step = stepById.get(L.cardId);
  const etapa = step ? (NOME_ETAPA[step] ?? String(step)) : "(sumiu do board)";
  porEtapa[etapa] = (porEtapa[etapa] || 0) + 1;
  if (!L.convId) { semConv++; continue; }
  const desde = Math.floor(new Date(L.movedAt).getTime() / 1000);
  try {
    const r = await listarMensagens(acc, L.convId) as { payload?: Array<{ message_type: number; created_at: number; content?: string | null }> };
    const respondeu = (r.payload ?? []).some(m => m.message_type === 0 && m.created_at > desde && !/grupo de espera|acesso ao grupo|entrar no grupo/i.test(m.content ?? ""));
    if (respondeu) { responderam++; respondentes.push(`${L.title} (${etapa}) — conv ${L.convId}`); }
  } catch { erros++; }
}

console.log(`\n=== RELATÓRIO DE RECUPERAÇÃO — coorte 21/08 (${data.total} leads) ===`);
console.log(`\n📣 RESPONDERAM ao toque de recuperação: ${responderam} de ${data.total} (${(responderam / data.total * 100).toFixed(0)}%)`);
console.log(`\n📊 Onde a coorte está AGORA no funil:`);
for (const [e, n] of Object.entries(porEtapa).sort((a, b) => b[1] - a[1])) console.log(`   ${e}: ${n}`);
const vendas = porEtapa["GANHO"] ?? 0;
console.log(`\n💰 Vendas (chegaram a Ganho): ${vendas}`);
console.log(`\nLeads que responderam (pro closer humano dar sequência):`);
respondentes.forEach(r => console.log("   - " + r));
if (erros) console.log(`\n(⚠️ ${erros} conversas não puderam ser lidas; ${semConv} sem conversa)`);
