import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockListarEventos = mock(async () => []);
const mockCriarEvento = mock(async () => ({ id: "evt-123", summary: "Test" }));

mock.module("../../src/services/google-calendar.ts", () => ({
  listarEventos: mockListarEventos,
  criarEvento: mockCriarEvento,
}));

const mockFetch = mock(async () => new Response(JSON.stringify({}), { status: 200 }));

import { criarToolCriarAgendamento } from "../../src/tools/criar-agendamento.ts";

const contexto = { idConta: "8", idContato: "42", telefone: "+5511999999999" };
const baseInput = {
  eventoInicio: "2026-04-01T10:00:00-03:00",
  duracaoMinutos: 60,
  titulo: "João Silva",
  descricao: "Consulta de rotina",
  idProfissional: "dra-ana-costa",
};

beforeEach(() => {
  mockListarEventos.mockClear();
  mockListarEventos.mockResolvedValue([]);
  mockCriarEvento.mockClear();
  mockCriarEvento.mockResolvedValue({ id: "evt-123", summary: "Test" });
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  globalThis.fetch = mockFetch as typeof fetch;
});

describe("criarToolCriarAgendamento", () => {
  test("cria agendamento com sucesso quando sem conflito", async () => {
    const tool = criarToolCriarAgendamento(contexto);
    const result = await tool.invoke(baseInput);
    const parsed = JSON.parse(result);
    expect(parsed.resultado).toBe("AGENDAMENTO CRIADO");
    expect(parsed.id_evento).toBe("evt-123");
    expect(mockCriarEvento).toHaveBeenCalledTimes(1);
    const [calendarId, evento] = mockCriarEvento.mock.calls[0] as [string, { summary: string; start: { dateTime: string }; end: { dateTime: string } }];
    expect(typeof calendarId).toBe("string");
    expect(evento.summary).toBe("João Silva");
    expect(evento.start.dateTime).toBeDefined();
    expect(evento.end.dateTime).toBeDefined();
  });

  test("detecta conflito e retorna erro", async () => {
    const conflito = {
      start: { dateTime: "2026-04-01T09:30:00-03:00" },
      end: { dateTime: "2026-04-01T10:30:00-03:00" },
    };
    mockListarEventos.mockResolvedValueOnce([conflito]);
    const tool = criarToolCriarAgendamento(contexto);
    const result = await tool.invoke(baseInput);
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("HORÁRIO INDISPONÍVEL");
    expect(mockCriarEvento).not.toHaveBeenCalled();
  });

  test("retorna erro para profissional desconhecido", async () => {
    const tool = criarToolCriarAgendamento(contexto);
    const result = await tool.invoke({ ...baseInput, idProfissional: "dr-inexistente" });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("não encontrado");
    expect(mockCriarEvento).not.toHaveBeenCalled();
  });

  test("retorna erro quando criarEvento falha", async () => {
    mockCriarEvento.mockRejectedValueOnce(new Error("Google API error"));
    const tool = criarToolCriarAgendamento(contexto);
    const result = await tool.invoke(baseInput);
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("Erro ao criar agendamento");
  });

  test("atualiza contato com sucesso mas continua se falhar", async () => {
    mockFetch.mockImplementationOnce(async () => { throw new Error("Network error"); });
    const tool = criarToolCriarAgendamento(contexto);
    const result = await tool.invoke(baseInput);
    const parsed = JSON.parse(result);
    // Should still succeed even if contact update fails
    expect(parsed.resultado).toBe("AGENDAMENTO CRIADO");
  });

  test("descrição inclui telefone do contato", async () => {
    const tool = criarToolCriarAgendamento(contexto);
    await tool.invoke(baseInput);
    const [, evento] = mockCriarEvento.mock.calls[0] as [string, { description: string }];
    expect(evento.description).toContain("+5511999999999");
  });
});
