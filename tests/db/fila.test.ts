import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockQuery = mock(async () => ({ rows: [] as unknown[] }));

mock.module("../../src/db/pool.ts", () => ({
  pool: { query: mockQuery },
}));

import { enfileirarMensagem, buscarUltimaMensagem, coletarELimparMensagens } from "../../src/db/fila.ts";

describe("fila DB", () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockImplementation(async () => ({ rows: [] }));
  });

  test("enfileirarMensagem chama INSERT", async () => {
    await enfileirarMensagem("msg-1", "+5511999999999", "Olá", new Date().toISOString());
    expect(mockQuery.mock.calls.length).toBe(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT");
    expect(sql).toContain("n8n_fila_mensagens");
  });

  test("buscarUltimaMensagem retorna null quando não há mensagens", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await buscarUltimaMensagem("+5511999999999");
    expect(result).toBeNull();
  });

  test("buscarUltimaMensagem retorna dados quando há mensagens", async () => {
    const ts = new Date();
    mockQuery.mockResolvedValueOnce({ rows: [{ id_mensagem: "msg-1", timestamp: ts }] });
    const result = await buscarUltimaMensagem("+5511999999999");
    expect(result).not.toBeNull();
    expect(result!.idMensagem).toBe("msg-1");
  });

  test("coletarELimparMensagens usa DELETE RETURNING atômico (1 query)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ mensagem: "Olá" }, { mensagem: "Mundo" }] });
    const result = await coletarELimparMensagens("+5511999999999");
    expect(mockQuery.mock.calls.length).toBe(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("DELETE");
    expect(sql).toContain("RETURNING");
    expect(result).toBe("Olá\nMundo");
  });

  test("coletarELimparMensagens retorna string vazia quando fila vazia", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await coletarELimparMensagens("+5511999999999");
    expect(result).toBe("");
  });

  test("coletarELimparMensagens passa telefone como parâmetro", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await coletarELimparMensagens("+5511999999999");
    expect(mockQuery.mock.calls[0]![1]).toEqual(["+5511999999999"]);
  });
});
