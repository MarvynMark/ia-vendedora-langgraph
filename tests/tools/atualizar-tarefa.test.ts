import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockFetch = mock(async () => new Response(JSON.stringify({ id: 1, board_step_id: 5 }), { status: 200 }));

import { criarToolAtualizarTarefa, criarToolAtualizarTarefaFollowup, sanitizarLinkEnviado } from "../../src/tools/atualizar-tarefa.ts";

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

// Conv 6987: a IA moveu o card p/ Aguardando Pagamento já com "link enviado" enquanto ainda
// perguntava "posso te mostrar os planos?". O marcador roteia a cadência para o lembrete de
// abandono de checkout (20min), e a lead levou "travou na hora de finalizar?" sem ter visto preço.
describe("sanitizarLinkEnviado", () => {
  const CARD = "🟢 - Concurso: Pcma\n🔁 - Follow-ups: 0\n👤 - Descrição: qualificando";

  test("LLM introduzindo 'link enviado' → rebaixado para 'em negociação'", () => {
    const tentativa = "🟢 - Concurso: Pcma\n🔁 - Follow-ups: 0\n👤 - Descrição: link enviado";
    expect(sanitizarLinkEnviado(tentativa, CARD)).toBe(
      "🟢 - Concurso: Pcma\n🔁 - Follow-ups: 0\n👤 - Descrição: em negociação",
    );
  });

  test("card que JÁ tinha o marcador (posto pelo código) preserva", () => {
    const jaTinha = "🟢 - Concurso: Pcma\n👤 - Descrição: link enviado";
    expect(sanitizarLinkEnviado(jaTinha, jaTinha)).toBe(jaTinha);
  });

  test("descrição sem o marcador passa intacta", () => {
    expect(sanitizarLinkEnviado(CARD, CARD)).toBe(CARD);
  });

  test("marcador fora da linha de status também é neutralizado", () => {
    expect(sanitizarLinkEnviado("obs: link enviado ao lead", "")).toBe("obs: em negociação ao lead");
  });
});

describe("criarToolAtualizarTarefa — status 'link enviado' sai das mãos do LLM", () => {
  test("rebaixa o status e usa a cadência pós-preço (1h), não a de lembrete (20min)", async () => {
    const contexto = {
      idConta: "8",
      tarefa: {
        id: 10,
        board: { id: 2, steps: [{ id: 8, name: "Aguardando Pagamento" }] },
        board_step_id: 10,
        description: "🟢 - Concurso: Pcma\n👤 - Descrição: qualificando",
      } as Record<string, unknown>,
    };
    const tool = criarToolAtualizarTarefa(contexto, "Aguardando Pagamento: 8");
    await tool.invoke({
      stepId: "8",
      title: "Jaqueline - Pcma",
      description: "🟢 - Concurso: Pcma\n👤 - Descrição: link enviado",
    });
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.description).toContain("Descrição: em negociação");
    expect(body.description).not.toContain("link enviado");
    // e o card atualizado fica visível para os guards do grafo no mesmo turno
    expect(contexto.tarefa["board_step_id"]).toBe(8);
    expect(String(contexto.tarefa["description"])).toContain("em negociação");
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
