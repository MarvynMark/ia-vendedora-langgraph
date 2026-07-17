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
import { buscarContatoPorQuery, buscarConversasDoContato, buscarConversa, listarMensagens } from "../services/chatwoot.ts";
import { buscarDadosFormulario } from "../db/formulario.ts";
import { limparFila, enfileirarMensagem } from "../db/fila.ts";
import { liberarLock } from "../db/lock.ts";
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

/**
 * Rede de segurança de BOOT: recupera conversas travadas por lock preso.
 *
 * Cobre o gap que a varredura de fila NÃO pega: quando o processo morre DEPOIS de
 * consumir a mensagem da fila mas ANTES de responder (janela ampliada por um redeploy),
 * a mensagem do lead vira uma órfã "invisível" — não está na fila, mas o lead ficou sem
 * resposta e o lock ficou preso. Foi o que travou a conversa 4304.
 *
 * Roda uma vez na subida do app: para cada lock preso além do TTL, se a conversa ainda é
 * da IA (agente-on) e a ÚLTIMA mensagem é do lead (sem resposta posterior do agente),
 * reenfileira e reprocessa pelo caminho testado. Caso contrário, apenas libera o lock.
 */
export async function recuperarConversasTravadasNoBoot(): Promise<void> {
  let sessions: string[] = [];
  try {
    const r = await pool.query<{ session_id: string }>(
      `SELECT session_id FROM n8n_status_atendimento
       WHERE lock_conversa = true
         AND updated_at < NOW() - INTERVAL '1 minute' * $1`,
      [env.LOCK_TTL_MINUTES],
    );
    sessions = r.rows.map((x) => x.session_id);
  } catch (e) {
    logger.error("recuperacao-boot", "erro ao buscar locks presos:", e);
    return;
  }
  if (sessions.length === 0) {
    logger.info("recuperacao-boot", "nenhum lock preso além do TTL no boot");
    return;
  }
  logger.warn("recuperacao-boot", `${sessions.length} lock(s) preso(s) além do TTL — avaliando:`, sessions);
  for (const sessionId of sessions) {
    try {
      await recuperarLockPreso(sessionId);
    } catch (e) {
      logger.error("recuperacao-boot", `erro ao recuperar ${sessionId}:`, e);
    }
  }
}

async function recuperarLockPreso(sessionId: string): Promise<void> {
  // session_id do agente principal = `${inbox}_${telefone}` (telefone em E.164, começa com "+").
  // Locks de outra natureza (ex.: "pagamento:...") não têm esse formato — só liberamos.
  const idx = sessionId.indexOf("_");
  const telefone = idx >= 0 ? sessionId.slice(idx + 1) : "";
  if (!telefone.startsWith("+")) {
    await liberarLock(sessionId);
    logger.info("recuperacao-boot", `lock não-conversa liberado: ${sessionId}`);
    return;
  }

  const contato = await buscarContatoPorQuery(CONTA, telefone);
  if (!contato) {
    await liberarLock(sessionId);
    return;
  }
  const convs = await buscarConversasDoContato(CONTA, contato.id);
  const conv = convs.find((c) => Number(c.inbox_id) === Number(INBOX)) ?? convs[0];
  if (!conv) {
    await liberarLock(sessionId);
    return;
  }
  const full = (await buscarConversa(CONTA, conv.id)) as { labels?: string[] };
  if (!(full?.labels ?? []).includes("agente-on")) {
    // Humano assumiu ou lead perdido — nada a reprocessar, só destrava.
    await liberarLock(sessionId);
    logger.info("recuperacao-boot", `${telefone}: sem agente-on, lock liberado sem reprocessar`);
    return;
  }

  // Última mensagem de conversa (só incoming=0 / outgoing=1). Se for do lead, ficou sem resposta.
  const resp = (await listarMensagens(CONTA, conv.id)) as {
    payload?: Array<{ message_type: number; content?: string; id: number }>;
  };
  const dialogo = (resp.payload ?? []).filter((m) => m.message_type === 0 || m.message_type === 1);
  const ultima = dialogo[dialogo.length - 1];
  if (!ultima || ultima.message_type !== 0 || !(ultima.content ?? "").trim()) {
    // Última é do agente (já respondeu) ou vazia — nada pendente. Só destrava.
    await liberarLock(sessionId);
    logger.info("recuperacao-boot", `${telefone}: sem mensagem pendente do lead, lock liberado`);
    return;
  }

  // Há mensagem do lead sem resposta → reprocessar pelo caminho testado.
  const conteudo = (ultima.content ?? "").trim();
  logger.warn("recuperacao-boot", `${telefone}: mensagem do lead sem resposta ("${conteudo.slice(0, 60)}") — reprocessando`);
  await liberarLock(sessionId); // o grafo readquire o lock ao reprocessar
  await enfileirarMensagem(String(ultima.id), telefone, conteudo, new Date().toISOString());
  await reprocessarTelefone(telefone);
}

export function iniciarVarreduraFilaOrfa(intervaloMs = 3 * 60 * 1000): void {
  logger.info("varredura-fila", `varredura de fila órfã ativa (a cada ${Math.round(intervaloMs / 1000)}s, janela ${ORFA_MIN}-${ORFA_MAX}, purga >${ORFA_PURGA})`);
  setInterval(() => {
    void varrerFilaOrfa();
  }, intervaloMs);
}
