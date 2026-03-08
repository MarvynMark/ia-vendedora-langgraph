import { describe, test, expect } from "bun:test";
import { rotaStale, rotaLock, rotaNovasMsgs } from "../../src/graphs/main-agent/graph.ts";
import type { MainAgentStateType } from "../../src/graphs/main-agent/state.ts";

function makeState(overrides: Partial<MainAgentStateType>): MainAgentStateType {
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
    mensagemProcessada: "",
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

describe("rotaStale", () => {
  test("stale=true → end", () => {
    expect(rotaStale(makeState({ stale: true }))).toBe("end");
  });

  test("stale=false → tentar_lock", () => {
    expect(rotaStale(makeState({ stale: false }))).toBe("tentar_lock");
  });
});

describe("rotaLock", () => {
  test("não bloqueado → buscar_referenciada", () => {
    expect(rotaLock(makeState({ locked: false, lockTentativas: 0 }))).toBe("buscar_referenciada");
  });

  test("bloqueado, tentativas esgotadas → end", () => {
    // LOCK_MAX_RETRIES defaults to 5 in test env
    expect(rotaLock(makeState({ locked: true, lockTentativas: 5 }))).toBe("end");
  });

  test("bloqueado, tentativas não esgotadas → esperar_retry", () => {
    expect(rotaLock(makeState({ locked: true, lockTentativas: 1 }))).toBe("esperar_retry");
  });
});

describe("rotaNovasMsgs", () => {
  test("erroFatal → enviar_erro_fallback", () => {
    expect(rotaNovasMsgs(makeState({ erroFatal: true, novasMensagens: false, outputAgente: "resposta" }))).toBe("enviar_erro_fallback");
  });

  test("novas mensagens → liberar_lock", () => {
    expect(rotaNovasMsgs(makeState({ novasMensagens: true, outputAgente: "resposta" }))).toBe("liberar_lock");
  });

  test("sem output → liberar_lock", () => {
    expect(rotaNovasMsgs(makeState({ novasMensagens: false, outputAgente: "" }))).toBe("liberar_lock");
  });

  test("output 'Agent stopped' → liberar_lock", () => {
    expect(rotaNovasMsgs(makeState({ novasMensagens: false, outputAgente: "Agent stopped" }))).toBe("liberar_lock");
  });

  test("output 'Agent stopped due to max iterations.' → liberar_lock", () => {
    expect(rotaNovasMsgs(makeState({ novasMensagens: false, outputAgente: "Agent stopped due to max iterations." }))).toBe("liberar_lock");
  });

  test("output com espaços → liberar_lock", () => {
    expect(rotaNovasMsgs(makeState({ novasMensagens: false, outputAgente: "   " }))).toBe("liberar_lock");
  });

  test("mensagem de texto com output → formatar_texto", () => {
    expect(rotaNovasMsgs(makeState({
      novasMensagens: false,
      outputAgente: "Olá, posso ajudar?",
      mensagemDeAudio: false,
    }))).toBe("formatar_texto");
  });

  test("mensagem de áudio com output → formatar_ssml", () => {
    expect(rotaNovasMsgs(makeState({
      novasMensagens: false,
      outputAgente: "Olá, posso ajudar?",
      mensagemDeAudio: true,
    }))).toBe("formatar_ssml");
  });
});
