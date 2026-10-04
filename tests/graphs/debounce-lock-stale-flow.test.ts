import { describe, test, expect } from "bun:test";
import { rotaStale, rotaLock, rotaNovasMsgs } from "../../src/graphs/main-agent/graph.ts";
import type { MainAgentStateType } from "../../src/graphs/main-agent/state.ts";

/**
 * Integration tests for the debounce → stale → lock → agent → send pipeline.
 * These tests verify the routing logic that controls the full flow through the
 * state machine without requiring actual DB or LLM calls.
 */

function makeState(overrides: Partial<MainAgentStateType>): MainAgentStateType {
  return {
    messages: [],
    idMensagem: "msg-1",
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

describe("debounce → stale → lock → agent → send pipeline", () => {
  describe("cenário: mensagem stale descartada após debounce", () => {
    test("stale=true → fluxo termina em end", () => {
      // After debounce, if message is no longer the latest → discard
      const state = makeState({ stale: true });
      expect(rotaStale(state)).toBe("end");
    });
  });

  describe("cenário: mensagem fresca com lock disponível", () => {
    test("stale=false → tenta adquirir lock", () => {
      const state = makeState({ stale: false });
      expect(rotaStale(state)).toBe("tentar_lock");
    });

    test("lock adquirido (locked=false) → prossegue para buscar_referenciada", () => {
      const state = makeState({ stale: false, locked: false, lockTentativas: 1 });
      expect(rotaLock(state)).toBe("buscar_referenciada");
    });
  });

  describe("cenário: lock em disputa — retry até esgotar tentativas", () => {
    test("locked=true, tentativa 1 → espera retry", () => {
      const state = makeState({ locked: true, lockTentativas: 1 });
      expect(rotaLock(state)).toBe("esperar_retry");
    });

    test("locked=true, tentativa 2 → espera retry", () => {
      const state = makeState({ locked: true, lockTentativas: 2 });
      expect(rotaLock(state)).toBe("esperar_retry");
    });

    test("locked=true, tentativas esgotadas (5) → end sem processar", () => {
      const state = makeState({ locked: true, lockTentativas: 5 });
      expect(rotaLock(state)).toBe("end");
    });
  });

  describe("cenário: agente processou, novas mensagens chegaram durante execução", () => {
    test("novasMensagens=true → liberar lock sem enviar resposta (descartar)", () => {
      const state = makeState({
        novasMensagens: true,
        outputAgente: "Resposta que será descartada",
      });
      expect(rotaNovasMsgs(state)).toBe("liberar_lock");
    });
  });

  describe("cenário: agente processou com sucesso — enviar resposta", () => {
    test("texto normal → formatar_texto → enviar_texto → liberar_lock", () => {
      const state = makeState({
        novasMensagens: false,
        outputAgente: "Olá! Posso ajudar com agendamento.",
        mensagemDeAudio: false,
      });
      expect(rotaNovasMsgs(state)).toBe("formatar_texto");
    });

    test("mensagem de áudio → formatar_ssml → gerar_audio → enviar_audio → liberar_lock", () => {
      const state = makeState({
        novasMensagens: false,
        outputAgente: "Olá! Posso ajudar com agendamento.",
        mensagemDeAudio: true,
      });
      expect(rotaNovasMsgs(state)).toBe("formatar_ssml");
    });
  });

  describe("cenário: agente parou por max iterations", () => {
    test("outputAgente startsWith 'Agent stopped' → liberar_lock sem enviar", () => {
      const state = makeState({
        novasMensagens: false,
        outputAgente: "Agent stopped due to max iterations.",
      });
      expect(rotaNovasMsgs(state)).toBe("liberar_lock");
    });
  });

  describe("cenário: erro fatal em qualquer etapa", () => {
    test("erroFatal=true após agente → enviar_erro_fallback", () => {
      const state = makeState({
        erroFatal: true,
        novasMensagens: false,
        outputAgente: "partial output",
      });
      expect(rotaNovasMsgs(state)).toBe("enviar_erro_fallback");
    });
  });
});
