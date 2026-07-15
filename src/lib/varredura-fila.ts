/**
 * Varredura de fila órfã (rede de segurança).
 *
 * Em operação normal, uma mensagem fica na fila (n8n_fila_mensagens) por poucos segundos:
 * é enfileirada, aguarda o debounce e é coletada+limpa pelo grafo. Se o app for reiniciado
 * (deploy) ou o processo morrer no meio de um atendimento, o lock pode ficar preso e a próxima
 * mensagem do lead fica ÓRFÃ na fila, sem nada que a reprocesse (o sistema é 100% webhook-driven).
 * Foi o que travou a conversa 4223.
 *
 * Este job roda periodicamente, acha mensagens paradas na fila há mais que o limiar (bem além do
 * debounce), confirma que a conversa ainda é da IA (label agente-on) e reprocessa via o grafo
 * principal. O próprio lock/debounce/stale do grafo evita colisão com um atendimento ativo.
 */
import { pool } from "../db/pool.ts";
import { logger } from "./logger.ts";
import { env } from "../config/env.ts";
import { buscarContatoPorQuery, buscarConversasDoContato, buscarConversa } from "../services/chatwoot.ts";
import { buscarDadosFormulario } from "../db/formulario.ts";
import { limparFila } from "../db/fila.ts";
import { criarGrafoAgenteClinica } from "../graphs/main-agent/graph.ts";

const CONTA = env.CHATWOOT_ACCOUNT_ID;
const INBOX = env.CHATWOOT_INBOX_ID;
// Janela de RECUPERAÇÃO: só reprocessa mensagem parada na fila entre estes limites.
// - MIN (3min): bem acima do debounce de 16s + envio de um turno normal, então já é órfã de verdade.
// - MAX (1h): além disso o lead provavelmente já seguiu a vida; responder do nada seria estranho.
const ORFA_MIN = "3 minutes";
const ORFA_MAX = "1 hour";
// Lixo morto: mensagens paradas há mais que isto (nunca processadas, lead sumiu) são purgadas.
const ORFA_PURGA = "24 hours";

let grafoCache: Awaited<ReturnType<typeof criarGrafoAgenteClinica>> | null = null;
async function obterGrafo() {
  if (!grafoCache) grafoCache = await criarGrafoAgenteClinica();
  return grafoCache;
}

interface MsgFila { id_mensagem: string; mensagem: string; }

export async function varrerFilaOrfa(): Promise<void> {
  // Higiene: purga mensagens mortas (paradas há muito tempo, lead sumiu, nunca processadas).
  try {
    const p = await pool.query(
      `DELETE FROM n8n_fila_mensagens WHERE timestamp::timestamptz < NOW() - INTERVAL '${ORFA_PURGA}'`,
    );
    if (p.rowCount) logger.warn("varredura-fila", `purgadas ${p.rowCount} mensagem(ns) morta(s) (>${ORFA_PURGA}) da fila`);
  } catch (e) {
    logger.error("varredura-fila", "erro na purga:", e);
  }

  // Reprocessa órfãs dentro da janela de recuperação
  let telefones: string[] = [];
  try {
    const r = await pool.query<{ telefone: string }>(
      `SELECT DISTINCT telefone FROM n8n_fila_mensagens
       WHERE timestamp::timestamptz < NOW() - INTERVAL '${ORFA_MIN}'
         AND timestamp::timestamptz > NOW() - INTERVAL '${ORFA_MAX}'`,
    );
    telefones = r.rows.map((x) => x.telefone);
  } catch (e) {
    logger.error("varredura-fila", "erro ao buscar mensagens órfãs:", e);
    return;
  }
  if (telefones.length === 0) return;
  logger.warn("varredura-fila", `${telefones.length} conversa(s) com mensagem órfã na fila, reprocessando:`, telefones);
  for (const tel of telefones) {
    try {
      await reprocessarTelefone(tel);
    } catch (e) {
      logger.error("varredura-fila", `erro reprocessando ${tel}:`, e);
    }
  }
}

