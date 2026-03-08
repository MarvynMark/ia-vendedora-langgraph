import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockFetch = mock(async () => new Response(JSON.stringify({ id: 1, board_step_id: 5 }), { status: 200 }));

import { criarToolAtualizarTarefa, criarToolAtualizarTarefaFollowup } from "../../src/tools/atualizar-tarefa.ts";

beforeEach(() => {
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({ id: 1, board_step_id: 5 }), { status: 200 }));
  globalThis.fetch = mockFetch as typeof fetch;
});

describe("criarToolAtualizarTarefa (main agent)", () => {
  const contexto = {
    idConta: "8",
    tarefa: { id: 10, board: { id: 2 } },
  };

  test("atualiza tarefa com chamada PATCH correta", async () => {
    const tool = criarToolAtualizarTarefa(contexto, "Etapa A: 5\nEtapa B: 6");
    const result = await tool.invoke({
      stepId: "5",
      title: "Novo Título",
      description: "Nova Descrição",
      endDate: "2026-04-01T10:00:00-03:00",
    });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("PATCH");
    expect(url).toContain("/kanban_boards/2/kanban_tasks/10");
    const body = JSON.parse(opts.body as string);
    expect(body.board_step_id).toBe(5);
  });

  test("retorna erro quando board ou task não encontrado", async () => {
    const contextoSemBoard = { idConta: "8", tarefa: {} };
    const tool = criarToolAtualizarTarefa(contextoSemBoard, "");
    const result = await tool.invoke({
      stepId: "5",
      title: "Titulo",
      description: "Desc",
      endDate: "2026-04-01T10:00:00-03:00",
    });
    const parsed = JSON.parse(result);
    expect(parsed.erro).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("criarToolAtualizarTarefaFollowup", () => {
  const contexto = { accountId: 8, boardId: 2, taskId: 10 };

  test("atualiza tarefa com step move", async () => {
    const tool = criarToolAtualizarTarefaFollowup(contexto, "Etapa A: 5", 3);
    const result = await tool.invoke({
      Description: "Novo acompanhamento",
      Kanban_Step: "5",
      End_Date: "2026-04-15T10:00:00-03:00",
    });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.board_step_id).toBe(5);
    expect(body.description).toBe("Novo acompanhamento");
  });
});
