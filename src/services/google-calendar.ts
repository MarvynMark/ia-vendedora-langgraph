// Encanamento do Google Calendar. Quem DECIDE o que oferecer é lib/disponibilidade.ts, que é puro
// e testável; aqui só entra o que precisa de rede.
//
// Autenticação por OAuth (refresh token), não Service Account: o Workspace da csiacademy.com.br
// aplica `iam.managed.disableServiceAccountKeyCreation` e proíbe chaves de conta de serviço. E,
// agindo como um usuário real, a API cria sala do Meet POR EVENTO — Service Account em calendário
// compartilhado não tem esse direito. O app é INTERNO no Workspace, então o token não expira.

import { google, type calendar_v3 } from "googleapis";
import { env } from "../config/env.ts";
import { DURACAO_SESSAO_MIN } from "../config/agenda.ts";
import type { AgendaAtendente, Ocupado } from "../lib/disponibilidade.ts";
import { logger } from "../lib/logger.ts";

const MIN_MS = 60 * 1000;
const TZ = "America/Sao_Paulo";

/** A integração está configurada? Sem isso a IA não deve prometer agendamento nenhum. */
export function agendaConfigurada(): boolean {
  return Boolean(
    env.AGENDA_ATIVA &&
      env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_OAUTH_REFRESH_TOKEN &&
      env.GOOGLE_CALENDAR_ID_GUSTHAVO &&
      env.GOOGLE_CALENDAR_ID_PEDRO,
  );
}

/** Os atendentes e seus calendários. O nome NUNCA é dito ao lead — só vai para log e card. */
export const ATENDENTES: ReadonlyArray<{ nome: string; calendarId: string }> = [
  { nome: "Gusthavo", calendarId: env.GOOGLE_CALENDAR_ID_GUSTHAVO },
  { nome: "Pedro", calendarId: env.GOOGLE_CALENDAR_ID_PEDRO },
];

let clienteCache: calendar_v3.Calendar | null = null;

function calendario(): calendar_v3.Calendar {
  if (clienteCache) return clienteCache;
  const oauth = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  clienteCache = google.calendar({ version: "v3", auth: oauth });
  return clienteCache;
}

/**
 * O que já está marcado nas duas agendas, no intervalo pedido.
 *
 * Usa `freebusy`, não `events.list`: uma chamada só para as duas agendas, e devolve só os
 * intervalos ocupados — sem título, convidado ou descrição. Menos dado trafegado e menos exposição
 * do que está na agenda de cada um.
 */
export async function buscarAgendas(inicio: Date, fim: Date): Promise<AgendaAtendente[]> {
  const { data } = await calendario().freebusy.query({
    requestBody: {
      timeMin: inicio.toISOString(),
      timeMax: fim.toISOString(),
      timeZone: TZ,
      items: ATENDENTES.map((a) => ({ id: a.calendarId })),
    },
  });

  return ATENDENTES.map((a) => {
    const cal = data.calendars?.[a.calendarId];
    if (cal?.errors?.length) {
      // Falhar FECHADO: agenda ilegível vira "sem vaga", nunca "livre". Tratar como livre marcaria
      // sessão em cima de compromisso que existe e a IA não conseguiu ver.
      logger.error("google-calendar", `Agenda ilegível (${a.nome}) — tratada como lotada`, cal.errors);
      const bloqueada: Ocupado[] = [{ inicio, fim }];
      return { ...a, ocupados: bloqueada };
    }
    const ocupados: Ocupado[] = (cal?.busy ?? []).map((b) => ({
      inicio: new Date(b.start!),
      fim: new Date(b.end!),
    }));
    return { ...a, ocupados };
  });
}

export interface DadosSessao {
  inicio: Date;
  calendarId: string;
  nomeLead: string;
  telefone: string;
  concurso?: string;
  idConversa?: string;
}

/**
 * Cria a sessão com sala do Meet própria.
 *
 * O telefone vai na DESCRIÇÃO de propósito: é por ele que a gente reencontra o evento para
 * remarcar ou cancelar, já que o id não sobrevive à conversa.
 */
