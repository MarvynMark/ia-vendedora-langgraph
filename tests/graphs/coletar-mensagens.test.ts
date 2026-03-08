import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock DB and services before importing
const mockColetarELimpar = mock(async () => "Mensagem 1\nMensagem 2");

mock.module("../../src/db/fila.ts", () => ({
  enfileirarMensagem: mock(async () => {}),
  buscarUltimaMensagem: mock(async () => null),
  coletarELimparMensagens: mockColetarELimpar,
}));

mock.module("../../src/db/memoria.ts", () => ({
  salvarMensagem: mock(async () => {}),
  buscarHistorico: mock(async () => []),
}));

mock.module("../../src/db/lock.ts", () => ({
  tentarAdquirirLock: mock(async () => false),
  liberarLock: mock(async () => {}),
}));

mock.module("../../src/db/checkpointer.ts", () => ({
  obterCheckpointer: mock(async () => ({})),
  encerrarCheckpointer: mock(async () => {}),
}));

mock.module("../../src/services/chatwoot.ts", () => ({
  enviarMensagem: mock(async () => {}),
  enviarArquivo: mock(async () => {}),
  marcarComoLida: mock(async () => {}),
  atualizarPresenca: mock(async () => {}),
  buscarMensagemPorId: mock(async () => null),
  adicionarEtiquetas: mock(async () => {}),
  atualizarContato: mock(async () => {}),
  atualizarAtributosConversa: mock(async () => {}),
  buscarConversa: mock(async () => ({ labels: [] })),
  removerEtiquetas: mock(async () => {}),
  listarMensagens: mock(async () => ({ payload: [] })),
  atualizarKanbanTask: mock(async () => {}),
  moverKanbanTask: mock(async () => {}),
  buscarKanbanBoard: mock(async () => ({ id: 1, board_steps: [] })),
}));

mock.module("../../src/services/elevenlabs.ts", () => ({
  gerarAudioTts: mock(async () => new Uint8Array([1])),
}));

mock.module("../../src/lib/response-formatter.ts", () => ({
  formatarTexto: mock(async (t: string) => t),
  formatarSsml: mock(async (t: string) => t),
  dividirMensagem: (t: string) => [t],
}));

const { coletarMensagens } = await import("../../src/graphs/main-agent/graph.ts");
import type { MainAgentStateType } from "../../src/graphs/main-agent/state.ts";

function makeState(overrides: Partial<MainAgentStateType> = {}): MainAgentStateType {
  return {
    messages: [],
    idMensagem: "1",
    idMensagemReferenciada: null,
    idConta: "8",
    idConversa: "100",
    idContato: "1",
    idInbox: "1",
    telefone: "+5511999999999",
    nome: "Teste",
    mensagem: "Olá",
    mensagemDeAudio: false,
    timestamp: new Date().toISOString(),
    tipoArquivo: null,
    idAnexo: null,
    urlArquivo: null,
    etiquetas: [],
    atributosContato: {},
    atributosConversa: "{}",
    tarefa: {},
    funil: {},
    mensagemProcessada: "Olá",
    mensagemReferenciada: null,
    mensagensAgregadas: "",
    stale: false,
    lockTentativas: 0,
    locked: false,
    erroFatal: false,
    outputAgente: "",
    novasMensagens: false,
    respostaFormatada: "",
    ssml: "",
    audioBuffer: null,
    ...overrides,
  };
}

describe("coletarMensagens", () => {
  beforeEach(() => {
    mockColetarELimpar.mockClear();
    mockColetarELimpar.mockImplementation(async () => "Mensagem 1\nMensagem 2");
  });

  test("retorna mensagensAgregadas da fila", async () => {
    const result = await coletarMensagens(makeState());
    expect(result.mensagensAgregadas).toBe("Mensagem 1\nMensagem 2");
    expect(mockColetarELimpar).toHaveBeenCalledWith("+5511999999999");
  });

  test("retorna erroFatal=true quando coletarELimpar lança erro", async () => {
    mockColetarELimpar.mockRejectedValueOnce(new Error("DB error"));
    const result = await coletarMensagens(makeState());
    expect(result.erroFatal).toBe(true);
    expect(result.mensagensAgregadas).toBe("");
  });

  test("usa o telefone do state como chave da fila", async () => {
    await coletarMensagens(makeState({ telefone: "+5521888888888" }));
    expect(mockColetarELimpar).toHaveBeenCalledWith("+5521888888888");
  });
});
