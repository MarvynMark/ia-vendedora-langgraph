import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockQuery = mock(async () => ({ rows: [] }));

mock.module("../../src/db/pool.ts", () => ({
  pool: { query: mockQuery },
}));

import { buscarHistorico, salvarMensagem, limparHistorico } from "../../src/db/memoria.ts";

beforeEach(() => {
  mockQuery.mockClear();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("buscarHistorico", () => {
  test("executa SELECT com session_id e limit corretos", async () => {
    await buscarHistorico("+5511999999999", 20);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("n8n_historico_mensagens");
    expect(sql).toContain("WHERE session_id = $1");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual(["+5511999999999", 20]);
  });

  test("retorna resultados em ordem reversa (mais antigo primeiro)", async () => {
    const rows = [
      { type: "ai", content: "resposta" },
      { type: "human", content: "segunda pergunta" },
      { type: "human", content: "primeira pergunta" },
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    const result = await buscarHistorico("+5511999999999");
    // reverse() reverses in place, so result should be reversed order
    expect(result[0].content).toBe("primeira pergunta");
    expect(result[2].content).toBe("resposta");
  });

  test("usa limite padrão de 50", async () => {
    await buscarHistorico("+5511999999999");
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe(50);
  });
});

describe("salvarMensagem", () => {
  test("executa INSERT com JSON.stringify nos campos de array", async () => {
    const mensagem = {
      type: "human",
      content: "Olá",
      tool_calls: [],
      additional_kwargs: {},
      response_metadata: {},
      invalid_tool_calls: [],
    };
    await salvarMensagem("+5511999999999", mensagem);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO n8n_historico_mensagens");
    expect(params[0]).toBe("+5511999999999");
    expect(params[2]).toBe("Olá");
    expect(params[3]).toBe(JSON.stringify([]));
  });
});

describe("limparHistorico", () => {
  test("executa DELETE com session_id correto", async () => {
    await limparHistorico("+5511999999999");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("DELETE FROM n8n_historico_mensagens");
    expect(sql).toContain("WHERE session_id = $1");
    expect(params).toEqual(["+5511999999999"]);
  });
});
