import { describe, test, expect } from "bun:test";
import { corretorAtende, ETIQUETA_TESTE } from "../../src/corretor/fluxo.ts";

// Sem CORRETOR_MODO no ambiente o default é "on": qualquer conversa do Suporte 1.
describe("corretorAtende (modo on, padrão)", () => {
  test("Suporte 1 com a etiqueta de teste", () => {
    expect(corretorAtende(13, [ETIQUETA_TESTE])).toBe(true);
  });
  test("Suporte 1 sem a etiqueta também (o corretor só age com /corrigir ou sessão aberta)", () => {
    expect(corretorAtende(13, ["suporte"])).toBe(true);
  });
  test("outras caixas (comercial) nunca", () => {
    expect(corretorAtende(11, [ETIQUETA_TESTE])).toBe(false);
  });
});
