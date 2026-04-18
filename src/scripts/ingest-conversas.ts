/**
 * Script de ingestão RAG — conversas ganhas + mapeamento de objeções
 *
 * Uso:
 *   bun run src/scripts/ingest-conversas.ts
 *   bun run src/scripts/ingest-conversas.ts --apenas ganhas
 *   bun run src/scripts/ingest-conversas.ts --apenas objecoes
 *   bun run src/scripts/ingest-conversas.ts --limpar    (remove tudo e reindexa)
 */

import { env } from "../config/env.ts";
import { pool } from "../db/pool.ts";
import { criarTabelas } from "../db/setup.ts";
import { inserirDocumento, limparDocumentosPorTipo, contarDocumentos } from "../db/rag.ts";
import { gerarEmbedding } from "../services/embeddings.ts";
import { listarKanbanTasks, listarMensagens } from "../services/chatwoot.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";

const ACCOUNT_ID = env.CHATWOOT_ACCOUNT_ID;
const BOARD_ID = env.KANBAN_BOARD_ID;
const STEP_GANHO = 9;
const STEP_PERDIDO = 11;
const MAX_PERDIDOS = 50;

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Mensagem {
  id: number;
  content: string | null;
  message_type: number;
  created_at: number;
  content_attributes?: { deleted?: boolean };
  sender?: { id?: number; name?: string; type?: string };
}

interface KanbanTask {
  id: number;
  title: string;
  description: string;
  board_step_id: number;
  conversation_ids: number[];
  contacts?: Array<{ id: number; name: string }>;
}

interface ConversaLabels {
  payload: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[ingest] ${msg}`);
}

async function buscarLabels(conversationId: number): Promise<string[]> {
  try {
    const url = `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/labels`;
    const res = await fetchComTimeout(url, {
      method: "GET",
      headers: { api_access_token: env.CHATWOOT_API_TOKEN },
      timeout: 10000,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as ConversaLabels;
    return data.payload ?? [];
  } catch {
    return [];
  }
}

async function buscarMensagens(conversationId: number): Promise<Mensagem[]> {
  try {
    const data = (await listarMensagens(ACCOUNT_ID, conversationId)) as { payload?: Mensagem[] };
    return (data.payload ?? []).filter(
      (m) => m.content && !m.content_attributes?.deleted && m.content.trim().length > 2,
    );
  } catch {
    return [];
  }
}

function formatarMensagem(m: Mensagem): string {
  const quem = m.message_type === 0 ? "LEAD" : "IA/VENDEDOR";
  const texto = (m.content ?? "").substring(0, 300);
  return `${quem}: ${texto}`;
}

function classificarObjecao(msgs: Mensagem[], descricao: string): string {
  const textoCompleto = msgs.map((m) => m.content ?? "").join(" ").toLowerCase();
  const desc = descricao.toLowerCase();

  if (/sem dinheiro|infelizmente|não tenho|não posso|caro|valor|preço/.test(textoCompleto)) return "preço/financeiro";
  if (/sem tempo|muito ocupad|trabalho|corrido/.test(textoCompleto)) return "sem tempo";
  if (/edital|ainda não saiu|esperar o edital/.test(textoCompleto)) return "aguardando edital";
  if (/investigador|delegado|agente|não é perito/.test(textoCompleto)) return "cargo errado";
  if (/vou pensar|preciso pensar|depois|não agora/.test(textoCompleto)) return "indecisão";
  if (/sem formação|não tenho graduação/.test(textoCompleto)) return "sem formação";
  if (/sem dinheiro|infelizmente/.test(desc)) return "preço/financeiro";

  return "sem resposta do lead";
}

function extrairConcurso(titulo: string, descricao: string): string {
  const match = titulo.match(/[-–]\s*([A-Z]{2,}[\w\s]*)/);
  if (match?.[1]) return match[1].trim();
  const descMatch = descricao.match(/Concurso:\s*([^\n]+)/i);
  return descMatch?.[1]?.trim() ?? "não informado";
}

// ─── Ingestão de conversas ganhas ─────────────────────────────────────────────

async function ingerirConversasGanhas() {
  log("=== Iniciando ingestão de CONVERSAS GANHAS ===");

  // Busca todas as páginas do step Ganho
  const tasks: KanbanTask[] = [];
  for (let page = 1; page <= 5; page++) {
    const pagina = await listarKanbanTasks(ACCOUNT_ID, BOARD_ID, STEP_GANHO, page) as KanbanTask[];
    if (pagina.length === 0) break;
    const doPasso = pagina.filter((t) => t.board_step_id === STEP_GANHO);
    tasks.push(...doPasso);
    if (doPasso.length < pagina.length) break;
  }

  log(`Encontradas ${tasks.length} tasks no step Ganho`);

  let indexadas = 0;
  for (const task of tasks) {
    const convIds = task.conversation_ids ?? [];
    if (convIds.length === 0) {
      log(`  [skip] "${task.title}" — sem conversation_id vinculado`);
      continue;
    }

    const convId = convIds[0]!;
    log(`  Processando conv #${convId} — "${task.title}"`);

