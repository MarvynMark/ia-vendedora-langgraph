import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockQuery = mock(async () => ({ rows: [] }));

mock.module("../../src/db/pool.ts", () => ({
  pool: { query: mockQuery },
}));

import {
  verificarLock,
  adquirirLock,
  liberarLock,
  limparLock,
  tentarAdquirirLock,
} from "../../src/db/lock.ts";

beforeEach(() => {
  mockQuery.mockClear();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("verificarLock", () => {
  test("retorna false quando não há registro", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await verificarLock("+5511999999999");
    expect(result).toBe(false);
  });

  test("retorna false quando lock_conversa=false", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ lock_conversa: false }] });
    const result = await verificarLock("+5511999999999");
    expect(result).toBe(false);
  });

  test("retorna true quando lock_conversa=true", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ lock_conversa: true }] });
    const result = await verificarLock("+5511999999999");
    expect(result).toBe(true);
  });
});

describe("adquirirLock", () => {
  test("executa INSERT ON CONFLICT com lock_conversa=true", async () => {
    await adquirirLock("+5511999999999");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO n8n_status_atendimento");
    expect(sql).toContain("lock_conversa = true");
    expect(params).toEqual(["+5511999999999"]);
  });
});

describe("liberarLock", () => {
  test("executa INSERT ON CONFLICT com lock_conversa=false", async () => {
    await liberarLock("+5511999999999");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO n8n_status_atendimento");
    expect(sql).toContain("lock_conversa = false");
    expect(params).toEqual(["+5511999999999"]);
  });
});

describe("limparLock", () => {
  test("executa DELETE FROM n8n_status_atendimento", async () => {
    await limparLock("+5511999999999");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("DELETE FROM n8n_status_atendimento");
    expect(params).toEqual(["+5511999999999"]);
  });
});

describe("tentarAdquirirLock", () => {
  test("retorna true quando INSERT retorna uma linha (lock adquirido)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ session_id: "+5511999999999" }] });
    const result = await tentarAdquirirLock("+5511999999999");
    expect(result).toBe(true);
  });

  test("retorna false quando INSERT não retorna linhas (lock já adquirido por outro)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await tentarAdquirirLock("+5511999999999");
    expect(result).toBe(false);
  });

  test("SQL contém cláusula WHERE para verificação atômica", async () => {
    await tentarAdquirirLock("+5511999999999");
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE");
    expect(sql).toContain("lock_conversa = false");
    expect(sql).toContain("RETURNING");
  });
});
