import { describe, test, expect } from "bun:test";
import { formatarDocumento } from "../../src/lib/documento.ts";

describe("formatarDocumento", () => {
  test("formata o CPF cru que a DMGuru envia (só dígitos)", () => {
    expect(formatarDocumento("06924281400")).toBe("069.242.814-00");
  });

  test("é idempotente com o CPF já pontuado da TMB", () => {
    expect(formatarDocumento("069.242.814-00")).toBe("069.242.814-00");
  });

  test("preserva o zero à esquerda do CPF", () => {
    expect(formatarDocumento("00012345678")).toBe("000.123.456-78");
  });

  test("formata CNPJ de 14 dígitos", () => {
    expect(formatarDocumento("12345678000199")).toBe("12.345.678/0001-99");
  });

  test("avisa quando não veio documento", () => {
    expect(formatarDocumento(undefined)).toBe("(não informado)");
    expect(formatarDocumento("")).toBe("(não informado)");
    expect(formatarDocumento("   ")).toBe("(não informado)");
  });

  test("mostra o valor bruto quando o formato é inesperado", () => {
    expect(formatarDocumento("12345")).toBe("12345");
  });
});
