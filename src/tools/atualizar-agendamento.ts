import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buscarProfissional } from "../config/profissionais.ts";
import { atualizarEvento } from "../services/google-calendar.ts";
import { logger } from "../lib/logger.ts";

export const atualizarAgendamento = tool(
  async (input) => {
    logger.info("tool:atualizar-agendamento", "Atualizando", {
      profissional: input.idProfissional,
      idEvento: input.idEvento,
      titulo: input.titulo,
    });
    const profissional = buscarProfissional(input.idProfissional);
    if (!profissional) {
      return JSON.stringify({ erro: `Profissional "${input.idProfissional}" não encontrado.` });
    }

    try {
      const evento = await atualizarEvento(profissional.calendarId, input.idEvento, {
        summary: input.titulo,
        description: input.descricao,
      });
      logger.info("tool:atualizar-agendamento", "Agendamento atualizado", { id: evento.id });
      return JSON.stringify(evento);
    } catch (e) {
      logger.error("tool:atualizar-agendamento", "Erro:", e);
      return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
    }
  },
  {
    name: "Atualizar_agendamento",
    description: "Utilize essa ferramenta para atualizar informações no título e descrição do evento.\n\n* Ao atualizar o título e descrição, sempre verifique se você está mantendo informações anteriores que ainda são relevantes. Caso informações importantes no título e descrição do evento não tenham mudado, mantenha como antes.\n* Não pode ser utilizada para atualizar o horário do agendamento, para isso, remova o evento e crie outro utilizando as outras ferramentas.",
    schema: z.object({
      idProfissional: z.string().describe("Slug do profissional"),
      idEvento: z.string().describe("ID do evento no Google Calendar"),
      titulo: z.string().describe("Novo título do evento"),
      descricao: z.string().describe("Nova descrição do evento"),
    }),
  },
);
