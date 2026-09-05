import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { removerEtiquetas, enviarMensagem, avisarGrupo } from "../services/chatwoot.ts";
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

/**
 * A escalação em si, fora do wrapper de tool: pausa a IA, deixa a nota privada e avisa o
 * comercial. Extraída porque um GUARD do grafo também precisa escalar sem passar pelo LLM — a
 * conferência de forma de pagamento pausa o atendimento quando a IA prometeu parcelado num plano
 * que só tem link de cartão (ver graph.ts). Continua SILENCIOSA: o lead nunca é avisado.
 */
export async function escalarParaHumano(
  contexto: ContextoEscalarHumano,
  resumoConversa: string,
): Promise<void> {
  // 1. Pausa a IA nesta conversa (remove a label agente-on). Ação silenciosa: o lead
  //    NÃO recebe nenhum aviso de que foi encaminhado para um humano.
  try {
    await removerEtiquetas(contexto.idConta, contexto.idConversa, ["agente-on"]);
  } catch (e) {
    logger.error("tool:escalar-humano", "Erro ao remover label:", e);
  }

  const nomeDisplay = contexto.nome || "(usuario nao cadastrado)";

  // 2. Nota PRIVADA na própria conversa do lead (visível só para a equipe, nunca para o lead):
  //    relata o motivo/resumo para quem assumir o atendimento.
  try {
    const notaPrivada = `🔔 *Atendimento pausado — encaminhado para atendimento humano*\n\n*Motivo / resumo*:\n${resumoConversa}\n\n*Última mensagem do lead*:\n"${contexto.ultimaMensagem}"`;
    await enviarMensagem(contexto.idConta, contexto.idConversa, notaPrivada, { private: true });
  } catch (e) {
    logger.warn("tool:escalar-humano", "Erro ao criar nota privada:", e);
  }

  // 3. Alerta no grupo do COMERCIAL (é aviso sobre lead, não sobre venda nem edital).
  //    Ganhou o deep link que só o Alertar_gestor tinha: sem ele, quem lê no WhatsApp tem que
  //    caçar a conversa pelo nome.
  try {
    const link = `${env.CHATWOOT_BASE_URL}/app/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations/${contexto.idConversa}`;
    const mensagemAlerta = `🔔 *IA pausada* — ${nomeDisplay} (${contexto.telefone})\n\n*Ultima mensagem*:\n\n"${contexto.ultimaMensagem}"\n\n*Resumo da conversa*:\n\n"${resumoConversa}"\n\n👉 ${link}`;
    await avisarGrupo(env.CHATWOOT_COMERCIAL_CONVERSATION_ID, mensagemAlerta);
  } catch (e) {
    logger.warn("tool:escalar-humano", "Erro ao enviar alerta (escalação já executada):", e);
  }
}

export function criarToolEscalarHumano(contexto: ContextoEscalarHumano) {
  return tool(
    async (input) => {
      await escalarParaHumano(contexto, input.resumoConversa);
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
