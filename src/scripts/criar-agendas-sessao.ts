// Cria (idempotente) os calendários das sessões estratégicas e prova que o Meet por evento funciona.
//
// Um calendário por closer, porque é a agenda de cada um que serve de trava: enquanto o horário
// estiver ocupado lá, a IA não oferece de novo. Os dois vivem na conta contato@csiacademy.com.br,
// que é quem autorizou o OAuth — então aparecem na barra lateral dela sem mais nenhum passo.
//
// Uso: bun run src/scripts/criar-agendas-sessao.ts

import { google } from "googleapis";
import { env } from "../config/env.ts";

const NOMES = ["Sessões — Gusthavo", "Sessões — Pedro"] as const;
const TZ = "America/Sao_Paulo";

const oauth = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
const cal = google.calendar({ version: "v3", auth: oauth });

const existentes = (await cal.calendarList.list({ maxResults: 250 })).data.items ?? [];
const ids: Record<string, string> = {};

for (const nome of NOMES) {
  const achado = existentes.find((c) => c.summary === nome);
  if (achado?.id) {
    console.log(`= já existe  ${nome}  →  ${achado.id}`);
    ids[nome] = achado.id;
    continue;
  }
  const criado = await cal.calendars.insert({
    requestBody: { summary: nome, timeZone: TZ, description: "Sessões estratégicas agendadas pela IA vendedora (Instituto Vestigium)." },
  });
  console.log(`+ criado     ${nome}  →  ${criado.data.id}`);
  ids[nome] = criado.data.id!;
}

// ── Prova de fogo: o Meet sai único por evento? ──
const alvo = ids[NOMES[0]]!;
const inicio = new Date(Date.now() + 24 * 60 * 60 * 1000);
inicio.setMinutes(0, 0, 0);
const links: string[] = [];

for (let i = 0; i < 2; i++) {
  const ini = new Date(inicio.getTime() + i * 60 * 60 * 1000);
  const evt = await cal.events.insert({
    calendarId: alvo,
    conferenceDataVersion: 1,
    requestBody: {
      summary: `TESTE ${i + 1} — apagar`,
      start: { dateTime: ini.toISOString(), timeZone: TZ },
      end: { dateTime: new Date(ini.getTime() + 30 * 60_000).toISOString(), timeZone: TZ },
      conferenceData: { createRequest: { requestId: `teste-${Date.now()}-${i}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
  });
  const link = evt.data.hangoutLink ?? evt.data.conferenceData?.entryPoints?.[0]?.uri ?? "(sem link)";
  links.push(link);
  console.log(`  evento ${i + 1}: ${link}`);
  await cal.events.delete({ calendarId: alvo, eventId: evt.data.id! });
}

console.log("\n─── resultado ───");
console.log(links[0] === "(sem link)" ? "❌ Meet NÃO foi gerado" : links[0] === links[1] ? "⚠️  Meet gerado, mas REPETIDO entre eventos" : "✅ Meet ÚNICO por evento");
console.log("\n─── cole no .env e no Coolify ───\n");
console.log(`AGENDA_ATIVA=true`);
console.log(`GOOGLE_CALENDAR_ID_GUSTHAVO=${ids[NOMES[0]]}`);
console.log(`GOOGLE_CALENDAR_ID_PEDRO=${ids[NOMES[1]]}`);
console.log("");
