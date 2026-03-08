import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockDeletarEvento = mock(async () => ({}));

mock.module("../../src/services/google-calendar.ts", () => ({
  deletarEvento: mockDeletarEvento,
}));

// Mock fetch for chatwoot HTTP calls without replacing the chatwoot module
const mockFetch = mock(async () => new Response(JSON.stringify({}), { status: 200 }));

import { criarToolCancelarAgendamento } from "../../src/tools/cancelar-agendamento.ts";

const contexto = { idConta: "8", idConversa: "100" };

beforeEach(() => {
  mockDeletarEvento.mockClear();
  mockDeletarEvento.mockResolvedValue({});
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  globalThis.fetch = mockFetch as typeof fetch;
});

describe("criarToolCancelarAgendamento", () => {
  test("cancela agendamento com sucesso", async () => {
    const tool = criarToolCancelarAgendamento(contexto);
    const result = await tool.invoke({
      idProfissional: "dra-ana-costa",
      idEvento: "evento-123",
    });
    const parsed = JSON.parse(result);
    expect(parsed.resultado).toBe("AGENDAMENTO CANCELADO");
    expect(mockDeletarEvento).toHaveBeenCalledTimes(1);
  });

  test("retorna erro para profissional desconhecido", async () => {
    const tool = criarToolCancelarAgendamento(contexto);
    const result = await tool.invoke({
      idProfissional: "dr-inexistente",
      idEvento: "evento-123",
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("não encontrado");
    expect(mockDeletarEvento).not.toHaveBeenCalled();
  });

  test("salva motivoCancelamento quando fornecido", async () => {
    const tool = criarToolCancelarAgendamento(contexto);
    await tool.invoke({
      idProfissional: "dra-ana-costa",
      idEvento: "evento-123",
      motivoCancelamento: "paciente desistiu",
    });
    // One fetch call: atualizarAtributosConversa
    const patchCall = mockFetch.mock.calls.find(c => {
      const [url, opts] = c as [string, RequestInit];
      return url.includes("/conversations/100") && opts?.method === "PATCH";
    });
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall as [string, RequestInit])[1]!.body as string);
    expect(body.custom_attributes.motivo_cancelamento).toBe("paciente desistiu");
  });

  test("não chama chatwoot quando motivoCancelamento não fornecido", async () => {
    const tool = criarToolCancelarAgendamento(contexto);
    await tool.invoke({
      idProfissional: "dra-ana-costa",
      idEvento: "evento-123",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
