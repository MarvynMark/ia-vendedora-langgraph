import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockListarEventos = mock(async () => [] as Awaited<ReturnType<typeof import("../../src/services/google-calendar.ts").listarEventos>>);

mock.module("../../src/services/google-calendar.ts", () => ({
  listarEventos: mockListarEventos,
}));

import { buscarJanelasDisponiveis } from "../../src/tools/buscar-janelas.ts";

// Monday, Jan 7 2030 08:00 São Paulo time (UTC-3) — guaranteed future date
const FUTURE_MONDAY_08 = "2030-01-07T08:00:00-03:00";
const FUTURE_MONDAY_12 = "2030-01-07T12:00:00-03:00";
const FUTURE_MONDAY_18 = "2030-01-07T18:00:00-03:00";
// Saturday Jan 12 2030 at 11:00 (after business hours, sábado ends at 11:00)
const FUTURE_SAT_11 = "2030-01-12T11:00:00-03:00";
const FUTURE_SAT_12 = "2030-01-12T12:00:00-03:00";

describe("buscarJanelasDisponiveis", () => {
  beforeEach(() => {
    mockListarEventos.mockClear();
    mockListarEventos.mockImplementation(async () => []);
  });

  test("rejeita tamanho de janela inválido", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 7,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_12,
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("Tamanho de janela inválido");
  });

  test("aceita tamanho de janela válido (30 min)", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 30,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_12,
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toBeUndefined();
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("rejeita período início no passado", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 30,
      periodoInicio: "2020-01-01T08:00:00-03:00",
      periodoFim: "2020-01-01T18:00:00-03:00",
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("futuro");
  });

  test("rejeita profissional desconhecido", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dr-inexistente",
      tamanhoJanelaMinutos: 30,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_12,
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("não encontrado");
  });

  test("retorna janelas disponíveis em dia útil (segunda-feira)", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 60,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_12,
    });
    const janelas = JSON.parse(result) as Array<{ inicioJanela: string; fimJanela: string; idAgenda: string }>;
    expect(Array.isArray(janelas)).toBe(true);
    expect(janelas.length).toBeGreaterThan(0);
    expect(janelas[0]).toHaveProperty("inicioJanela");
    expect(janelas[0]).toHaveProperty("fimJanela");
    expect(janelas[0]).toHaveProperty("idAgenda");
  });

  test("exclui janelas com conflito de eventos", async () => {
    mockListarEventos.mockResolvedValueOnce([
      {
        start: { dateTime: "2030-01-07T08:00:00-03:00" },
        end: { dateTime: "2030-01-07T12:00:00-03:00" },
      },
    ] as Awaited<ReturnType<typeof import("../../src/services/google-calendar.ts").listarEventos>>);

    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 60,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_12,
    });
    const janelas = JSON.parse(result) as unknown[];
    expect(Array.isArray(janelas)).toBe(true);
    expect(janelas.length).toBe(0);
  });

  test("respeita limite de amostras", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 30,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_18,
      amostras: 2,
    });
    const janelas = JSON.parse(result) as unknown[];
    expect(Array.isArray(janelas)).toBe(true);
    expect(janelas.length).toBeLessThanOrEqual(2);
  });

  test("não retorna janelas fora do horário de disponibilidade (sábado após 11h)", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 60,
      periodoInicio: FUTURE_SAT_11,
      periodoFim: FUTURE_SAT_12,
    });
    const janelas = JSON.parse(result) as unknown[];
    expect(Array.isArray(janelas)).toBe(true);
    expect(janelas.length).toBe(0);
  });

  test("rejeita granularidade inválida (ex: 1 minuto)", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 30,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_12,
      granularidade: 1,
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("Granularidade inválida");
  });

  test("aceita granularidade válida (30 min)", async () => {
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 30,
      periodoInicio: FUTURE_MONDAY_08,
      periodoFim: FUTURE_MONDAY_12,
      granularidade: 30,
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toBeUndefined();
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("timezone: UTC time crossing midnight SP boundary returns correct day", async () => {
    // 2030-01-06T23:30:00Z = Mon 2030-01-07 00:30 BRT (UTC-3)
    // Monday 00:30 BRT is outside 08:00-12:00 availability → 0 windows
    const result = await buscarJanelasDisponiveis.invoke({
      idProfissional: "dra-ana-costa",
      tamanhoJanelaMinutos: 30,
      periodoInicio: "2030-01-06T23:30:00Z",
      periodoFim: "2030-01-07T03:00:00Z",
    });
    const janelas = JSON.parse(result) as unknown[];
    expect(Array.isArray(janelas)).toBe(true);
    expect(janelas.length).toBe(0);
  });
});
