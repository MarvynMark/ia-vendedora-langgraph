import { describe, test, expect } from "bun:test";
import { dividirMensagem } from "../../src/lib/response-formatter.ts";

describe("dividirMensagem", () => {
  test("divide texto por \\n\\n", () => {
    const texto = "Bloco 1\n\nBloco 2\n\nBloco 3";
    const resultado = dividirMensagem(texto);
    expect(resultado).toEqual(["Bloco 1", "Bloco 2", "Bloco 3"]);
  });

  test("limita a 10 blocos (o teto por turno é aplicado depois, em agruparAteLimite)", () => {
    const texto = Array.from({ length: 12 }, (_, i) => String(i + 1)).join("\n\n");
    const resultado = dividirMensagem(texto);
    expect(resultado.length).toBe(10);
  });

  test("ignora blocos vazios", () => {
    const texto = "Bloco 1\n\n\n\n\n\nBloco 2";
    const resultado = dividirMensagem(texto);
    expect(resultado).toEqual(["Bloco 1", "Bloco 2"]);
  });

  test("retorna array vazio para texto vazio", () => {
    const resultado = dividirMensagem("");
    expect(resultado).toEqual([]);
  });

  test("retorna texto único como array de 1 elemento", () => {
    const resultado = dividirMensagem("Olá, tudo bem?");
    expect(resultado).toEqual(["Olá, tudo bem?"]);
  });
});
