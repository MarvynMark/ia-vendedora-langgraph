import { describe, test, expect, mock, beforeEach } from "bun:test";

// Guard determinístico que move o card para "Aguardando Pagamento" quando o preço é apresentado.
// Sem ele a SEQUENCIA_POS_PRECO (que leva o áudio de recuperação do Walker) não roda: só 13 dos
// 61 leads que ouviram o preço desde 17/08 chegaram àquela etapa, e o áudio disparou 1 vez em 8 dias.

const mockAtualizarKanbanTask = mock(async () => ({}));
const mockNoOp = mock(async () => {});

// Mantém o módulo REAL e troca só atualizarKanbanTask: um mock com stubs para o módulo inteiro
// vaza para os outros arquivos de teste da suíte (o registry do bun:test é do processo) e derruba
// os testes dos filtros de saída, que vivem neste mesmo módulo.
const chatwootReal = await import("../../src/services/chatwoot.ts");
mock.module("../../src/services/chatwoot.ts", () => ({
  ...chatwootReal,
  atualizarKanbanTask: mockAtualizarKanbanTask,
}));

mock.module("../../src/db/memoria.ts", () => ({
  salvarMensagem: mockNoOp,
  buscarHistorico: mock(async () => []),
}));
mock.module("../../src/db/fila.ts", () => ({
  enfileirarMensagem: mockNoOp,
  buscarUltimaMensagem: mock(async () => null),
  coletarELimparMensagens: mock(async () => []),
}));
mock.module("../../src/db/lock.ts", () => ({
  tentarAdquirirLock: mock(async () => false),
  liberarLock: mockNoOp,
}));
mock.module("../../src/db/checkpointer.ts", () => ({
  obterCheckpointer: mock(async () => ({})),
  encerrarCheckpointer: mockNoOp,
}));

const { comStatusNaDescricao, moverParaAguardandoPagamento, desfazerPagamentoPrematuro } = await import(
  "../../src/graphs/main-agent/graph.ts"
);

const ETAPAS = [
  { id: 1, name: "Novo Lead" },
  { id: 7, name: "Primeira mensagem" },
  { id: 10, name: "Conexão" },
  { id: 8, name: "Aguardando Pagamento" },
  { id: 9, name: "Ganho" },
  { id: 11, name: "Perdido" },
];

const DESCRICAO = "🟣 - Concurso: PCDF\n🔁 - Follow-ups: 0\n👤 - Descrição: qualificando";

describe("comStatusNaDescricao", () => {
  test("troca só a linha de status, preservando o resto do card", () => {
    expect(comStatusNaDescricao(DESCRICAO, "em negociação")).toBe(
      "🟣 - Concurso: PCDF\n🔁 - Follow-ups: 0\n👤 - Descrição: em negociação",
    );
  });

  test("descrição sem a linha de status ganha uma", () => {
    expect(comStatusNaDescricao("🟣 - Concurso: PCDF", "em negociação")).toBe(
      "🟣 - Concurso: PCDF\n👤 - Descrição: em negociação",
    );
  });

  test("descrição vazia", () => {
    expect(comStatusNaDescricao("", "em negociação")).toBe("👤 - Descrição: em negociação");
  });
});

