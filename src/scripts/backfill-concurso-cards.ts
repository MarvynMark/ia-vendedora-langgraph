/**
 * Backfill dos cards do Kanban criados com "Concurso: não informado" por causa do bug em
 * aplicacao-mentoria.ts (lia d.qual_concurso em vez de d.concurso_desejado).
 *
 * Estratégia: pagina todas as tasks do board, filtra as com "Concurso: não informado",
 * busca o qual_concurso do contato e substitui SOMENTE esse trecho na descrição
 * (preserva emoji, follow-ups, status e o resto). Não mexe em quem não tem o dado.
 *
 * Uso:
 *   DRY_RUN=1 bun run src/scripts/backfill-concurso-cards.ts   # só relatório, não escreve
 *   bun run src/scripts/backfill-concurso-cards.ts             # aplica as correções
 */
import { env } from "../config/env.ts";
import { atualizarKanbanTask } from "../services/chatwoot.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";

const BOARD_ID = 1;
const ALVO = "Concurso: não informado";
const DRY_RUN = process.env["DRY_RUN"] === "1";
const conta = env.CHATWOOT_ACCOUNT_ID;
const base = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${conta}`;
const cabecalhos = { "Content-Type": "application/json", api_access_token: env.CHATWOOT_API_TOKEN };

interface Task {
  id: number;
  title: string;
  description: string | null;
  contact_ids: number[];
  contacts: Array<{ id: number; name: string }>;
}

async function listarPagina(page: number): Promise<{ tasks: Task[]; hasMore: boolean }> {
  const res = await fetchComTimeout(`${base}/kanban/tasks?board_id=${BOARD_ID}&page=${page}`, {
    method: "GET",
    headers: cabecalhos,
    timeout: 30_000,
  });
  if (!res.ok) throw new Error(`listar page ${page} falhou (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { tasks: Task[]; meta: { has_more: boolean } };
  return { tasks: data.tasks ?? [], hasMore: data.meta?.has_more ?? false };
}

async function concursoDoContato(contactId: number): Promise<string | null> {
  const res = await fetchComTimeout(`${base}/contacts/${contactId}`, {
    method: "GET",
    headers: cabecalhos,
    timeout: 30_000,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { payload?: { custom_attributes?: Record<string, unknown> } };
  const v = data.payload?.custom_attributes?.["qual_concurso"];
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

async function main() {
  console.log(`\n=== Backfill Concurso nos cards (${DRY_RUN ? "DRY-RUN" : "APLICANDO"}) ===\n`);

  // 1) Coleta todas as tasks afetadas
  const afetadas: Task[] = [];
  let page = 1;
  let total = 0;
  for (;;) {
    const { tasks, hasMore } = await listarPagina(page);
    total += tasks.length;
    for (const t of tasks) {
      if (t.description?.includes(ALVO)) afetadas.push(t);
    }
    process.stdout.write(`\r  varridas ${total} tasks, ${afetadas.length} com "${ALVO}"...`);
    if (!hasMore || tasks.length === 0) break;
    page++;
  }
  console.log(`\n\n  Total varrido: ${total} tasks`);
  console.log(`  Com "não informado": ${afetadas.length}\n`);

  // 2) Para cada afetada, resolve o concurso do contato e corrige
  let corrigidas = 0;
  let semDado = 0;
  let erros = 0;
  const semDadoLista: string[] = [];

  for (const t of afetadas) {
    const contactId = t.contact_ids?.[0] ?? t.contacts?.[0]?.id;
    const nome = t.contacts?.[0]?.name ?? t.title;
    if (!contactId) {
      semDado++;
      semDadoLista.push(`${t.id} (${nome}) — sem contato`);
      continue;
    }
    let concurso: string | null = null;
    try {
      concurso = await concursoDoContato(contactId);
    } catch (e) {
      erros++;
      console.log(`  [ERRO] task ${t.id} (${nome}): falha ao buscar contato — ${String(e)}`);
      continue;
    }
    if (!concurso) {
      semDado++;
      semDadoLista.push(`${t.id} (${nome})`);
      continue;
    }
    const novaDescricao = t.description!.replace(ALVO, `Concurso: ${concurso}`);
    if (DRY_RUN) {
      console.log(`  [DRY] task ${t.id} (${nome}): "não informado" -> "${concurso}"`);
      corrigidas++;
      continue;
    }
    try {
      await atualizarKanbanTask(conta, t.id, { description: novaDescricao });
      corrigidas++;
      console.log(`  [OK] task ${t.id} (${nome}) -> "${concurso}"`);
    } catch (e) {
      erros++;
      console.log(`  [ERRO] task ${t.id} (${nome}): falha ao atualizar — ${String(e)}`);
    }
  }

  console.log(`\n=== Resumo ===`);
  console.log(`  Corrigidas${DRY_RUN ? " (simulado)" : ""}: ${corrigidas}`);
  console.log(`  Sem dado de concurso (ignoradas): ${semDado}`);
  console.log(`  Erros: ${erros}`);
  if (semDadoLista.length) {
    console.log(`\n  Sem qual_concurso no contato (continuam "não informado"):`);
    for (const s of semDadoLista.slice(0, 40)) console.log(`    - ${s}`);
    if (semDadoLista.length > 40) console.log(`    ... e mais ${semDadoLista.length - 40}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("Falha no backfill:", e);
  process.exit(1);
});
