import { logger } from "../lib/logger.ts";

export interface Profissional {
  id: string;
  nome: string;
  especialidade: string;
  calendarId: string;
  disponibilidade: Record<number, Array<{ inicio: string; fim: string }>>;
}

const calendarIds: Record<string, string> = (() => {
  const json = process.env["PROFISSIONAIS_CALENDAR_IDS"];
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, string>;
  } catch {
    logger.error("profissionais", "PROFISSIONAIS_CALENDAR_IDS JSON inválido");
    return {};
  }
})();

export const profissionais: Record<string, Profissional> = {
  "dra-ana-costa": {
    id: "dra-ana-costa",
    nome: "Dra. Ana Costa",
    especialidade: "Clínico Geral, Limpeza",
    calendarId: calendarIds["dra-ana-costa"] ?? "dra-ana-costa@clinic.com",
    disponibilidade: {
      1: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }], // segunda
      2: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }], // terça
      3: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }], // quarta
      4: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }], // quinta
      5: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }], // sexta
      6: [{ inicio: "08:00", fim: "11:00" }], // sábado
    },
  },
  "dr-ricardo-lima": {
    id: "dr-ricardo-lima",
    nome: "Dr. Ricardo Lima",
    especialidade: "Implantes, Cirurgia",
    calendarId: calendarIds["dr-ricardo-lima"] ?? "dr-ricardo-lima@clinic.com",
    disponibilidade: {
      1: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      2: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      3: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      4: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      5: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      6: [{ inicio: "08:00", fim: "11:00" }],
    },
  },
  "dra-beatriz-souza": {
    id: "dra-beatriz-souza",
    nome: "Dra. Beatriz Souza",
    especialidade: "Ortodontia",
    calendarId: calendarIds["dra-beatriz-souza"] ?? "dra-beatriz-souza@clinic.com",
    disponibilidade: {
      1: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      2: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      3: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      4: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      5: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      6: [{ inicio: "08:00", fim: "11:00" }],
    },
  },
  "dr-felipe-torres": {
    id: "dr-felipe-torres",
    nome: "Dr. Felipe Torres",
    especialidade: "Endodontia (Canal)",
    calendarId: calendarIds["dr-felipe-torres"] ?? "dr-felipe-torres@clinic.com",
    disponibilidade: {
      1: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      2: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      3: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      4: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      5: [{ inicio: "08:00", fim: "12:00" }, { inicio: "14:00", fim: "18:00" }],
      6: [{ inicio: "08:00", fim: "11:00" }],
    },
  },
};

export function buscarProfissional(id: string): Profissional | undefined {
  return profissionais[id];
}
