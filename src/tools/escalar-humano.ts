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
        // Remove "agente-on" para desativar o agente na conversa
        await removerEtiquetas(contexto.idConta, contexto.idConversa, ["agente-on"]);

        // Enviar alerta na conversa de alerta
        const nomeDisplay = contexto.nome || "(usuario nao cadastrado)";
        const mensagemAlerta = `Assistente desabilitado para o usuario ${nomeDisplay} (${contexto.telefone}).\n\n*Ultima mensagem*:\n\n"${contexto.ultimaMensagem}"\n\n*Resumo da conversa*:\n\n"${input.resumoConversa}"`;

        await enviarMensagem(
          env.CHATWOOT_ACCOUNT_ID,
          env.CHATWOOT_ALERT_CONVERSATION_ID,
          mensagemAlerta,
        );

        return JSON.stringify({ resultado: "Atendimento escalado para humano." });
      } catch (e) {
        logger.error("tool:escalar-humano", "Erro:", e);
        return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
      }
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
