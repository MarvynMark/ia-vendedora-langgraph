import { describe, test, expect } from "bun:test";
import { motivoIgnorarPreGrupo, motivoIgnorarAtivacao } from "../../src/routes/webhook-filtros.ts";

// Teste PURO dos filtros do webhook (sem mock.module — que no bun vaza entre arquivos e
// poluía a suíte). A versão antiga testava a rota inteira, ficou stale e derrubava outros testes.

describe("motivoIgnorarPreGrupo", () => {
  test("aceita mensagem incoming normal do contato (null = prossegue)", () => {
    expect(motivoIgnorarPreGrupo(0, undefined, 1, 1)).toBeNull();
    expect(motivoIgnorarPreGrupo("incoming", false, 1, 1)).toBeNull();
    expect(motivoIgnorarPreGrupo(0, undefined, 1, undefined)).toBeNull(); // sem contactId conhecido
  });

  test("ignora não-incoming (message_type != 0/incoming)", () => {
    expect(motivoIgnorarPreGrupo(1, undefined, 1, 1)).toBe("not_incoming");
    expect(motivoIgnorarPreGrupo("outgoing", undefined, 1, 1)).toBe("not_incoming");
  });

  // Regressão conv 4677: lead reagiu ❤️ ao pitch e a IA mandou o link (tratou reação como "sim").
  test("ignora REAÇÃO (is_reaction=true), mesmo sendo incoming do contato", () => {
    expect(motivoIgnorarPreGrupo(0, true, 1, 1)).toBe("reaction");
    expect(motivoIgnorarPreGrupo("incoming", true, 5, 5)).toBe("reaction");
  });

  test("ignora mensagem do bot/agente (sender != contato)", () => {
    expect(motivoIgnorarPreGrupo(0, undefined, 3, 1)).toBe("agent_message");
  });

  test("precedência: não-incoming vence reação", () => {
    expect(motivoIgnorarPreGrupo(1, true, 1, 1)).toBe("not_incoming");
  });
});

describe("motivoIgnorarAtivacao", () => {
  test("prossegue quando tem agente-on (modo teste desligado)", () => {
    expect(motivoIgnorarAtivacao(["agente-on"], false)).toBeNull();
    expect(motivoIgnorarAtivacao(["agente-on", "outro"], false)).toBeNull();
  });

  test("ignora sem agente-on", () => {
    expect(motivoIgnorarAtivacao([], false)).toBe("no_agente-on");
    expect(motivoIgnorarAtivacao(["teste-agente"], false)).toBe("no_agente-on");
  });

  test("MODO_TESTE: exige teste-agente além do agente-on", () => {
    expect(motivoIgnorarAtivacao(["agente-on"], true)).toBe("modo_teste");
    expect(motivoIgnorarAtivacao(["agente-on", "teste-agente"], true)).toBeNull();
  });
});