    const [msgs, labels] = await Promise.all([buscarMensagens(convId), buscarLabels(convId)]);

    if (msgs.length === 0) {
      log(`    [skip] sem mensagens visíveis`);
      continue;
    }

    const autoria = labels.includes("nao") ? "IA" : labels.includes("sim") ? "Pedro (humano)" : "desconhecida";
    const concurso = extrairConcurso(task.title, task.description ?? "");

    // Divide em abertura / meio / fechamento
    const abertura = msgs.slice(0, 5).map(formatarMensagem).join("\n");
    const meio = msgs.slice(5, -5).map(formatarMensagem).join("\n");
    const fechamento = msgs.slice(-5).map(formatarMensagem).join("\n");

    const numMsgs = msgs.length;
    const durHoras = msgs.length > 1
      ? Math.round((msgs[msgs.length - 1]!.created_at - msgs[0]!.created_at) / 3600)
      : 0;

    const conteudo = `CONVERSA GANHA #${convId}
Lead: ${task.title}
Concurso: ${concurso}
Atendimento: ${autoria}
Total de mensagens: ${numMsgs} | Duração aproximada: ${durHoras}h
Labels: ${labels.join(", ") || "nenhuma"}

ABERTURA:
${abertura || "(sem mensagens de abertura visíveis)"}

MEIO DA CONVERSA:
${meio || "(não disponível)"}

FECHAMENTO:
${fechamento}

PADRÃO: Lead com label "${labels.includes("nao") ? "nao" : "sim"}" fechou a compra após ${numMsgs} mensagens em ~${durHoras}h.`;

    const textoParaEmbedding = `Venda fechada para ${task.title}. Concurso: ${concurso}. Atendimento: ${autoria}. ${task.description ?? ""}`;

    try {
      const embedding = await gerarEmbedding(textoParaEmbedding);
      await inserirDocumento({
        tipo: "conversa_ganha",
        titulo: `${task.title} — ${concurso} (${autoria})`,
        conteudo,
        metadata: {
          conversation_id: convId,
          task_id: task.id,
          concurso,
          autoria,
          labels,
          num_mensagens: numMsgs,
          duracao_horas: durHoras,
        },
        embedding,
      });
      indexadas++;
      log(`    ✓ Indexada (${autoria}, ${numMsgs} msgs, ${durHoras}h)`);
    } catch (e) {
      log(`    ✗ Erro ao indexar: ${e}`);
    }

    // Pausa para não sobrecarregar a API OpenAI
    await new Promise((r) => setTimeout(r, 300));
  }

  log(`=== Conversas ganhas: ${indexadas}/${tasks.length} indexadas ===\n`);
}

// ─── Ingestão de objeções (conversas perdidas) ────────────────────────────────