export async function criarSessao(dados: DadosSessao): Promise<{ id: string; meet: string }> {
  const fim = new Date(dados.inicio.getTime() + DURACAO_SESSAO_MIN * MIN_MS);
  const { data } = await calendario().events.insert({
    calendarId: dados.calendarId,
    conferenceDataVersion: 1,
    requestBody: {
      summary: `Sessão estratégica — ${dados.nomeLead}`,
      description: [
        "Agendada pela IA (Instituto Vestigium).",
        `Telefone: ${dados.telefone}`,
        dados.concurso ? `Concurso: ${dados.concurso}` : "",
        dados.idConversa ? `Conversa: ${env.CHATWOOT_BASE_URL}/app/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations/${dados.idConversa}` : "",
      ].filter(Boolean).join("\n"),
      start: { dateTime: dados.inicio.toISOString(), timeZone: TZ },
      end: { dateTime: fim.toISOString(), timeZone: TZ },
      // O estado do lembrete mora NO EVENTO, não numa tabela paralela. Assim ele nasce e morre
      // junto com a sessão: remarcou, os lembretes voltam a valer; cancelou, some tudo. Uma
      // tabela separada ficaria dessincronizada no primeiro cancelamento feito pela agenda.
      extendedProperties: {
        private: {
          telefone: dados.telefone,
          ...(dados.idConversa ? { idConversa: dados.idConversa } : {}),
          ...(dados.concurso ? { concurso: dados.concurso } : {}),
        },
      },
      conferenceData: {
        createRequest: {
          requestId: `vestigium-${dados.telefone}-${dados.inicio.getTime()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const meet = data.hangoutLink ?? data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? "";
  if (!meet) logger.error("google-calendar", "Evento criado SEM link do Meet", { id: data.id });
  logger.info("google-calendar", `Sessão criada: ${data.id} (${dados.inicio.toISOString()})`);
  return { id: data.id ?? "", meet };
}

/** A sessão futura deste telefone, se existir. Procura nas duas agendas. */
export async function buscarSessaoDoTelefone(
  telefone: string,
  agora = new Date(),
): Promise<{ evento: calendar_v3.Schema$Event; calendarId: string } | null> {
  const limite = new Date(agora.getTime() + 90 * 24 * 60 * MIN_MS);
  for (const a of ATENDENTES) {
    const { data } = await calendario().events.list({
      calendarId: a.calendarId,
      q: telefone,
      timeMin: agora.toISOString(),
      timeMax: limite.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 5,
    });
    const evento = data.items?.[0];
    if (evento) return { evento, calendarId: a.calendarId };
  }
  return null;
}

export async function moverSessao(calendarId: string, idEvento: string, novoInicio: Date): Promise<void> {
  const fim = new Date(novoInicio.getTime() + DURACAO_SESSAO_MIN * MIN_MS);
  await calendario().events.patch({
    calendarId,
    eventId: idEvento,
    requestBody: {
      start: { dateTime: novoInicio.toISOString(), timeZone: TZ },
      end: { dateTime: fim.toISOString(), timeZone: TZ },
    },
  });
  logger.info("google-calendar", `Sessão ${idEvento} movida para ${novoInicio.toISOString()}`);
}

export async function cancelarSessao(calendarId: string, idEvento: string): Promise<void> {
  await calendario().events.delete({ calendarId, eventId: idEvento });
  logger.info("google-calendar", `Sessão ${idEvento} cancelada`);
}

/** Chaves de idempotência dos lembretes, gravadas no próprio evento. */
export type MarcaLembrete = "lembrete24h" | "lembrete1h" | "resgate";

/** Sessões que começam (ou terminam) dentro do intervalo, nas duas agendas. */
export async function listarSessoes(
  de: Date,
  ate: Date,
): Promise<Array<{ evento: calendar_v3.Schema$Event; calendarId: string; nomeAtendente: string }>> {
  const out: Array<{ evento: calendar_v3.Schema$Event; calendarId: string; nomeAtendente: string }> = [];
  for (const a of ATENDENTES) {
    const { data } = await calendario().events.list({
      calendarId: a.calendarId,
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });
    for (const evento of data.items ?? []) {
      if (evento.status === "cancelled") continue;
      out.push({ evento, calendarId: a.calendarId, nomeAtendente: a.nome });
    }
  }
  return out;
}

/** Já mandamos este lembrete para esta sessão? */
export function lembreteJaEnviado(evento: calendar_v3.Schema$Event, marca: MarcaLembrete): boolean {
  return evento.extendedProperties?.private?.[marca] === "1";
}

/**
 * Marca o lembrete como enviado, no próprio evento.
 *
 * Chamado ANTES do envio de propósito: se marcar depois e o processo cair no meio, o lead recebe
 * o mesmo lembrete de novo no ciclo seguinte. Perder um lembrete é ruim; mandar dois é pior —
 * cheira a robô e queima a confiança logo antes da call.
 */
export async function marcarLembrete(
  calendarId: string,
  idEvento: string,
  marca: MarcaLembrete,
): Promise<void> {
  await calendario().events.patch({
    calendarId,
    eventId: idEvento,
    requestBody: { extendedProperties: { private: { [marca]: "1" } } },
  });
}
