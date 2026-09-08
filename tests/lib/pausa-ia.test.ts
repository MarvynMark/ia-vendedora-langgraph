import { describe, test, expect } from "bun:test";
import { iaEstaPausada } from "../../src/lib/pausa-ia.ts";

// O follow-up é disparado pelo Kanban e NÃO passava pela checagem de agente-on que o webhook do
// Chatwoot já fazia: uma conversa escalada seguia recebendo toque automático por cima do atendente
// que tinha assumido. Esta é a regra que os dois caminhos usam agora.
describe("iaEstaPausada", () => {
  test("com agente-on, a IA está ativa", () => {
    expect(iaEstaPausada(["agente-on"])).toBe(false);
    expect(iaEstaPausada(["mentoria", "agente-on"])).toBe(false);
  });

  test("sem agente-on, está pausada — o humano assumiu", () => {
    expect(iaEstaPausada([])).toBe(true);
    expect(iaEstaPausada(["mentoria"])).toBe(true);
  });

  test("labels ausentes contam como pausada (não fala por cima de quem assumiu)", () => {
    expect(iaEstaPausada(undefined)).toBe(true);
    expect(iaEstaPausada(null)).toBe(true);
  });
});
