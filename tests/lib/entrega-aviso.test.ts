import { describe, test, expect } from "bun:test";
import { situacaoEntrega } from "../../src/lib/entrega-aviso.ts";

describe("situacaoEntrega", () => {
  test("status failed → falhou (caso Alessandra, 07/11)", () => {
    expect(situacaoEntrega([{ id: 841000, status: "failed" }], 841000)).toBe("falhou");
  });

  test("sent/delivered/read → ok", () => {
    for (const status of ["sent", "delivered", "read"]) {
      expect(situacaoEntrega([{ id: 1, status }], 1)).toBe("ok");
    }
  });

  test("mensagem fora da página → desconhecida (não reenvia às cegas)", () => {
    expect(situacaoEntrega([{ id: 2, status: "failed" }], 1)).toBe("desconhecida");
  });
});
