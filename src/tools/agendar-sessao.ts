import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  agendaConfigurada,
  buscarAgendas,
  criarSessao,
  buscarSessaoDoTelefone,
  moverSessao,
  cancelarSessao,
} from "../services/google-calendar.ts";
import { slotsLivres, quemAtende } from "../lib/disponibilidade.ts";
import { DIAS_A_FRENTE, PRAZO_REMARCACAO_H, classificarPreferencia, rotularDia, rotularHora, type Preferencia } from "../config/agenda.ts";
import { logger } from "../lib/logger.ts";

const DIA_MS = 24 * 60 * 60 * 1000;

interface ContextoAgenda {
  idConta: string;
  idConversa: string;
  telefone: string;
  nome: string;
  concurso?: string;
}

// A IA devolve o horário escolhido como ISO. Poderia guardar a oferta no banco (é o que a Theodoro
// faz), mas não precisa: `quemAtende` refaz a checagem contra a grade E contra a agenda antes de
// criar. ISO inventado por alucinação não passa na grade; horário tomado no meio-tempo não passa na
// agenda. A trava está no lugar certo — no momento de escrever, não no de lembrar.
const esquema = z.object({
  acao: z.enum(["sugerir", "confirmar", "remarcar", "cancelar"])
    .describe("sugerir = pedir dois horários; confirmar = marcar o que o lead escolheu; remarcar = trocar; cancelar = desmarcar"),
  periodo: z.string().optional()
    .describe("O que o lead respondeu sobre o período: 'manhã', 'tarde', 'noite' ou 'tanto faz'. Só para 'sugerir' e 'remarcar'."),
  inicio_iso: z.string().optional()
    .describe("O horário escolhido pelo lead, EXATAMENTE como veio no campo 'iso' da sugestão. Para 'confirmar' e 'remarcar'."),
});

