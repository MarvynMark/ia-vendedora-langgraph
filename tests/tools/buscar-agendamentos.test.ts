import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockBuscarEventosPorQuery = mock(async () => []);

mock.module("../../src/services/google-calendar.ts", () => ({
  buscarEventosPorQuery: mockBuscarEventosPorQuery,
}));

import { criarToolBuscarAgendamentos } from "../../src/tools/buscar-agendamentos.ts";

const contexto = { telefone: "+5511999999999" };

beforeEach(() => {
  mockBuscarEventosPorQuery.mockClear();
  mockBuscarEventosPorQuery.mockResolvedValue([]);
});

describe("criarToolBuscarAgendamentos", () => {
  test("busca em todas as agendas dos profissionais", async () => {
    const tool = criarToolBuscarAgendamentos(contexto);
    await tool.invoke({});
    // 4 profissionais = 4 calls
    expect(mockBuscarEventosPorQuery).toHaveBeenCalledTimes(4);
  });

  test("retorna eventos agrupados por profissional", async () => {
    const eventos = [
      { id: "evt-1", summary: "João Silva", start: { dateTime: "2026-04-01T10:00:00-03:00" } },
    ];
    // First call returns events, rest return empty
    mockBuscarEventosPorQuery
      .mockResolvedValueOnce(eventos)
      .mockResolvedValue([]);

    const tool = criarToolBuscarAgendamentos(contexto);
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].profissional).toBeDefined();
    expect(parsed[0].eventos).toHaveLength(1);
  });

  test("retorna mensagem quando nenhum agendamento encontrado", async () => {
    const tool = criarToolBuscarAgendamentos(contexto);
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.resultado).toContain("Nenhum agendamento");
  });

  test("busca por telefone do contato em cada agenda", async () => {
    const tool = criarToolBuscarAgendamentos(contexto);
    await tool.invoke({});
    for (const call of mockBuscarEventosPorQuery.mock.calls) {
      const [, query] = call as [string, string];
      expect(query).toBe("+5511999999999");
    }
  });

  test("formata resultado como JSON string", async () => {
    const tool = criarToolBuscarAgendamentos(contexto);
    const result = await tool.invoke({});
    expect(typeof result).toBe("string");
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
