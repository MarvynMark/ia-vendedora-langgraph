import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { profissionais } from "../config/profissionais.ts";
import { buscarEventosPorQuery } from "../services/google-calendar.ts";
import { logger } from "../lib/logger.ts";

interface ContextoBuscarAgendamentos {
  telefone: string;
}

export function criarToolBuscarAgendamentos(contexto: ContextoBuscarAgendamentos) {
  return tool(
    async (_input) => {
      logger.info("tool:buscar-agendamentos", "Buscando agendamentos para:", contexto.telefone);
      try {
        const todosEventos: Array<{ profissional: string; eventos: unknown[] }> = [];

        for (const prof of Object.values(profissionais)) {
          const eventos = await buscarEventosPorQuery(
            prof.calendarId,
            contexto.telefone,
          );
          logger.info("tool:buscar-agendamentos", `${prof.nome}: ${eventos.length} eventos`);
          if (eventos.length > 0) {
            todosEventos.push({ profissional: prof.nome, eventos });
          }
        }

        if (todosEventos.length === 0) {
          logger.info("tool:buscar-agendamentos", "Nenhum agendamento encontrado");
          return JSON.stringify({ resultado: "Nenhum agendamento encontrado para este contato." });
        }

        logger.info("tool:buscar-agendamentos", `Total: ${todosEventos.length} profissionais com agendamentos`);
        return JSON.stringify(todosEventos);
      } catch (e) {
        logger.error("tool:buscar-agendamentos", "Erro:", e);
        return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
      }
    },
    {
      name: "Buscar_agendamentos_do_contato",
      description: "Utilize essa ferramenta para buscar os agendamentos já existentes para o contato atual. Busca em todas as agendas dos profissionais. Utilize antes de criar novos agendamentos, para evitar agendamentos duplicados.",
      schema: z.object({}),
    },
  );
}