export function criarToolAgendarSessao(ctx: ContextoAgenda) {
  return tool(
    async ({ acao, periodo, inicio_iso }) => {
      if (!agendaConfigurada()) {
        logger.error("agendar-sessao", "Agenda não configurada — a IA não pode prometer horário");
        return "AGENDA_INDISPONIVEL: não foi possível consultar os horários agora. Não invente horário. Diga ao lead que você já volta com as opções e use Escalar_humano.";
      }

      const agora = new Date();
      const pref: Preferencia = classificarPreferencia(periodo ?? "") ?? "qualquer";

      try {
        // TRAVA DO COMPROMISSO — vale para cancelar E remarcar.
        // Dentro do prazo, a IA resolve sozinha. Fora dele, ela NÃO decide: escala. Conceder a
        // exceção sozinha esvaziaria a regra que faz o lead aparecer; negá-la sozinha jogaria fora
        // uma venda que uma pessoa recuperaria. Quem decide exceção é gente.
        if (acao === "cancelar" || acao === "remarcar") {
          const achado = await buscarSessaoDoTelefone(ctx.telefone, agora);
          if (!achado) {
            if (acao === "cancelar") return "Não havia sessão futura marcada para este lead.";
          } else {
            const inicioSessao = new Date(achado.evento.start?.dateTime ?? achado.evento.start?.date ?? 0);
            const horasAteSessao = (inicioSessao.getTime() - agora.getTime()) / 3_600_000;
            if (horasAteSessao < PRAZO_REMARCACAO_H) {
              logger.warn("agendar-sessao", `${acao} fora do prazo (${horasAteSessao.toFixed(1)}h) — escalando`, { telefone: ctx.telefone });
              return [
                `FORA DO PRAZO: faltam ${horasAteSessao.toFixed(1)}h para a sessão e o combinado é avisar com ${PRAZO_REMARCACAO_H}h de antecedência.`,
                "Você NÃO pode remarcar nem cancelar agora, e NÃO prometa que vai remarcar.",
                "Reconheça o que ele disse, lembre em UMA frase que a vaga foi reservada só pra ele,",
                "diga que vai ver o que dá pra fazer — e use Escalar_humano AGORA. Quem decide isso é uma pessoa.",
              ].join("\n");
            }
          }
          if (acao === "cancelar" && achado) {
            await cancelarSessao(achado.calendarId, achado.evento.id!);
            return "Sessão cancelada dentro do prazo. Pergunte se ele quer já deixar outro horário marcado.";
          }
        }

        const agendas = await buscarAgendas(agora, new Date(agora.getTime() + DIAS_A_FRENTE * DIA_MS));

        if (acao === "sugerir" || (acao === "remarcar" && !inicio_iso)) {
          const slots = slotsLivres(agendas, { agora, preferencia: pref });
          if (slots.length === 0) {
            return pref === "qualquer"
              ? "SEM VAGA nos próximos dias. Seja honesto com o lead e use Escalar_humano."
              : `SEM VAGA no período '${pref}'. Diga isso com honestidade e pergunte se outro período serve.`;
          }
          const linhas = slots.map((s) => `- ${rotularDia(s.inicio)} às ${rotularHora(s.inicio)} | iso: ${s.inicio.toISOString()}`);
          return [
            `Horários livres${pref !== "qualquer" ? ` (${pref})` : ""}:`,
            ...linhas,
            "",
            "Ofereça ESTES DOIS ao lead, com dia e hora em português (ex.: 'quinta às 19h').",
            "NÃO mostre o 'iso' ao lead — ele é só para você devolver em 'confirmar'.",
            "NUNCA ofereça horário que não esteja nesta lista.",
          ].join("\n");
        }

        // confirmar / remarcar com horário escolhido
        if (!inicio_iso) return "Faltou o inicio_iso do horário escolhido.";
        const inicio = new Date(inicio_iso);
        if (Number.isNaN(inicio.getTime())) return "inicio_iso inválido. Peça a sugestão de novo com acao='sugerir'.";

        const dono = quemAtende(inicio, agendas, agora);
        if (!dono) {
          return "ESSE HORÁRIO NÃO ESTÁ MAIS DISPONÍVEL. Não insista nele: peça novos horários com acao='sugerir' e ofereça os que voltarem.";
        }

        if (acao === "remarcar") {
          const achado = await buscarSessaoDoTelefone(ctx.telefone, agora);
          if (achado) {
            await moverSessao(achado.calendarId, achado.evento.id!, inicio);
            const link = achado.evento.hangoutLink ?? "";
            return `Sessão remarcada para ${rotularDia(inicio)} às ${rotularHora(inicio)}.${link ? ` Link: ${link}` : ""} Confirme com o lead e mande o link.`;
          }
        }

        const { meet } = await criarSessao({
          inicio,
          calendarId: dono.calendarId,
          nomeLead: ctx.nome,
          telefone: ctx.telefone,
          ...(ctx.concurso ? { concurso: ctx.concurso } : {}),
          idConversa: ctx.idConversa,
        });

        return [
          `Sessão marcada para ${rotularDia(inicio)} às ${rotularHora(inicio)}.`,
          meet ? `Link da reunião: ${meet}` : "ATENÇÃO: o link da reunião não foi gerado — use Escalar_humano.",
          "Confirme com o lead, mande o link e mova o card para 'Sessão agendada' com Atualizar_tarefa.",
          "NÃO diga ao lead quem vai atender.",
        ].join("\n");
      } catch (e) {
        logger.error("agendar-sessao", `Falha em '${acao}'`, e);
        return "Não consegui falar com a agenda agora. NÃO invente horário nem prometa prazo. Diga que já volta com as opções e use Escalar_humano.";
      }
    },
    {
      name: "Agendar_sessao",
      description:
        "Consulta a agenda real e marca a sessão estratégica. Use 'sugerir' depois que o lead disser o período (manhã/tarde/noite) para receber DOIS horários livres; 'confirmar' quando ele escolher um; 'remarcar' se ele não puder mais; 'cancelar' se desistir. Os horários vêm SEMPRE daqui — nunca da sua cabeça.",
      schema: esquema,
    },
  );
}
