import { enviarMensagem, reabrirConversa, listarMensagens } from "./chatwoot.ts";
import { situacaoEntrega } from "../lib/entrega-aviso.ts";
import { logger } from "../lib/logger.ts";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia um aviso ao grupo (conversa Baileys) e confere a entrega: se o WhatsApp recusar
 * (status "failed"), reenvia. Ordem importa: enviar primeiro (Baileys enfileira), depois reabrir
 * (Baileys entrega as pendentes ao reabrir) — inverter causa falha.
 *
 * A 1ª tentativa é aguardada (erro HTTP sobe para o chamador); a conferência e os reenvios rodam
 * em segundo plano, para não atrasar as boas-vindas do aluno.
 */
export async function enviarAvisoGrupo(
  accountId: string | number,
  conversationId: string | number,
  texto: string,
  opcoes: { esperaMs?: number; reenvios?: number } = {},
): Promise<void> {
  const { esperaMs = 30_000, reenvios = 2 } = opcoes;

  const enviarEReabrir = async (): Promise<number | undefined> => {
    const msg = (await enviarMensagem(accountId, conversationId, texto)) as { id?: number };
    try {
      await reabrirConversa(accountId, conversationId);
    } catch (e) {
      logger.warn("aviso-grupo", "Falha ao reabrir conversa do grupo:", e);
    }
    return msg?.id;
  };

  const primeiroId = await enviarEReabrir();

  void (async () => {
    let id = primeiroId;
    for (let tentativa = 1; tentativa <= reenvios && id !== undefined; tentativa++) {
      await esperar(esperaMs);
      try {
        const lista = (await listarMensagens(accountId, conversationId)) as {
          payload?: Array<{ id: number; status?: string | null }>;
        };
        if (situacaoEntrega(lista.payload ?? [], id) !== "falhou") return;
        logger.warn("aviso-grupo", "WhatsApp recusou o aviso do grupo — reenviando", { idMensagem: id, tentativa });
        id = await enviarEReabrir();
      } catch (e) {
        logger.error("aviso-grupo", "Erro ao conferir/reenviar aviso do grupo:", e);
        return;
      }
    }
  })();
}
