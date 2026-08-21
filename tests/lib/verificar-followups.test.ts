import { describe, test, expect } from "bun:test";
import { idadeCardDias, DIAS_ORFAO_EXPIRA } from "../../src/lib/verificar-followups.ts";

describe("idadeCardDias (higiene de órfãos)", () => {
  const agora = new Date("2026-08-21T12:00:00.000Z").getTime();

  test("created_at ausente → 0 (nunca expira: default seguro)", () => {
    expect(idadeCardDias(undefined, agora)).toBe(0);
  });

  test("created_at inválido → 0", () => {
    expect(idadeCardDias("não-é-data", agora)).toBe(0);
  });

  test("card recém-criado → idade pequena, NÃO passa do limite", () => {
    const idade = idadeCardDias("2026-08-20T12:00:00.000Z", agora); // 1 dia
    expect(idade).toBeCloseTo(1, 3);
    expect(idade > DIAS_ORFAO_EXPIRA).toBe(false);
  });

  test("card antigo (60d) → passa do limite (seria expirado)", () => {
    const idade = idadeCardDias("2026-06-22T12:00:00.000Z", agora); // 60 dias
    expect(idade).toBeCloseTo(60, 0);
    expect(idade > DIAS_ORFAO_EXPIRA).toBe(true);
  });

  test("card exatamente no limite (14d) NÃO expira (usa > estrito)", () => {
    const catorzeDiasAtras = new Date(agora - DIAS_ORFAO_EXPIRA * 24 * 60 * 60 * 1000).toISOString();
    expect(idadeCardDias(catorzeDiasAtras, agora) > DIAS_ORFAO_EXPIRA).toBe(false);
  });
});
