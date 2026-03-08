import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockQuery = mock(async () => ({ rows: [] as unknown[] }));
const mockRelease = mock(() => {});
const mockConnect = mock(async () => ({
  query: mockQuery,
  release: mockRelease,
}));

mock.module("../../src/db/pool.ts", () => ({
  pool: { connect: mockConnect },
}));

import { criarTabelas } from "../../src/db/setup.ts";

describe("criarTabelas", () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockConnect.mockClear();
    mockRelease.mockClear();
  });

  test("cria as 3 tabelas com CREATE TABLE IF NOT EXISTS", async () => {
    await criarTabelas();
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("n8n_fila_mensagens");
    expect(sql).toContain("n8n_status_atendimento");
    expect(sql).toContain("n8n_historico_mensagens");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
  });

  test("cria índices para as tabelas", async () => {
    await criarTabelas();
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
    expect(sql).toContain("idx_fila_telefone");
    expect(sql).toContain("idx_historico_session");
  });

  test("libera o client após execução", async () => {
    await criarTabelas();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test("libera o client mesmo se query falhar", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB error"));
    await expect(criarTabelas()).rejects.toThrow("DB error");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
