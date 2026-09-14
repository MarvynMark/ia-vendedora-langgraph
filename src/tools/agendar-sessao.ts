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
import { slotsLivres, quemAtende, slotColide } from "../lib/disponibilidade.ts";
import {
  DIAS_A_FRENTE,
  PRAZO_REMARCACAO_H,
  classificarPreferencia,
  codigoDoHorario,
  lerCodigoDoHorario,
  rotularDia,
  rotularHora,
  type Preferencia,
} from "../config/agenda.ts";
import { logger } from "../lib/logger.ts";
import { RESPOSTA_INELEGIVEL, type MotivoInelegivel } from "../lib/elegibilidade.ts";

const DIA_MS = 24 * 60 * 60 * 1000;

interface ContextoAgenda {
  idConta: string;
  idConversa: string;
  telefone: string;
  nome: string;
  concurso?: string;
  /** Lead barrado da sessão. Decidido no grafo (lib/elegibilidade.ts); aqui só se recusa. */
  bloqueioSessao?: MotivoInelegivel;
}

// A IA devolve o horário escolhido como código de HORA DE PAREDE ("2026-09-14 14:00"), não ISO.
// Poderia guardar a oferta no banco (é o que a Theodoro faz), mas não precisa: `quemAtende` refaz
// a checagem contra a grade E contra a agenda antes de criar. Código inventado por alucinação não
// passa na grade; horário tomado no meio-tempo não passa na agenda.
//
// Por que não ISO: em 11/09 a sugestão dizia "14h | iso: ...T17:00:00.000Z" e o modelo devolveu
// "...T14:00:00.000Z" — passou na grade (11h é slot válido), marcou 11h e disse "14h" ao lead.
// Aconteceu duas vezes no mesmo dia. A trava da grade não pega hora errada que também é livre;
// o que pega é não dar ao modelo nada para converter.
const esquema = z.object({
  acao: z.enum(["sugerir", "confirmar", "remarcar", "cancelar"])
    .describe("sugerir = pedir dois horários; confirmar = marcar o que o lead escolheu; remarcar = trocar; cancelar = desmarcar"),
  periodo: z.string().optional()
    .describe("O que o lead respondeu sobre o período: 'manhã', 'tarde', 'noite' ou 'tanto faz'. Só para 'sugerir' e 'remarcar'."),
  horario: z.string().optional()
    .describe("O horário escolhido pelo lead, copiado EXATAMENTE do campo 'horario' da sugestão (ex.: '2026-09-14 14:00', hora de Brasília). Para 'confirmar' e 'remarcar'."),
});

