import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock fetch for chatwoot HTTP calls
const mockFetch = mock(async () => new Response(JSON.stringify({}), { status: 200 }));

import { criarToolEscalarHumano } from "../../src/tools/escalar-humano.ts";
import { env } from "../../src/config/env.ts";

const contexto = {
  telefone: "+5511999999999",
  nome: "João Silva",
  idConta: "8",
  idConversa: "100",
  idInbox: "1",
  ultimaMensagem: "quero falar com alguém",
};

beforeEach(() => {
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  globalThis.fetch = mockFetch as typeof fetch;
});

describe("criarToolEscalarHumano", () => {
  test("remove a etiqueta agente-on da conversa (pausa a IA)", async () => {
    const tool = criarToolEscalarHumano(contexto);
    await tool.invoke({ resumoConversa: "paciente quer agendar urgência" });
    const labelCall = mockFetch.mock.calls.find(c => {
      const [url, opts] = c as [string, RequestInit];
      return url.includes("/conversations/100/labels") && opts?.method === "POST";
    });
    expect(labelCall).toBeDefined();
    const body = JSON.parse((labelCall as [string, RequestInit])[1]!.body as string);
    // Pausa = remover a label; ela NÃO pode aparecer na lista final enviada.
    expect(body.labels).not.toContain("agente-on");
  });

  test("cria nota PRIVADA na conversa do lead com o resumo", async () => {
    const tool = criarToolEscalarHumano(contexto);
    await tool.invoke({ resumoConversa: "paciente quer agendar urgência" });
    const notaCall = mockFetch.mock.calls.find(c => {
      const [url, opts] = c as [string, RequestInit];
      if (!url.includes("/conversations/100/messages") || opts?.method !== "POST") return false;
      const body = JSON.parse(opts.body as string);
      return body.private === true;
    });
    expect(notaCall).toBeDefined();
    const body = JSON.parse((notaCall as [string, RequestInit])[1]!.body as string);
    expect(body.private).toBe(true);
    expect(body.content).toContain("paciente quer agendar urgência");
    expect(body.content).toContain("quero falar com alguém"); // última mensagem do lead
  });

  // O destino é o GRUPO DO COMERCIAL, não o da mentoria. Este teste identificava o alerta por
  // exclusão ("qualquer /messages que não seja o do lead") e por isso passaria mesmo se o aviso
  // fosse para a conversa errada — agora ele confere o ID.
  test("envia o alerta para o grupo do comercial, com link da conversa", async () => {
    const tool = criarToolEscalarHumano(contexto);
    await tool.invoke({ resumoConversa: "paciente quer agendar urgência" });
    const msgCall = mockFetch.mock.calls.find(c => {
      const [url, opts] = c as [string, RequestInit];
      return url.includes(`/conversations/${env.CHATWOOT_COMERCIAL_CONVERSATION_ID}/messages`) && opts?.method === "POST";
    });
    expect(msgCall).toBeDefined();
    const body = JSON.parse((msgCall as [string, RequestInit])[1]!.body as string);
    expect(body.private).toBeFalsy(); // o grupo lê a mensagem, não é nota interna
    expect(body.content).toContain("João Silva");
    expect(body.content).toContain("+5511999999999");
    expect(body.content).toContain("paciente quer agendar urgência");
    expect(body.content).toContain("/conversations/100"); // deep link pra conversa do lead
  });

  test("não manda o alerta para o grupo da mentoria", async () => {
    const tool = criarToolEscalarHumano(contexto);
    await tool.invoke({ resumoConversa: "resumo" });
    const naMentoria = mockFetch.mock.calls.some(c => {
      const [url] = c as [string, RequestInit];
      return url.includes(`/conversations/${env.CHATWOOT_ALERT_CONVERSATION_ID}/messages`);
    });
    expect(naMentoria).toBe(false);
  });

  test("retorna resultado de sucesso", async () => {
    const tool = criarToolEscalarHumano(contexto);
    const result = await tool.invoke({ resumoConversa: "resumo" });
    const parsed = JSON.parse(result);
    expect(parsed.resultado).toBe("ok");
  });
});
