import { describe, test, expect } from "bun:test";
import { rotaClassificacao, rotaPosEnvio } from "../../src/graphs/follow-up/graph.ts";
import type { FollowUpStateType } from "../../src/graphs/follow-up/state.ts";

function makeState(overrides: Partial<FollowUpStateType>): FollowUpStateType {
  return {
    messages: [],
    accountId: 8,
    boardId: 1,
    taskId: 1,
    board_step: { id: 1, name: "Qualificado" },
    title: "Test",
    description: "",
    dueDate: "",
    telefone: "+5511999999999",
    conversationId: 100,
    inboxId: 1,
    displayId: 1,
    funilSteps: [],
    idEtapaPerdido: 0,
    tipoFollowup: "followup",
    respostaAgente: "",
    ...overrides,
  };
}

describe("rotaClassificacao", () => {
  test("followup → agente_followup", () => {
    expect(rotaClassificacao(makeState({ tipoFollowup: "followup" }))).toBe("agente_followup");
  });

  test("lembrete → agente_lembrete", () => {
    expect(rotaClassificacao(makeState({ tipoFollowup: "lembrete" }))).toBe("agente_lembrete");
  });

  test("pos_consulta → agente_pos_consulta", () => {
    expect(rotaClassificacao(makeState({ tipoFollowup: "pos_consulta" }))).toBe("agente_pos_consulta");
  });

  test("ignorar → ignorar (routes to __end__)", () => {
    expect(rotaClassificacao(makeState({ tipoFollowup: "ignorar" }))).toBe("ignorar");
  });
});

describe("rotaPosEnvio", () => {
  test("pos_consulta → mover_pos_venda", () => {
    expect(rotaPosEnvio(makeState({ tipoFollowup: "pos_consulta" }))).toBe("mover_pos_venda");
  });

  test("followup → end", () => {
    expect(rotaPosEnvio(makeState({ tipoFollowup: "followup" }))).toBe("end");
  });

  test("lembrete → end", () => {
    expect(rotaPosEnvio(makeState({ tipoFollowup: "lembrete" }))).toBe("end");
  });

  test("ignorar → end", () => {
    expect(rotaPosEnvio(makeState({ tipoFollowup: "ignorar" }))).toBe("end");
  });
});