async function ingerirObjecoes() {
  log("=== Iniciando ingestão de OBJEÇÕES (conversas perdidas) ===");

  const tasks: KanbanTask[] = [];
  for (let page = 1; page <= 10; page++) {
    const pagina = await listarKanbanTasks(ACCOUNT_ID, BOARD_ID, STEP_PERDIDO, page) as KanbanTask[];
    if (pagina.length === 0) break;
    const doPasso = pagina.filter((t) => t.board_step_id === STEP_PERDIDO && (t.conversation_ids ?? []).length > 0);
    tasks.push(...doPasso);
    if (tasks.length >= MAX_PERDIDOS) break;
  }

  const amostra = tasks.slice(0, MAX_PERDIDOS);
  log(`Processando ${amostra.length} conversas perdidas para mapeamento de objeções`);

  let indexadas = 0;
  for (const task of amostra) {
    const convId = task.conversation_ids[0]!;
    log(`  Processando conv #${convId} — "${task.title}"`);

    const [msgs, labels] = await Promise.all([buscarMensagens(convId), buscarLabels(convId)]);

    if (msgs.length === 0) {
      log(`    [skip] sem mensagens`);
      continue;
    }

    const objecaoTipo = classificarObjecao(msgs, task.description ?? "");
    const concurso = extrairConcurso(task.title, task.description ?? "");

    // Pega as mensagens centrais (onde a objeção aconteceu)
    const centro = msgs.slice(Math.max(0, msgs.length - 10)).map(formatarMensagem).join("\n");

    // Extrai a última resposta tentada pelo vendedor/IA
    const msgsVendedor = msgs.filter((m) => m.message_type !== 0);
    const ultimaResposta = msgsVendedor[msgsVendedor.length - 1]?.content ?? "(sem resposta registrada)";

    const conteudo = `OBJEÇÃO: ${objecaoTipo.toUpperCase()}
Lead: ${task.title} | Concurso: ${concurso}
Atendimento: ${labels.includes("nao") ? "IA" : "Pedro"} | Status: ${task.description?.match(/👤 - Descrição:\s*([^\n]+)/i)?.[1] ?? "perdido"}

CONTEXTO DAS ÚLTIMAS MENSAGENS:
${centro}

ÚLTIMA RESPOSTA DO VENDEDOR ANTES DE PERDER:
${ultimaResposta.substring(0, 400)}

RESULTADO: Lead não fechou. Motivo classificado: ${objecaoTipo}`;

    const textoParaEmbedding = `Objeção "${objecaoTipo}" de lead para ${concurso}. ${msgs.slice(-3).map((m) => m.content ?? "").join(" ")}`;

    try {
      const embedding = await gerarEmbedding(textoParaEmbedding);
      await inserirDocumento({
        tipo: "objecao",
        titulo: `Objeção: ${objecaoTipo} — ${task.title}`,
        conteudo,
        metadata: {
          conversation_id: convId,
          task_id: task.id,
          concurso,
          objecao_tipo: objecaoTipo,
          labels,
          num_mensagens: msgs.length,
        },
        embedding,
      });
      indexadas++;
      log(`    ✓ Objeção "${objecaoTipo}" indexada`);
    } catch (e) {
      log(`    ✗ Erro ao indexar: ${e}`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  log(`=== Objeções: ${indexadas}/${amostra.length} indexadas ===\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apenasGanhas = args.includes("--apenas") && args.includes("ganhas");
const apenasObjecoes = args.includes("--apenas") && args.includes("objecoes");
const limpar = args.includes("--limpar");

log("Garantindo que as tabelas existem...");
await criarTabelas();

if (limpar || (!apenasGanhas && !apenasObjecoes)) {
  if (limpar) {
    log("Limpando documentos existentes...");
    await limparDocumentosPorTipo("conversa_ganha");
    await limparDocumentosPorTipo("objecao");
  }
}

if (!apenasObjecoes) {
  await ingerirConversasGanhas();
}

if (!apenasGanhas) {
  await ingerirObjecoes();
}

const totalGanhas = await contarDocumentos("conversa_ganha");
const totalObjecoes = await contarDocumentos("objecao");
log(`✅ Ingestão concluída — ${totalGanhas} conversas ganhas + ${totalObjecoes} objeções no RAG`);

await pool.end();
