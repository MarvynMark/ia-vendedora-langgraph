import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock global fetch before importing service
const mockFetch = mock(async () =>
  new Response(JSON.stringify({ id: 1 }), { status: 200 })
);

import {
  enviarMensagem,
  enviarArquivo,
  marcarComoLida,
  atualizarPresenca,
  atualizarAtributosConversa,
  adicionarEtiquetas,
  atualizarContato,
  listarMensagens,
  buscarMensagemPorId,
  buscarKanbanBoard,
  moverKanbanTask,
  removerEtiquetas,
  buscarConversa,
} from "../../src/services/chatwoot.ts";

describe("chatwoot service", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockImplementation(async () =>
      new Response(JSON.stringify({ id: 1 }), { status: 200 })
    );
    globalThis.fetch = mockFetch as typeof fetch;
  });

  describe("enviarMensagem", () => {
    test("usa URL correta com account e conversation", async () => {
      await enviarMensagem("8", "100", "Olá");
      const [url] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/accounts/8/");
      expect(url as string).toContain("/conversations/100/messages");
    });

    test("envia content e message_type corretos", async () => {
      await enviarMensagem("8", "100", "Olá");
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.content).toBe("Olá");
      expect(body.message_type).toBe("outgoing");
    });

    test("lança erro em resposta não-ok após retries", async () => {
      mockFetch.mockImplementation(async () =>
        new Response("Internal Error", { status: 500 })
      );
      await expect(enviarMensagem("8", "100", "test")).rejects.toThrow("500");
    });
  });

  describe("marcarComoLida", () => {
    test("usa URL update_last_seen", async () => {
      await marcarComoLida("8", "100");
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/update_last_seen");
      expect(options!.method).toBe("POST");
    });
  });

  describe("atualizarPresenca", () => {
    test("envia typing_status=on quando typing=true", async () => {
      await atualizarPresenca("8", "100", true);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/toggle_typing_status");
      const body = JSON.parse(options!.body as string);
      expect(body.typing_status).toBe("on");
    });

    test("envia typing_status=off quando typing=false", async () => {
      await atualizarPresenca("8", "100", false);
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.typing_status).toBe("off");
    });

    test("envia typing_status=recording quando status='recording'", async () => {
      await atualizarPresenca("8", "100", "recording");
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.typing_status).toBe("recording");
    });
  });

  describe("atualizarAtributosConversa", () => {
    test("usa PATCH para conversa", async () => {
      await atualizarAtributosConversa("8", "100", { motivo_cancelamento: "desistência" });
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100");
      expect(options!.method).toBe("PATCH");
    });

    test("envia custom_attributes corretamente", async () => {
      await atualizarAtributosConversa("8", "100", { motivo_cancelamento: "desistência" });
      const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(body.custom_attributes.motivo_cancelamento).toBe("desistência");
    });
  });

  describe("adicionarEtiquetas", () => {
    test("busca labels existentes e faz merge antes de postar", async () => {
      // First call (buscarConversa) returns existing labels
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ labels: ["existente"] }), { status: 200 })
      );
      await adicionarEtiquetas("8", "100", ["testando-agente"]);

      // Second call is the POST to /labels with merged set
      const labelCall = mockFetch.mock.calls.find(c => {
        const [url, opts] = c as [string, RequestInit];
        return (url as string).includes("/conversations/100/labels") && opts?.method === "POST";
      });
      expect(labelCall).toBeDefined();
      const body = JSON.parse((labelCall as [string, RequestInit])[1]!.body as string);
      expect(body.labels).toContain("existente");
      expect(body.labels).toContain("testando-agente");
    });
  });

  describe("atualizarContato", () => {
    test("usa PATCH para contato", async () => {
      await atualizarContato("8", "42", { procedimento_interesse: null });
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/contacts/42");
      expect(options!.method).toBe("PATCH");
    });
  });

  describe("listarMensagens", () => {
    test("usa GET para listar mensagens da conversa", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ payload: [{ id: 1, content: "oi" }] }), { status: 200 })
      );
      const result = await listarMensagens("8", "100") as { payload: unknown[] };
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/messages");
      expect((options as RequestInit).method).toBe("GET");
      expect(result.payload).toHaveLength(1);
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(listarMensagens("8", "100")).rejects.toThrow("500");
    });
  });

  describe("buscarMensagemPorId", () => {
    test("retorna conteúdo via endpoint direto (caminho rápido)", async () => {
      // Direct endpoint succeeds
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ id: 42, content: "mensagem direta" }), { status: 200 })
      );
      const result = await buscarMensagemPorId("8", "100", 42);
      expect(result).toBe("mensagem direta");
      // Only one fetch call needed (direct endpoint)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("fallback para lista quando endpoint direto retorna 404", async () => {
      // Direct endpoint returns 404
      mockFetch.mockImplementationOnce(async () =>
        new Response("Not Found", { status: 404 })
      );
      // List endpoint returns all messages
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ payload: [
          { id: 1, content: "primeira" },
          { id: 42, content: "mensagem buscada" },
        ] }), { status: 200 })
      );
      const result = await buscarMensagemPorId("8", "100", 42);
      expect(result).toBe("mensagem buscada");
    });

    test("retorna null quando mensagem não encontrada na lista (fallback)", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Not Found", { status: 404 })
      );
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ payload: [{ id: 1, content: "outra" }] }), { status: 200 })
      );
      const result = await buscarMensagemPorId("8", "100", 99);
      expect(result).toBeNull();
    });

    test("retorna null em caso de erro", async () => {
      mockFetch.mockImplementationOnce(async () => {
        throw new Error("Network error");
      });
      const result = await buscarMensagemPorId("8", "100", 1);
      expect(result).toBeNull();
    });
  });

  describe("buscarConversa", () => {
    test("usa GET para buscar conversa", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ id: 100, labels: ["tag1"] }), { status: 200 })
      );
      const result = await buscarConversa("8", "100") as { id: number; labels: string[] };
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100");
      expect((options as RequestInit).method).toBe("GET");
      expect(result.id).toBe(100);
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Not Found", { status: 404 })
      );
      await expect(buscarConversa("8", "999")).rejects.toThrow("404");
    });
  });

  describe("buscarKanbanBoard", () => {
    test("usa GET para buscar kanban board", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ id: 1, name: "Board" }), { status: 200 })
      );
      await buscarKanbanBoard("8", "1");
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/kanban_boards/1");
      expect((options as RequestInit).method).toBe("GET");
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(buscarKanbanBoard("8", "1")).rejects.toThrow("500");
    });
  });

  describe("moverKanbanTask", () => {
    test("usa POST para mover task para novo step", async () => {
      await moverKanbanTask("8", "1", "42", 7);
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/kanban_boards/1/kanban_tasks/42/move");
      expect((options as RequestInit).method).toBe("POST");
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.board_step_id).toBe(7);
    });

    test("lança erro em resposta não-ok", async () => {
      mockFetch.mockImplementationOnce(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(moverKanbanTask("8", "1", "42", 7)).rejects.toThrow("500");
    });
  });

  describe("removerEtiquetas", () => {
    test("remove etiquetas e mantém as restantes", async () => {
      // buscarConversa returns labels ["tag1", "tag2", "tag3"]
      mockFetch.mockImplementationOnce(async () =>
        new Response(JSON.stringify({ labels: ["tag1", "tag2", "tag3"] }), { status: 200 })
      );
      // definirEtiquetas POST
      await removerEtiquetas("8", "100", ["tag2"]);

      const labelCall = mockFetch.mock.calls.find(c => {
        const [url, opts] = c as [string, RequestInit];
        return (url as string).includes("/conversations/100/labels") && opts?.method === "POST";
      });
      expect(labelCall).toBeDefined();
      const body = JSON.parse((labelCall as [string, RequestInit])[1]!.body as string);
      expect(body.labels).toContain("tag1");
      expect(body.labels).toContain("tag3");
      expect(body.labels).not.toContain("tag2");
    });
  });

  describe("enviarArquivo", () => {
    test("usa POST com FormData para enviar arquivo", async () => {
      const buffer = new Uint8Array([1, 2, 3]);
      await enviarArquivo("8", "100", buffer, "audio.mp3");
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url as string).toContain("/conversations/100/messages");
      expect((options as RequestInit).method).toBe("POST");
      expect((options as RequestInit).body).toBeInstanceOf(FormData);
    });

    test("inclui is_recorded_audio quando isRecordedAudio=true", async () => {
      const buffer = new Uint8Array([1]);
      await enviarArquivo("8", "100", buffer, "audio.mp3", "audio/mpeg", { isRecordedAudio: true });
      const formData = mockFetch.mock.calls[0]![1]!.body as FormData;
      expect(formData.get("is_recorded_audio")).toBe("true");
    });

    test("inclui attachment_metadata quando transcribedText fornecido", async () => {
      const buffer = new Uint8Array([1]);
      await enviarArquivo("8", "100", buffer, "audio.mp3", "audio/mpeg", { transcribedText: "olá" });
      const formData = mockFetch.mock.calls[0]![1]!.body as FormData;
      const meta = JSON.parse(formData.get("attachment_metadata") as string);
      expect(meta.transcribed_text).toBe("olá");
    });

    test("lança erro em resposta não-ok após retries", async () => {
      mockFetch.mockImplementation(async () =>
        new Response("Error", { status: 500 })
      );
      await expect(enviarArquivo("8", "100", new Uint8Array([1]), "f.mp3")).rejects.toThrow("500");
    });
  });
});
