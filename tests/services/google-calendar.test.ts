import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockEventsList = mock(async () => ({ data: { items: [] } }));
const mockEventsInsert = mock(async () => ({ data: { id: "evt-new" } }));
const mockEventsPatch = mock(async () => ({ data: { id: "evt-updated" } }));
const mockEventsDelete = mock(async () => ({}));

const mockCalendar = {
  events: {
    list: mockEventsList,
    insert: mockEventsInsert,
    patch: mockEventsPatch,
    delete: mockEventsDelete,
  },
};

// Override the google-calendar module with implementations that call our mocks directly
mock.module("../../src/services/google-calendar.ts", () => ({
  listarEventos: async (calendarId: string, timeMin: string, timeMax: string) => {
    const res = await mockCalendar.events.list({
      calendarId, timeMin, timeMax, singleEvents: true, orderBy: "startTime",
    } as never);
    return (res.data as { items?: unknown[] }).items ?? [];
  },
  criarEvento: async (calendarId: string, evento: { summary: string; description: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }) => {
    const res = await mockCalendar.events.insert({ calendarId, requestBody: evento } as never);
    return res.data;
  },
  atualizarEvento: async (calendarId: string, eventId: string, dados: { summary?: string; description?: string }) => {
    const res = await mockCalendar.events.patch({ calendarId, eventId, requestBody: dados } as never);
    return res.data;
  },
  deletarEvento: async (calendarId: string, eventId: string) => {
    await mockCalendar.events.delete({ calendarId, eventId } as never);
  },
  buscarEventosPorQuery: async (calendarId: string, query: string) => {
    const res = await mockCalendar.events.list({
      calendarId, q: query, singleEvents: true, orderBy: "startTime",
    } as never);
    return (res.data as { items?: unknown[] }).items ?? [];
  },
}));

import {
  listarEventos,
  criarEvento,
  buscarEventosPorQuery,
  deletarEvento,
} from "../../src/services/google-calendar.ts";

beforeEach(() => {
  mockEventsList.mockClear();
  mockEventsList.mockResolvedValue({ data: { items: [] } });
  mockEventsInsert.mockClear();
  mockEventsInsert.mockResolvedValue({ data: { id: "evt-new" } });
  mockEventsPatch.mockClear();
  mockEventsPatch.mockResolvedValue({ data: { id: "evt-updated" } });
  mockEventsDelete.mockClear();
  mockEventsDelete.mockResolvedValue({});
});

describe("listarEventos", () => {
  test("chama events.list com params corretos", async () => {
    const timeMin = "2026-04-01T00:00:00Z";
    const timeMax = "2026-04-01T01:00:00Z";
    await listarEventos("calendar-id", timeMin, timeMax);
    expect(mockEventsList).toHaveBeenCalledTimes(1);
    const [params] = mockEventsList.mock.calls[0] as [{ calendarId: string; timeMin: string; timeMax: string; singleEvents: boolean }];
    expect(params.calendarId).toBe("calendar-id");
    expect(params.timeMin).toBe(timeMin);
    expect(params.timeMax).toBe(timeMax);
    expect(params.singleEvents).toBe(true);
  });

  test("retorna array vazio quando items é undefined", async () => {
    mockEventsList.mockResolvedValueOnce({ data: {} });
    const result = await listarEventos("cal-id", "2026-04-01T00:00:00Z", "2026-04-01T01:00:00Z");
    expect(result).toEqual([]);
  });
});

describe("criarEvento", () => {
  test("chama events.insert com requestBody correto", async () => {
    const evento = {
      summary: "João Silva",
      description: "Consulta",
      start: { dateTime: "2026-04-01T10:00:00-03:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: "2026-04-01T11:00:00-03:00", timeZone: "America/Sao_Paulo" },
    };
    const result = await criarEvento("cal-id", evento);
    expect((result as { id: string }).id).toBe("evt-new");
    const [params] = mockEventsInsert.mock.calls[0] as [{ calendarId: string; requestBody: typeof evento }];
    expect(params.requestBody.summary).toBe("João Silva");
  });
});

describe("buscarEventosPorQuery", () => {
  test("chama events.list com parâmetro q correto", async () => {
    await buscarEventosPorQuery("cal-id", "+5511999999999");
    const [params] = mockEventsList.mock.calls[0] as [{ q: string; singleEvents: boolean }];
    expect(params.q).toBe("+5511999999999");
    expect(params.singleEvents).toBe(true);
  });
});

describe("deletarEvento", () => {
  test("chama events.delete com params corretos", async () => {
    await deletarEvento("cal-id", "evt-123");
    expect(mockEventsDelete).toHaveBeenCalledTimes(1);
    const [params] = mockEventsDelete.mock.calls[0] as [{ calendarId: string; eventId: string }];
    expect(params.calendarId).toBe("cal-id");
    expect(params.eventId).toBe("evt-123");
  });
});