async function reprocessarTelefone(telefone: string): Promise<void> {
  // Coleta o conteúdo órfão da fila deste telefone
  const fila = await pool.query<MsgFila>(
    "SELECT id_mensagem, mensagem FROM n8n_fila_mensagens WHERE telefone = $1 ORDER BY id",
    [telefone],
  );
  if (fila.rows.length === 0) return; // já foi processada nesse meio tempo
  const idMensagem = fila.rows[fila.rows.length - 1]!.id_mensagem;
  const conteudo = fila.rows.map((r) => r.mensagem).join("\n");

  // Localiza a conversa do lead no Chatwoot
  const contato = await buscarContatoPorQuery(CONTA, telefone);
  if (!contato) {
    logger.warn("varredura-fila", `contato não encontrado p/ ${telefone}, limpando fila`);
    await limparFila(telefone);
    return;
  }
  const convs = await buscarConversasDoContato(CONTA, contato.id);
  const conv = convs.find((c) => Number(c.inbox_id) === Number(INBOX)) ?? convs[0];
  if (!conv) {
    logger.warn("varredura-fila", `conversa não encontrada p/ ${telefone}, limpando fila`);
    await limparFila(telefone);
    return;
  }
  const full = (await buscarConversa(CONTA, conv.id)) as {
    meta?: { sender?: { id?: number; name?: string; custom_attributes?: Record<string, unknown> } };
    kanban_task?: Record<string, unknown>;
    kanban_board?: Record<string, unknown>;
    labels?: string[];
    inbox_id?: number;
    custom_attributes?: Record<string, unknown>;
  };
  const labels = full?.labels ?? [];
  if (!labels.includes("agente-on")) {
    // Humano assumiu (ou lead perdido): não reprocessa, só limpa a fila órfã
    logger.info("varredura-fila", `${telefone} sem agente-on, limpando fila sem reprocessar`);
    await limparFila(telefone);
    return;
  }

  const sender = full?.meta?.sender ?? {};
  const tarefa = full?.kanban_task ?? {};
  const dadosFormulario = await buscarDadosFormulario(telefone);
  // Limpa a fila antes de reinvocar: o grafo re-enfileira o conteúdo uma vez (evita duplicar).
  await limparFila(telefone);

  const thread = `${telefone}_${idMensagem}_sweep`;
  const g = await obterGrafo();
  logger.warn("varredura-fila", `reprocessando ${telefone} (conv ${conv.id}, msg ${idMensagem})`);
  try {
    await g.invoke(
      {
        messages: [],
        idMensagem, idMensagemReferenciada: null,
        idConta: CONTA, idConversa: String(conv.id), idContato: String(sender.id ?? contato.id), idInbox: String(full?.inbox_id ?? INBOX),
        telefone, nome: sender.name ?? "", mensagem: conteudo, mensagemDeAudio: false,
        timestamp: new Date().toISOString(), tipoArquivo: null, idAnexo: null, urlArquivo: null,
        etiquetas: labels, atributosContato: sender.custom_attributes ?? {}, atributosConversa: "",
        dadosFormulario, tarefa, funil: full?.kanban_board ?? {},
        mensagemProcessada: conteudo, mensagemReferenciada: null, mensagensAgregadas: "",
        stale: false, lockTentativas: 0, locked: false, erroFatal: false,
        outputAgente: "", novasMensagens: false, respostaFormatada: "", ssml: "", audioBuffer: null,
      },
      { configurable: { thread_id: thread } },
    );
  } finally {
    try {
      await pool.query("DELETE FROM checkpoints WHERE thread_id = $1", [thread]);
      await pool.query("DELETE FROM checkpoint_blobs WHERE thread_id = $1", [thread]);
      await pool.query("DELETE FROM checkpoint_writes WHERE thread_id = $1", [thread]);
    } catch { /* noop */ }
  }
}

export function iniciarVarreduraFilaOrfa(intervaloMs = 3 * 60 * 1000): void {
  logger.info("varredura-fila", `varredura de fila órfã ativa (a cada ${Math.round(intervaloMs / 1000)}s, janela ${ORFA_MIN}-${ORFA_MAX}, purga >${ORFA_PURGA})`);
  setInterval(() => {
    void varrerFilaOrfa();
  }, intervaloMs);
}
