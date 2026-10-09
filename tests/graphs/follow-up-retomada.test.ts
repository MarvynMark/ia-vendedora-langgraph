import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { FollowUpStateType } from "../../src/graphs/follow-up/state.ts";

// Conv 9883: a lead disse "na próxima semana" e no dia seguinte recebeu o PDF de comprovante PIX.
// Com "📅 - Retomar em" no card, nenhum toque sai antes do dia.

// Preserva o módulo real: mock.module vaza entre arquivos no bun (ver follow-up-template-historico).
const atualizarCalls: Array<{ taskId: unknown; dados: unknown }> = [];
const chatwootReal = await import("../../src/services/chatwoot.ts");
mock.module("../../src/services/chatwoot.ts", () => ({
  ...chatwootReal,
  atualizarKanbanTask: async (_conta: unknown, taskId: unknown, dados: unknown) => { atualizarCalls.push({ taskId, dados }); },
}));
const { verificarRetomada, rotaClassificacao } = await import("../../src/graphs/follow-up/graph.ts");

beforeEach(() => { atualizarCalls.length = 0; });

const CARD = "🟢 - Concurso: PCDF\n🔁 - Follow-ups: 2\n👤 - Descrição: em negociação\n📅 - Retomar em: 12/10/2026 (seg) — vai decidir na próxima semana";
const ANTES = new Date("2026-10-09T13:00:00Z");
const NO_DIA = new Date("2026-10-12T13:10:00Z");

function state(overrides: Partial<FollowUpStateType>): FollowUpStateType {
  return {
    messages: [], accountId: 8, boardId: 1, taskId: 42,
    board_step: { id: 3, name: "Conexão" },
    title: "Giovanna", description: CARD, dueDate: "", telefone: "+5534992900004",
    conversationId: 9883, inboxId: 11, displayId: 9883,
    funilSteps: [], idEtapaPerdido: 0, idEtapaNutrir: 0,
    tipoFollowup: "followup", retomadaVencida: false, respostaAgente: "",
    ...overrides,
  };
}

describe("verificarRetomada", () => {
  test("antes do dia: não envia nada e reagenda o card para 10:05 do dia combinado", async () => {
    const s = state({});
    const r = await verificarRetomada(s, ANTES);
    expect(r).toEqual({ tipoFollowup: "ignorar" });
    expect(rotaClassificacao({ ...s, ...r })).toBe("ignorar");
    expect(atualizarCalls).toEqual([{ taskId: 42, dados: { due_date: "2026-10-12T13:05:00.000Z" } }]);
  });

  test("vale também pro lembrete (link enviado) e pro nutrir", async () => {
    expect((await verificarRetomada(state({ tipoFollowup: "lembrete" }), ANTES)).tipoFollowup).toBe("ignorar");
    expect((await verificarRetomada(state({ tipoFollowup: "nutrir" }), ANTES)).tipoFollowup).toBe("ignorar");
  });

  test("no dia: vai para o agente de retomada", async () => {
    const s = state({});
    const r = await verificarRetomada(s, NO_DIA);
    expect(r).toEqual({ retomadaVencida: true });
    expect(rotaClassificacao({ ...s, ...r })).toBe("agente_retomada");
    expect(atualizarCalls).toHaveLength(0);
  });

  test("sem retomada no card: segue a cadência normal", async () => {
    const s = state({ description: "🟢 - Concurso: PCDF\n🔁 - Follow-ups: 2" });
    const r = await verificarRetomada(s, ANTES);
    expect(r).toEqual({});
    expect(rotaClassificacao({ ...s, ...r })).toBe("agente_followup");
  });

  test("boas-vindas (Ganho) não é segurada pela retomada", async () => {
    const r = await verificarRetomada(state({ tipoFollowup: "boas_vindas" }), ANTES);
    expect(r).toEqual({});
    expect(atualizarCalls).toHaveLength(0);
  });
});
