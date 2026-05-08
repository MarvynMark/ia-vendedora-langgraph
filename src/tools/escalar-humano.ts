import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { removerEtiquetas, enviarMensagem } from "../services/chatwoot.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

interface ContextoEscalarHumano {
  telefone: string;
  nome: string;
  idConta: string;
  idConversa: string;
  idInbox: string;
  ultimaMensagem: string;
}

export function criarToolEscalarHumano(contexto: ContextoEscalarHumano) {
  return tool(
    async (input) => {
      try {
        await removerEtiquetas(contexto.idConta, contexto.idConversa, ["agente-on"]);
      } catch (e) {
        logger.error("tool:escalar-humano", "Erro ao remover label:", e);
      }

      try {
        const nomeDisplay = contexto.nome || "(usuario nao cadastrado)";
        const mensagemAlerta = `Assistente desabilitado para o usuario ${nomeDisplay} (${contexto.telefone}).\n\n*Ultima mensagem*:\n\n"${contexto.ultimaMensagem}"\n\n*Resumo da conversa*:\n\n"${input.resumoConversa}"`;
        await enviarMensagem(
          env.CHATWOOT_ACCOUNT_ID,
          env.CHATWOOT_ALERT_CONVERSATION_ID,
          mensagemAlerta,
        );
      } catch (e) {
        logger.warn("tool:escalar-humano", "Erro ao enviar alerta (escalação já executada):", e);
      }

      return JSON.stringify({ resultado: "ok" });
    },
    {
      name: "Escalar_humano",
      description:
        "Utilize essa ferramenta para direcionar o atendimento para o gestor responsável.",
      schema: z.object({
        resumoConversa: z.string().describe("Um breve resumo com pontos chave da conversa"),
      }),
    },
  );
}
