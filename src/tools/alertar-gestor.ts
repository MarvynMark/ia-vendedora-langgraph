import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarMensagem } from "../services/chatwoot.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

interface ContextoAlertarGestor {
  telefone: string;
  nome: string;
  idConta: string;
  idConversa: string;
  ultimaMensagem: string;
}

// Alerta o gestor sobre um lead QUENTE (quase certo) SEM pausar a IA — diferente do Escalar_humano,
// aqui a IA CONTINUA conduzindo o atendimento. Cria uma nota privada na conversa do lead (só a
// equipe vê) e avisa no grupo de alertas. Objetivo: nenhuma venda quase fechada esfriar por
// promessa de retorno esquecida (as ~10 "vendas quase certas" do diagnóstico morriam justamente aí).
export function criarToolAlertarGestor(contexto: ContextoAlertarGestor) {
  return tool(
    async (input: { motivo: string }) => {
      const nomeDisplay = contexto.nome || "(sem nome)";

      // 1. Nota PRIVADA na conversa do lead (visível só para a equipe, nunca para o lead).
      try {
        const nota = `⭐ *Lead quente — acompanhar de perto*\n\n*Situação*: ${input.motivo}\n\n*Última mensagem do lead*:\n"${contexto.ultimaMensagem}"`;
        await enviarMensagem(contexto.idConta, contexto.idConversa, nota, { private: true });
      } catch (e) {
        logger.warn("tool:alertar-gestor", "Erro ao criar nota privada:", e);
      }

      // 2. Alerta no grupo interno (conversa de alertas).
      try {
        const alerta = `⭐ *Lead quente* — ${nomeDisplay} (${contexto.telefone})\n\n${input.motivo}\n\n*Última mensagem*:\n"${contexto.ultimaMensagem}"`;
        await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_ALERT_CONVERSATION_ID, alerta);
      } catch (e) {
        logger.warn("tool:alertar-gestor", "Erro ao enviar alerta (nota privada já criada):", e);
      }

      return JSON.stringify({ resultado: "ok" });
    },
    {
      name: "Alertar_gestor",
      description:
        "Avisa o gestor sobre um lead QUENTE / quase fechado, SEM pausar seu atendimento (você CONTINUA conduzindo normalmente). Cria uma nota privada no lead e um alerta no grupo interno. Use quando um lead que estava perto de fechar combinar um retorno com data ('te chamo dia 10'), ou travar só no valor no fim da conversa — pra ninguém deixar essa venda quase certa esfriar. NÃO use para dúvidas comuns; só para leads realmente quentes.",
      schema: z.object({
        motivo: z
          .string()
          .describe("Por que o lead é quente e o que ficou combinado (ex.: 'ia pagar dia 10, travou só na virada do cartão')"),
      }),
    },
  );
}
