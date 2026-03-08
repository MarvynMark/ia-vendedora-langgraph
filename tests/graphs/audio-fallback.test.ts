import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock external services before importing graph
const mockEnviarArquivo = mock(async () => ({ id: 1 }));
const mockEnviarMensagem = mock(async () => ({ id: 2 }));
const mockSalvarMensagem = mock(async () => {});
const mockFormatarTexto = mock(async (t: string) => t);
const mockMarcarComoLida = mock(async () => {});
const mockAtualizarPresenca = mock(async () => {});

const mockNoOp = mock(async () => {});
mock.module("../../src/services/chatwoot.ts", () => ({
  enviarArquivo: mockEnviarArquivo,
  enviarMensagem: mockEnviarMensagem,
  marcarComoLida: mockMarcarComoLida,
  atualizarPresenca: mockAtualizarPresenca,
  buscarMensagemPorId: mock(async () => null),
  adicionarEtiquetas: mockNoOp,
  atualizarContato: mockNoOp,
  atualizarAtributosConversa: mockNoOp,
  buscarConversa: mock(async () => ({ labels: [] })),
  removerEtiquetas: mockNoOp,
  listarMensagens: mock(async () => ({ payload: [] })),
  atualizarKanbanTask: mockNoOp,
  moverKanbanTask: mockNoOp,
  buscarKanbanBoard: mock(async () => ({ id: 1, board_steps: [] })),
}));

mock.module("../../src/db/memoria.ts", () => ({
  salvarMensagem: mockSalvarMensagem,
  buscarHistorico: mock(async () => []),
}));

mock.module("../../src/db/fila.ts", () => ({
  enfileirarMensagem: mock(async () => {}),
  buscarUltimaMensagem: mock(async () => null),
  coletarELimparMensagens: mock(async () => []),
}));

mock.module("../../src/db/lock.ts", () => ({
  tentarAdquirirLock: mock(async () => false),
  liberarLock: mock(async () => {}),
}));

mock.module("../../src/db/checkpointer.ts", () => ({
  obterCheckpointer: mock(async () => ({})),
  encerrarCheckpointer: mock(async () => {}),
}));

mock.module("../../src/services/elevenlabs.ts", () => ({
  gerarAudioTts: mock(async () => new Uint8Array([1, 2, 3])),
}));

mock.module("../../src/lib/response-formatter.ts", () => ({
  formatarTexto: mockFormatarTexto,
  formatarSsml: mock(async (t: string) => t),
  dividirMensagem: (t: string) => [t],
}));

const { enviarAudioNo } = await import("../../src/graphs/main-agent/graph.ts");
import type { MainAgentStateType } from "../../src/graphs/main-agent/state.ts";

function makeAudioState(overrides: Partial<MainAgentStateType> = {}): MainAgentStateType {
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
    mensagem: "",
    mensagemDeAudio: true,
    timestamp: new Date().toISOString(),
    tipoArquivo: null,
    idAnexo: null,
    urlArquivo: null,
    etiquetas: [],
    atributosContato: {},
    atributosConversa: "{}",
    tarefa: {},
    funil: {},
    mensagemProcessada: "",
    mensagemReferenciada: null,
    mensagensAgregadas: "",
    stale: false,
    lockTentativas: 0,
    locked: false,
    erroFatal: false,
    outputAgente: "Olá! Posso ajudar?",
    novasMensagens: false,
    respostaFormatada: "",
    ssml: "<speak>Olá! Posso ajudar?</speak>",
    audioBuffer: null,
    ...overrides,
  };
}

describe("enviarAudioNo — audio fallback path", () => {
  beforeEach(() => {
    mockEnviarArquivo.mockClear();
    mockEnviarMensagem.mockClear();
    mockSalvarMensagem.mockClear();
  });

  test("envia áudio quando audioBuffer está disponível", async () => {
    const state = makeAudioState({ audioBuffer: new Uint8Array([1, 2, 3]) });
    await enviarAudioNo(state);
    expect(mockEnviarArquivo).toHaveBeenCalledTimes(1);
    expect(mockEnviarMensagem).not.toHaveBeenCalled();
  });

  test("fallback para texto quando audioBuffer é null", async () => {
    const state = makeAudioState({ audioBuffer: null });
    await enviarAudioNo(state);
    expect(mockEnviarArquivo).not.toHaveBeenCalled();
    expect(mockEnviarMensagem).toHaveBeenCalled();
  });

  test("fallback para texto quando enviarArquivo lança erro", async () => {
    mockEnviarArquivo.mockRejectedValueOnce(new Error("audio upload failed"));
    const state = makeAudioState({ audioBuffer: new Uint8Array([1]) });
    await enviarAudioNo(state);
    // Should fallback to text after audio failure
    expect(mockEnviarMensagem).toHaveBeenCalled();
  });

  test("salva mensagem no histórico após envio de áudio", async () => {
    const state = makeAudioState({ audioBuffer: new Uint8Array([1]) });
    await enviarAudioNo(state);
    expect(mockSalvarMensagem).toHaveBeenCalledWith(
      state.telefone,
      expect.objectContaining({ type: "ai", content: state.outputAgente }),
    );
  });
});
