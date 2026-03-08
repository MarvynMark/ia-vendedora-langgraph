import { describe, test, expect, mock } from "bun:test";

mock.module("../../src/graphs/follow-up/graph.ts", () => ({
  criarGrafoFollowUp: mock(async () => ({
    invoke: mock(async () => ({})),
  })),
}));

mock.module("../../src/services/chatwoot.ts", () => ({
  atualizarKanbanTask: mock(async () => ({})),
  buscarKanbanBoard: mock(async () => ({ steps: [] })),
  enviarMensagem: mock(async () => ({})),
  moverKanbanTask: mock(async () => ({})),
}));

mock.module("../../src/db/memoria.ts", () => ({
  buscarHistorico: mock(async () => []),
  salvarMensagem: mock(async () => {}),
}));

mock.module("../../src/db/checkpointer.ts", () => ({
  obterCheckpointer: mock(async () => null),
}));

import { followupRouter } from "../../src/routes/followup.ts";

function makeRequest(body: object): Request {
  return new Request("http://localhost/webhook/followup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseTask = {
  id: 1,
  title: "Test Lead",
  description: "Paciente teste",
  due_date: null,
  board_step_id: 10,
  board_step: { id: 10, name: "Qualificado" },
  conversations: [
    {
      id: 100,
      inbox_id: 1,
      display_id: 42,
      contact: { phone_number: "+5511999999999", name: "Test" },
    },
  ],
};

describe("POST /webhook/followup", () => {
  test("kanban_task_updated - sets due_date for 'compareceu' step", async () => {
    const payload = {
      event: "kanban_task_updated",
      account_id: 8,
      board_id: 1,
      task: { ...baseTask, board_step: { id: 20, name: "Compareceu" } },
      changed_attributes: { board_step_id: [10, 20] },
    };
    const res = await followupRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; action: string };
    expect(data.status).toBe("ok");
    expect(data.action).toBe("due_date_set");
  });

  test("kanban_task_updated - ignores steps that are not tracked", async () => {
    const payload = {
      event: "kanban_task_updated",
      account_id: 8,
      board_id: 1,
      task: baseTask,
      changed_attributes: { board_step_id: [5, 10] },
    };
    const res = await followupRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; reason: string };
    expect(data.status).toBe("ignored");
    expect(data.reason).toBe("step_not_tracked");
  });

  test("kanban_task_updated - ignores when no step change", async () => {
    const payload = {
      event: "kanban_task_updated",
      account_id: 8,
      board_id: 1,
      task: baseTask,
    };
    const res = await followupRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; reason: string };
    expect(data.status).toBe("ignored");
    expect(data.reason).toBe("no_step_change");
  });

  test("kanban_task_overdue - triggers graph for valid task", async () => {
    const payload = {
      event: "kanban_task_overdue",
      account_id: 8,
      board_id: 1,
      task: baseTask,
    };
    const res = await followupRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string };
    expect(data.status).toBe("accepted");
  });

  test("unknown event - returns error (invalid payload)", async () => {
    const payload = {
      event: "kanban_task_deleted",
      account_id: 8,
      board_id: 1,
      task: baseTask,
    };
    const res = await followupRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; reason: string };
    expect(data.status).toBe("error");
    expect(data.reason).toBe("invalid_payload");
  });
});
