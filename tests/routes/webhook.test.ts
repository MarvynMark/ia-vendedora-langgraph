import { describe, test, expect, mock } from "bun:test";

// Mock all external dependencies before importing the webhook router
mock.module("../../src/graphs/main-agent/graph.ts", () => ({
  criarGrafoAgenteClinica: mock(async () => ({
    invoke: mock(async () => ({})),
  })),
}));

mock.module("../../src/lib/message-processor.ts", () => ({
  processarMensagem: mock(async () => ({
    idMensagem: "1",
    idConta: "8",
    idConversa: "100",
    idContato: "1",
    idInbox: "1",
    telefone: "+5511999999999",
    nome: "Test",
    mensagem: "test",
    mensagemProcessada: "test",
    mensagemDeAudio: false,
    timestamp: "2026-01-01T00:00:00Z",
    tipoArquivo: null,
    idAnexo: null,
    urlArquivo: null,
    etiquetas: ["teste-agente"],
    atributosContato: {},
    atributosConversa: "{}",
    idMensagemReferenciada: null,
  })),
}));

mock.module("../../src/db/fila.ts", () => ({
  limparFila: mock(async () => {}),
  enfileirarMensagem: mock(async () => {}),
  buscarUltimaMensagem: mock(async () => null),
  coletarELimparMensagens: mock(async () => ""),
}));

mock.module("../../src/db/lock.ts", () => ({
  limparLock: mock(async () => {}),
  verificarLock: mock(async () => false),
  adquirirLock: mock(async () => {}),
  liberarLock: mock(async () => {}),
}));

mock.module("../../src/db/memoria.ts", () => ({
  limparHistorico: mock(async () => {}),
  buscarHistorico: mock(async () => []),
  salvarMensagem: mock(async () => {}),
}));

mock.module("../../src/db/pool.ts", () => ({
  pool: { query: mock(async () => ({ rows: [] })) },
}));

mock.module("../../src/services/chatwoot.ts", () => ({
  adicionarEtiquetas: mock(async () => ({})),
  enviarMensagem: mock(async () => ({})),
  atualizarContato: mock(async () => ({})),
  atualizarAtributosConversa: mock(async () => ({})),
  buscarConversa: mock(async () => ({ kanban_task: {}, kanban_board: {} })),
  marcarComoLida: mock(async () => ({})),
  atualizarPresenca: mock(async () => ({})),
  removerEtiquetas: mock(async () => ({})),
}));

import { webhookRouter } from "../../src/routes/webhook.ts";

function makeRequest(body: object): Request {
  return new Request("http://localhost/webhook/chatwoot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const basePayload = {
  event: "message_created",
  id: 1,
  content: "Olá",
  content_type: "text",
  content_attributes: {},
  message_type: 0,
  created_at: Date.now() / 1000,
  account: { id: 8 },
  conversation: { id: 100, inbox_id: 1, labels: ["teste-agente"] },
  sender: { id: 1, name: "Test", phone_number: "+5511999999999" },
};

describe("webhook /webhook/chatwoot", () => {
  test("ignora mensagens não incoming (message_type !== 0)", async () => {
    const payload = { ...basePayload, message_type: 1 };
    const res = await webhookRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; reason: string };
    expect(data.status).toBe("ignored");
    expect(data.reason).toBe("not_incoming");
  });

  test("ignora mensagens com label agente-on", async () => {
    const payload = {
      ...basePayload,
      conversation: { ...basePayload.conversation, labels: ["agente-on"] },
    };
    const res = await webhookRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; reason: string };
    expect(data.status).toBe("ignored");
    expect(data.reason).toBe("agente-on");
  });

  test("ignora mensagens sem label teste-agente", async () => {
    const payload = {
      ...basePayload,
      conversation: { ...basePayload.conversation, labels: [] },
    };
    const res = await webhookRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; reason: string };
    expect(data.status).toBe("ignored");
    expect(data.reason).toBe("no_teste-agente");
  });

  test("/teste adiciona label antes dos filtros de ativação", async () => {
    const payload = {
      ...basePayload,
      content: "/teste",
      conversation: { ...basePayload.conversation, labels: [] },
    };
    const res = await webhookRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; action: string };
    expect(data.status).toBe("ok");
    expect(data.action).toBe("label_added");
  });

  test("/reset retorna ok quando há label teste-agente", async () => {
    const payload = {
      ...basePayload,
      content: "/reset",
    };
    const res = await webhookRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; action: string };
    expect(data.status).toBe("ok");
    expect(data.action).toBe("reset");
  });

  test("mensagem válida com teste-agente é aceita para processamento", async () => {
    const res = await webhookRouter.handle(makeRequest(basePayload));
    const data = await res.json() as { status: string };
    expect(data.status).toBe("accepted");
  });

  test("agente-on tem prioridade mesmo com teste-agente", async () => {
    const payload = {
      ...basePayload,
      conversation: { ...basePayload.conversation, labels: ["teste-agente", "agente-on"] },
    };
    const res = await webhookRouter.handle(makeRequest(payload));
    const data = await res.json() as { status: string; reason: string };
    expect(data.status).toBe("ignored");
    expect(data.reason).toBe("agente-on");
  });
});
