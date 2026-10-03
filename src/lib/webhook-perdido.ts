/**
 * Rede de segurança para webhook que o Chatwoot NÃO entregou.
 *
 * 03/10/2026, 09:39–11:55: quatro mensagens de lead nunca chegaram ao /webhook/chatwoot (nem na
 * tabela de dedup, que é a primeira coisa gravada). O servidor estava de pé (o cron da intro rodou
 * às 09:32) e as mensagens estavam no Chatwoot. Anna (conv 9614) respondeu "Estou sim" à
 * apresentação e ficou sem resposta o dia inteiro. As outras redes de segurança (varredura de fila,
 * recuperação de boot) só cobrem mensagem que JÁ entrou no nosso banco.
 *
 * Aqui o Chatwoot é a fonte da verdade: a cada ciclo, as mensagens recebidas nas últimas horas que
 * não estão em mensagens_processadas são reenviadas ao próprio webhook, com o mesmo payload que o
 * Chatwoot mandaria. O webhook decide tudo (agente-on, grupo de espera, reação...), e a dedup dele
 * (reivindicarMensagem) garante que nada é processado duas vezes, mesmo se o Chatwoot entregar o
 * original atrasado.
 */
import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";
import { listarConversasRecentes, listarMensagens } from "../services/chatwoot.ts";

// Só é "perdida" depois de uma folga bem maior que a entrega normal (segundos) e a fila do Sidekiq.
const ESPERA_MIN_S = 5 * 60;
// Mais velha que isso o lead já seguiu a vida e uma resposta do nada soa estranha.
const JANELA_S = 3 * 60 * 60;

interface MensagemChatwoot {
  id: number;
  message_type: number;
  content?: string | null;
  content_attributes?: Record<string, unknown> | null;
  created_at: number;
  source_id?: string | null;
  private?: boolean;
  attachments?: Array<Record<string, unknown>>;
  sender?: { id: number; name: string; phone_number?: string; additional_attributes?: Record<string, unknown> };
}

interface ConversaChatwoot {
  id: number;
  labels?: string[];
  inbox_id?: number;
  status?: string;
}

/** Mensagens do lead dentro da janela de recuperação que o webhook nunca registrou. */
export function selecionarPerdidas(
  mensagens: MensagemChatwoot[],
  registradas: Set<string>,
  agoraUnix: number,
): MensagemChatwoot[] {
  return mensagens.filter(
    (m) =>
      m.message_type === 0 &&
      !m.private &&
      m.created_at <= agoraUnix - ESPERA_MIN_S &&
      m.created_at >= agoraUnix - JANELA_S &&
      !registradas.has(String(m.id)),
  );
}

/** O payload de "message_created" que o Chatwoot teria mandado para esta mensagem. */
export function montarPayloadWebhook(conversa: ConversaChatwoot, m: MensagemChatwoot, idConta: number) {
  const sender = m.sender ?? { id: 0, name: "" };
  return {
    event: "message_created",
    id: m.id,
    content: m.content ?? null,
    message_type: "incoming",
    content_type: "text",
    content_attributes: m.content_attributes ?? {},
    created_at: m.created_at,
    source_id: m.source_id ?? null,
    private: false,
    attachments: m.attachments ?? [],
    account: { id: idConta },
    sender: { ...sender, type: "contact" },
    conversation: {
      id: conversa.id,
      labels: conversa.labels ?? [],
      inbox_id: conversa.inbox_id ?? Number(env.CHATWOOT_INBOX_ID),
      status: conversa.status,
      contact_inbox: { contact_id: sender.id, source_id: sender.phone_number?.replace("+", "") },
    },
  };
}

let emExecucao = false;

export async function recuperarWebhooksPerdidos(): Promise<void> {
  if (emExecucao) return;
  emExecucao = true;
  try {
    const agora = Math.floor(Date.now() / 1000);
    const conversas = await listarConversasRecentes(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_INBOX_ID, agora - JANELA_S);
    for (const conversa of conversas as unknown as ConversaChatwoot[]) {
      try {
        const data = await listarMensagens(env.CHATWOOT_ACCOUNT_ID, conversa.id) as { payload?: MensagemChatwoot[] };
        const candidatas = (data.payload ?? []).filter((m) => m.message_type === 0);
        if (candidatas.length === 0) continue;
        const r = await pool.query<{ id_mensagem: string }>(
          `SELECT id_mensagem FROM mensagens_processadas WHERE id_mensagem = ANY($1)`,
          [candidatas.map((m) => String(m.id))],
        );
        const perdidas = selecionarPerdidas(candidatas, new Set(r.rows.map((x) => x.id_mensagem)), agora);
        // Em ordem: mensagens picadas do mesmo lead caem juntas no debounce do grafo.
        for (const m of perdidas.sort((a, b) => a.created_at - b.created_at)) {
          logger.warn("webhook-perdido", `Mensagem ${m.id} (conv ${conversa.id}) nunca chegou ao webhook — reenviando`, {
            conteudo: (m.content ?? "").slice(0, 80),
            minutosAtras: Math.round((agora - m.created_at) / 60),
          });
          const res = await fetch(`http://localhost:${env.PORT}/webhook/chatwoot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(montarPayloadWebhook(conversa, m, Number(env.CHATWOOT_ACCOUNT_ID))),
          });
          if (!res.ok) logger.error("webhook-perdido", `Reenvio da mensagem ${m.id} falhou (${res.status})`);
        }
      } catch (e) {
        logger.warn("webhook-perdido", `Erro ao conferir conversa ${conversa.id}:`, e);
      }
    }
  } catch (e) {
    logger.error("webhook-perdido", "Erro na varredura de webhooks perdidos:", e);
  } finally {
    emExecucao = false;
  }
}
