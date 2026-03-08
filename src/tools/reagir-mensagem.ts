import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarMensagem } from "../services/chatwoot.ts";
import { logger } from "../lib/logger.ts";

interface ContextoReagirMensagem {
  idConta: string;
  idInbox: string;
  idConversa: string;
  idMensagem: string;
}

export function criarToolReagirMensagem(contexto: ContextoReagirMensagem) {
  return tool(
    async (input) => {
      try {
        await enviarMensagem(contexto.idConta, contexto.idConversa, input.emoji, {
          is_reaction: true,
          reply_to: contexto.idMensagem,
        });
        return "Reação enviada.";
      } catch (e) {
        logger.error("tool:reagir-mensagem", "Erro:", e);
        return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
      }
    },
    {
      name: "Reagir_mensagem",
      description:
        "Envia uma mensagem de reação como resposta a uma mensagem do usuário. Reação é sempre um emoji.\n\nIgnore a saída dessa ferramenta, ela é a mensagem enviada para o contato.\n\n**NUNCA UTILIZE ESSA FERRAMENTA MÚLTIPLAS VEZES SEGUIDAS**",
      schema: z.object({
        emoji: z.string().describe("Emoji da reação"),
      }),
    },
  );
}
