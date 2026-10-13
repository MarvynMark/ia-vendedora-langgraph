import { describe, test, expect } from "bun:test";
import { corretorAtende, ETIQUETA_TESTE } from "../../src/corretor/fluxo.ts";

// Sem CORRETOR_MODO no ambiente o default é "teste": só a conversa etiquetada do Suporte 1.
describe("corretorAtende (modo teste, padrão)", () => {
  test("Suporte 1 com a etiqueta de teste", () => {
    expect(corretorAtende(13, [ETIQUETA_TESTE])).toBe(true);
  });
  test("Suporte 1 sem a etiqueta fica com a equipe", () => {
    expect(corretorAtende(13, ["suporte"])).toBe(false);
  });
  test("outras caixas (comercial) nunca", () => {
    expect(corretorAtende(11, [ETIQUETA_TESTE])).toBe(false);
  });
});
