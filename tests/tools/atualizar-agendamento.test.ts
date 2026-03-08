import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockAtualizarEvento = mock(async () => ({ id: "evt-123", summary: "Novo Titulo" }));

mock.module("../../src/services/google-calendar.ts", () => ({
  atualizarEvento: mockAtualizarEvento,
}));

import { atualizarAgendamento } from "../../src/tools/atualizar-agendamento.ts";

beforeEach(() => {
  mockAtualizarEvento.mockClear();
  mockAtualizarEvento.mockResolvedValue({ id: "evt-123", summary: "Novo Titulo" });
});

describe("atualizarAgendamento", () => {
  test("atualiza evento com sucesso", async () => {
    const result = await atualizarAgendamento.invoke({
      idProfissional: "dra-ana-costa",
      idEvento: "evt-123",
      titulo: "João Silva - Revisão",
      descricao: "Revisão pós-cirurgia",
    });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("evt-123");
    expect(mockAtualizarEvento).toHaveBeenCalledTimes(1);
    const [, , dados] = mockAtualizarEvento.mock.calls[0] as [string, string, { summary: string; description: string }];
    expect(dados.summary).toBe("João Silva - Revisão");
    expect(dados.description).toBe("Revisão pós-cirurgia");
  });

  test("retorna erro para profissional desconhecido", async () => {
    const result = await atualizarAgendamento.invoke({
      idProfissional: "dr-inexistente",
      idEvento: "evt-123",
      titulo: "Titulo",
      descricao: "Desc",
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toContain("não encontrado");
    expect(mockAtualizarEvento).not.toHaveBeenCalled();
  });
});
