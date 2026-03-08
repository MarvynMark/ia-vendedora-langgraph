import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buscarProfissional } from "../config/profissionais.ts";
import { deletarEvento } from "../services/google-calendar.ts";
import { atualizarAtributosConversa } from "../services/chatwoot.ts";
import { logger } from "../lib/logger.ts";

interface ContextoCancelamento {
  idConta: string;
  idConversa: string;
}

export function criarToolCancelarAgendamento(contexto: ContextoCancelamento) {
  return tool(
    async (input) => {
      logger.info("tool:cancelar-agendamento", "Cancelando", {
        profissional: input.idProfissional,
        idEvento: input.idEvento,
        motivo: input.motivoCancelamento,
      });
      const profissional = buscarProfissional(input.idProfissional);
      if (!profissional) {
        return JSON.stringify({ erro: `Profissional "${input.idProfissional}" não encontrado.` });
      }

      try {
        await deletarEvento(profissional.calendarId, input.idEvento);

        if (input.motivoCancelamento) {
          await atualizarAtributosConversa(contexto.idConta, contexto.idConversa, {
            motivo_cancelamento: input.motivoCancelamento,
          });
        }

        logger.info("tool:cancelar-agendamento", "Agendamento cancelado com sucesso");
        return JSON.stringify({ resultado: "AGENDAMENTO CANCELADO" });
      } catch (e) {
        logger.error("tool:cancelar-agendamento", "Erro:", e);
        return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
      }
    },
    {
      name: "Cancelar_agendamento",
      description: "Utilize essa ferramenta para cancelar um agendamento.",
      schema: z.object({
        idProfissional: z.string().describe("Slug do profissional"),
        idEvento: z.string().describe("ID do evento no Google Calendar"),
        motivoCancelamento: z.string().optional().describe("Motivo do cancelamento"),
      }),
    },
  );
}
