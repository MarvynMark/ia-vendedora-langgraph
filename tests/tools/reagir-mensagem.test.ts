import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockFetch = mock(async () => new Response(JSON.stringify({}), { status: 200 }));

import { criarToolReagirMensagem } from "../../src/tools/reagir-mensagem.ts";

const contexto = {
  idConta: "8",
  idInbox: "3",
  idConversa: "100",
  idMensagem: "999",
};

beforeEach(() => {
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  globalThis.fetch = mockFetch as typeof fetch;
});

describe("criarToolReagirMensagem", () => {
  test("envia reação com payload correto", async () => {
    const tool = criarToolReagirMensagem(contexto);
    const result = await tool.invoke({ emoji: "👍" });
    expect(result).toBe("Reação enviada.");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/conversations/100/messages");
    const body = JSON.parse(opts.body as string);
    expect(body.content).toBe("👍");
    expect(body.is_reaction).toBe(true);
    expect(body.reply_to).toBe("999");
  });

  test("chama endpoint correto", async () => {
    const tool = criarToolReagirMensagem(contexto);
    await tool.invoke({ emoji: "❤️" });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/api/v1/accounts/8");
    expect(url).toContain("/conversations/100/messages");
  });
});
