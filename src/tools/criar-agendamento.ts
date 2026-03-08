import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buscarProfissional } from "../config/profissionais.ts";
import { listarEventos, criarEvento } from "../services/google-calendar.ts";
import { atualizarContato } from "../services/chatwoot.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

interface ContextoCriarAgendamento {
  idConta: string;
  idContato: string;
  telefone: string;
}

export function criarToolCriarAgendamento(contexto: ContextoCriarAgendamento) {
  return tool(
    async (input) => {
      logger.info("tool:criar-agendamento", "Criando agendamento", {
        profissional: input.idProfissional,
        inicio: input.eventoInicio,
        duracao: input.duracaoMinutos,
        titulo: input.titulo,
      });
      const profissional = buscarProfissional(input.idProfissional);
      if (!profissional) {
        return JSON.stringify({ erro: `Profissional "${input.idProfissional}" não encontrado.` });
      }

      const eventoInicio = new Date(input.eventoInicio);
      const eventoFim = new Date(eventoInicio.getTime() + input.duracaoMinutos * 60000);

      // Verificar disponibilidade
      const eventos = await listarEventos(
        profissional.calendarId,
        eventoInicio.toISOString(),
        eventoFim.toISOString(),
      );

      const temConflito = eventos.some((ev) => {
        const evInicio = new Date(ev.start?.dateTime ?? ev.start?.date ?? "");
        const evFim = new Date(ev.end?.dateTime ?? ev.end?.date ?? "");
        return eventoInicio < evFim && eventoFim > evInicio;
      });

      if (temConflito) {
        return JSON.stringify({
          erro: "HORÁRIO INDISPONÍVEL. Verifique os horários disponíveis antes de tentar criar o agendamento.",
        });
      }

      // Criar evento no Google Calendar
      const descricaoCompleta = `${input.descricao}\n\nTelefone: ${contexto.telefone}`;

      try {
        const eventoCriado = await criarEvento(profissional.calendarId, {
          summary: input.titulo,
          description: descricaoCompleta,
          start: { dateTime: eventoInicio.toISOString(), timeZone: env.TZ },
          end: { dateTime: eventoFim.toISOString(), timeZone: env.TZ },
        });

        // Atualizar data_ultima_consulta no contato
        try {
          await atualizarContato(contexto.idConta, contexto.idContato, {
            data_ultima_consulta: eventoInicio.toISOString().split("T")[0],
          });
        } catch (e) {
          logger.error("tool:criar-agendamento", "Erro ao atualizar contato:", e);
        }

        logger.info("tool:criar-agendamento", "Agendamento criado", { id: eventoCriado.id });
        return JSON.stringify({
          resultado: "AGENDAMENTO CRIADO",
          id_evento: eventoCriado.id,
          evento: eventoCriado,
        });
      } catch (e) {
        return JSON.stringify({ erro: "Erro ao criar agendamento: " + (e as Error).message });
      }
    },
    {
      name: "Criar_agendamento",
      description:
        "Utilize essa ferramenta para criar um agendamento no horário especificado, com duração do evento conforme já especificado nas instruções gerais.\n\nSempre verifique se já não chamou essa ferramenta antes de chamá-la.\n\n**NUNCA CHAME ESSA FERRAMENTA MAIS DE UMA VEZ PARA O MESMO AGENDAMENTO.**",
      schema: z.object({
        eventoInicio: z.string().describe("Data e horário no futuro. Formato: YYYY-MM-DDThh:mm:ssTZD"),
        duracaoMinutos: z.number().describe("Duração do evento em minutos"),
        titulo: z.string().describe("Nome completo do paciente"),
        descricao: z.string().describe("Descrição do agendamento"),
        idProfissional: z.string().describe("Slug do profissional"),
      }),
    },
  );
}