describe("moverParaAguardandoPagamento", () => {
  beforeEach(() => mockAtualizarKanbanTask.mockClear());

  test("move de Conexão e marca 'em negociação'", async () => {
    const tarefa: Record<string, unknown> = { id: 55, board_step_id: 10, description: DESCRICAO };
    await moverParaAguardandoPagamento("1", tarefa, ETAPAS, false);
    expect(mockAtualizarKanbanTask).toHaveBeenCalledTimes(1);
    const [, taskId, dados] = mockAtualizarKanbanTask.mock.calls[0] as unknown as [string, number, { board_step_id: number; description: string }];
    expect(taskId).toBe(55);
    expect(dados.board_step_id).toBe(8);
    expect(dados.description).toContain("Descrição: em negociação");
    expect(tarefa["board_step_id"]).toBe(8); // reflete no turno atual
  });

  test("com link de pagamento na mesma resposta, marca 'link enviado' (roteia p/ a cadência de lembrete)", async () => {
    const tarefa: Record<string, unknown> = { id: 56, board_step_id: 10, description: DESCRICAO };
    await moverParaAguardandoPagamento("1", tarefa, ETAPAS, true);
    const [, , dados] = mockAtualizarKanbanTask.mock.calls[0] as unknown as [string, number, { description: string }];
    expect(dados.description).toContain("Descrição: link enviado");
  });

  test("move também de Novo Lead e de Primeira mensagem", async () => {
    for (const step of [1, 7]) {
      mockAtualizarKanbanTask.mockClear();
      await moverParaAguardandoPagamento("1", { id: 1, board_step_id: step, description: "" }, ETAPAS, false);
      expect(mockAtualizarKanbanTask).toHaveBeenCalledTimes(1);
    }
  });

  test("NÃO regride: card em Ganho, Perdido ou já em Aguardando Pagamento sem link fica onde está", async () => {
    for (const step of [8, 9, 11]) {
      mockAtualizarKanbanTask.mockClear();
      await moverParaAguardandoPagamento("1", { id: 1, board_step_id: step, description: "" }, ETAPAS, false);
      expect(mockAtualizarKanbanTask).not.toHaveBeenCalled();
    }
  });

  // O marcador "link enviado" saiu das mãos do LLM (tools/atualizar-tarefa.ts), então este guard
  // é o único que ainda pode escrevê-lo — inclusive num card que o próprio LLM já pôs no step 8.
  test("card já em Aguardando Pagamento é promovido a 'link enviado' quando o link sai", async () => {
    const tarefa: Record<string, unknown> = { id: 57, board_step_id: 8, description: comStatusNaDescricao(DESCRICAO, "em negociação") };
    await moverParaAguardandoPagamento("1", tarefa, ETAPAS, true);
    expect(mockAtualizarKanbanTask).toHaveBeenCalledTimes(1);
    const [, , dados] = mockAtualizarKanbanTask.mock.calls[0] as unknown as [string, number, { board_step_id: number; description: string }];
    expect(dados.board_step_id).toBe(8);
    expect(dados.description).toContain("Descrição: link enviado");
    expect(String(tarefa["description"])).toContain("link enviado");
  });

  test("card já em Aguardando Pagamento que JÁ tem o marcador não é reescrito", async () => {
    const tarefa: Record<string, unknown> = { id: 58, board_step_id: 8, description: comStatusNaDescricao(DESCRICAO, "link enviado") };
    await moverParaAguardandoPagamento("1", tarefa, ETAPAS, true);
    expect(mockAtualizarKanbanTask).not.toHaveBeenCalled();
  });
});

// Conv 6987: o prompt manda mover o card ANTES de enviar o preço, o gate de material bloqueou o
// pitch depois disso, e a lead ficou em "Aguardando Pagamento" sem nunca ter visto um valor —
// entrando na cadência de recuperação de quem viu o preço e sumiu.
describe("desfazerPagamentoPrematuro", () => {
  beforeEach(() => mockAtualizarKanbanTask.mockClear());

  test("card movido p/ Aguardando Pagamento NESTE turno, sem preço, volta pra Conexão", async () => {
    const tarefa: Record<string, unknown> = { id: 60, board_step_id: 8, description: comStatusNaDescricao(DESCRICAO, "em negociação") };
    await desfazerPagamentoPrematuro("1", tarefa, ETAPAS, 10);
    expect(mockAtualizarKanbanTask).toHaveBeenCalledTimes(1);
    const [, , dados] = mockAtualizarKanbanTask.mock.calls[0] as unknown as [string, number, { board_step_id: number; description: string }];
    expect(dados.board_step_id).toBe(10);
    expect(dados.description).toContain("Descrição: qualificando");
    expect(tarefa["board_step_id"]).toBe(10);
  });

  test("card que JÁ estava em Aguardando Pagamento antes do turno não é mexido", async () => {
    await desfazerPagamentoPrematuro("1", { id: 61, board_step_id: 8, description: "" }, ETAPAS, 8);
    expect(mockAtualizarKanbanTask).not.toHaveBeenCalled();
  });

  test("card em qualquer outra etapa não é mexido", async () => {
    for (const step of [1, 7, 10, 9, 11]) {
      mockAtualizarKanbanTask.mockClear();
      await desfazerPagamentoPrematuro("1", { id: 62, board_step_id: step, description: "" }, ETAPAS, 10);
      expect(mockAtualizarKanbanTask).not.toHaveBeenCalled();
    }
  });

  test("falha da API não propaga", async () => {
    mockAtualizarKanbanTask.mockImplementationOnce(async () => { throw new Error("500"); });
    await desfazerPagamentoPrematuro("1", { id: 63, board_step_id: 8, description: "" }, ETAPAS, 10);
  });

  test("board sem a etapa 'Aguardando Pagamento' → não faz nada (em vez de quebrar)", async () => {
    await moverParaAguardandoPagamento("1", { id: 1, board_step_id: 10, description: "" }, [{ id: 10, name: "Conexão" }], false);
    expect(mockAtualizarKanbanTask).not.toHaveBeenCalled();
  });

  test("falha da API não propaga (o lead recebe a mensagem mesmo assim)", async () => {
    mockAtualizarKanbanTask.mockImplementationOnce(async () => { throw new Error("500"); });
    await moverParaAguardandoPagamento("1", { id: 1, board_step_id: 10, description: "" }, ETAPAS, false);
  });
});