export function criarToolAgendarSessao(ctx: ContextoAgenda) {
  return tool(
    async ({ acao, periodo, horario }) => {
      // Sem graduação não ocupa a agenda — nem se o lead pedir, nem se o modelo esquecer o gate.
      // 'cancelar' continua liberado: se alguém marcou antes, poder desmarcar é o mínimo.
      if (ctx.bloqueioSessao && acao !== "cancelar") {
        logger.warn("agendar-sessao", `Agendamento recusado: lead inelegível (${ctx.bloqueioSessao})`, { telefone: ctx.telefone });
        return [
          "LEAD INELEGÍVEL PARA A SESSÃO — não ofereça horário nem prometa marcar.",
          "Responda com esta ideia, nas suas palavras, e mova o card para 'Nutrir' com Atualizar_tarefa:",
          RESPOSTA_INELEGIVEL[ctx.bloqueioSessao],
        ].join("\n");
      }

      if (!agendaConfigurada()) {
        logger.error("agendar-sessao", "Agenda não configurada — a IA não pode prometer horário");
        return "AGENDA_INDISPONIVEL: não foi possível consultar os horários agora. Não invente horário. Diga ao lead que você já volta com as opções e use Escalar_humano.";
      }

      const agora = new Date();
      const pref: Preferencia = classificarPreferencia(periodo ?? "") ?? "qualquer";

      try {
        // TRAVA DO COMPROMISSO — vale para cancelar, remarcar E confirmar com sessão já marcada
        // (que é remarcação com outro nome). Dentro do prazo, a IA resolve sozinha. Fora dele, ela
        // NÃO decide: escala. Conceder a exceção sozinha esvaziaria a regra que faz o lead
        // aparecer; negá-la sozinha jogaria fora uma venda que uma pessoa recuperaria. Quem decide
        // exceção é gente.
        let achado: Awaited<ReturnType<typeof buscarSessaoDoTelefone>> = null;
        if (acao !== "sugerir") {
          achado = await buscarSessaoDoTelefone(ctx.telefone, agora);
          if (!achado) {
            if (acao === "cancelar") return "Não havia sessão futura marcada para este lead.";
          } else {
            const inicioSessao = new Date(achado.evento.start?.dateTime ?? achado.evento.start?.date ?? 0);
            const horasAteSessao = (inicioSessao.getTime() - agora.getTime()) / 3_600_000;
            if (horasAteSessao < PRAZO_REMARCACAO_H) {
              // A cadeira sai da agenda MESMO fora do prazo: quem avisou que não vem não vem, e
              // deixar o evento de pé só faz o lembrete de 1h sair e o cron perguntar "compareceu?"
              // (Palloma, conv 7437, 14/09). O que continua sendo decisão humana é a EXCEÇÃO —
              // remarcar sem custo apesar do combinado. Isso a IA não concede.
              await cancelarSessao(achado.calendarId, achado.evento.id!);
              logger.warn("agendar-sessao", `${acao} fora do prazo (${horasAteSessao.toFixed(1)}h) — evento cancelado, escalando`, { telefone: ctx.telefone });
              return [
                `FORA DO PRAZO: faltavam ${horasAteSessao.toFixed(1)}h para a sessão e o combinado é avisar com ${PRAZO_REMARCACAO_H}h de antecedência.`,
                "O horário foi liberado na agenda. Você NÃO pode remarcar agora, e NÃO prometa que vai remarcar.",
                "Reconheça o que ele disse, lembre em UMA frase que a vaga foi reservada só pra ele,",
                "diga que vai ver o que dá pra fazer — e use Escalar_humano AGORA. Quem decide se remarca é uma pessoa.",
              ].join("\n");
            }
          }
          if (acao === "cancelar" && achado) {
            await cancelarSessao(achado.calendarId, achado.evento.id!);
            return "Sessão cancelada dentro do prazo. Pergunte se ele quer já deixar outro horário marcado.";
          }
        }

        const agendas = await buscarAgendas(agora, new Date(agora.getTime() + DIAS_A_FRENTE * DIA_MS));

        if (acao === "sugerir" || (acao === "remarcar" && !horario)) {
          const slots = slotsLivres(agendas, { agora, preferencia: pref });
          if (slots.length === 0) {
            return pref === "qualquer"
              ? "SEM VAGA nos próximos dias. Seja honesto com o lead e use Escalar_humano."
              : `SEM VAGA no período '${pref}'. Diga isso com honestidade e pergunte se outro período serve.`;
          }
          const linhas = slots.map((s) => `- ${rotularDia(s.inicio)} às ${rotularHora(s.inicio)} | horario: ${codigoDoHorario(s.inicio)}`);
          return [
            `Horários livres${pref !== "qualquer" ? ` (${pref})` : ""}:`,
            ...linhas,
            "",
            "Ofereça ESTES DOIS ao lead, com dia e hora em português (ex.: 'quinta às 19h').",
            "NÃO mostre o 'horario' ao lead — ele é só para você devolver em 'confirmar', copiado sem alterar nada.",
            "NUNCA ofereça horário que não esteja nesta lista.",
          ].join("\n");
        }

        // confirmar / remarcar com horário escolhido
        if (!horario) return "Faltou o 'horario' escolhido. Copie o campo 'horario' da sugestão.";
        const inicio = lerCodigoDoHorario(horario);
        if (!inicio) {
          // Formato errado (ISO, hora solta…). Em vez de mandar o modelo "pedir de novo" — que
          // virou "houve um pequeno problema com o horário anterior" na conversa da Ester (7606) —
          // já devolve a lista para ele reconfirmar em silêncio. O lead não precisa saber.
          const lista = slotsLivres(agendas, { agora, preferencia: "qualquer", limite: 12, umPorDia: false });
          return [
            `'horario' inválido ("${horario}"). O código tem que ser copiado EXATAMENTE como está na lista abaixo, sem converter.`,
            "Encontre aqui o horário que o lead escolheu e chame 'confirmar' de novo com o código dele:",
            ...lista.map((s) => `- ${rotularDia(s.inicio)} às ${rotularHora(s.inicio)} | horario: ${codigoDoHorario(s.inicio)}`),
            "",
            "NÃO diga ao lead que houve erro, problema ou que precisa reconfirmar — para ele nada aconteceu.",
            "Só se o horário escolhido não estiver na lista: ofereça os dois primeiros como se fosse a sugestão normal.",
          ].join("\n");
        }

        const dono = quemAtende(inicio, agendas, agora);
        if (!dono) {
          return "ESSE HORÁRIO NÃO ESTÁ MAIS DISPONÍVEL. Não insista nele: peça novos horários com acao='sugerir' e ofereça os que voltarem.";
        }

        // Um lead, UMA sessão. Vale para 'confirmar' também: se já existe sessão futura, ela é
        // MOVIDA, nunca duplicada. Em 11/09 (conv 7436) um 'confirmar' depois de um 'remarcar'
        // criou um segundo evento; o primeiro ficou órfão na agenda e o cron mandou lembrete de
        // uma sessão que não existia mais para a lead.
        if (achado) {
          // Mover mantém a agenda (e o link) de quem já ia atender — mas só se ELE estiver livre
          // no horário novo. Se o horário só cabe na outra agenda, o evento troca de dono: cancela
          // e cria de novo, com link novo. Mover cego marcaria em cima de compromisso.
          const agendaAtual = agendas.find((a) => a.calendarId === achado!.calendarId);
          const cabeNaMesma = Boolean(agendaAtual && !slotColide(inicio, agendaAtual.ocupados));
          if (cabeNaMesma) {
            await moverSessao(achado.calendarId, achado.evento.id!, inicio);
            const link = achado.evento.hangoutLink ?? "";
            return [
              `Sessão remarcada para ${rotularDia(inicio)} às ${rotularHora(inicio)}.${link ? ` Link: ${link}` : ""}`,
              `Diga ao lead EXATAMENTE este dia e hora (${rotularDia(inicio)} às ${rotularHora(inicio)}) e mande o link.`,
            ].join(" ");
          }
          await cancelarSessao(achado.calendarId, achado.evento.id!);
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
          `Sessão ${achado ? "remarcada" : "marcada"} para ${rotularDia(inicio)} às ${rotularHora(inicio)}.`,
          `Diga ao lead EXATAMENTE este dia e hora: ${rotularDia(inicio)} às ${rotularHora(inicio)}.`,
          meet ? `Link da reunião${achado ? " (NOVO, o anterior não vale mais)" : ""}: ${meet}` : "ATENÇÃO: o link da reunião não foi gerado — use Escalar_humano.",
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
