import { google } from "googleapis";
import { env } from "../config/env.ts";

function obterAuth() {
  const credenciais = JSON.parse(env.GOOGLE_CALENDAR_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials: credenciais,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
}

function obterCalendar() {
  return google.calendar({ version: "v3", auth: obterAuth() });
}

export async function listarEventos(
  calendarId: string,
  timeMin: string,
  timeMax: string,
) {
  const calendar = obterCalendar();
  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items ?? [];
}

export async function criarEvento(
  calendarId: string,
  evento: {
    summary: string;
    description: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
  },
) {
  const calendar = obterCalendar();
  const res = await calendar.events.insert({
    calendarId,
    requestBody: evento,
  });
  return res.data;
}

export async function atualizarEvento(
  calendarId: string,
  eventId: string,
  dados: {
    summary?: string;
    description?: string;
  },
) {
  const calendar = obterCalendar();
  const res = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: dados,
  });
  return res.data;
}

export async function deletarEvento(
  calendarId: string,
  eventId: string,
) {
  const calendar = obterCalendar();
  await calendar.events.delete({
    calendarId,
    eventId,
  });
}

export async function buscarEventosPorQuery(
  calendarId: string,
  query: string,
) {
  const calendar = obterCalendar();
  const res = await calendar.events.list({
    calendarId,
    q: query,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items ?? [];
}
