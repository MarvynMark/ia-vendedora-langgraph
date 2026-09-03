import { describe, test, expect, mock, afterEach } from "bun:test";

// Mock ChatOpenAI before importing formatter
const mockInvoke = mock(async (_msgs: unknown[]) => ({ content: "mocked response" }));
const mockChatOpenAI = mock(() => ({ invoke: mockInvoke }));

mock.module("@langchain/openai", () => ({
  ChatOpenAI: mockChatOpenAI,
}));

// Import after mocking
const { formatarSsml, formatarTexto } = await import("../../src/lib/response-formatter.ts");

describe("formatarSsml", () => {
  test("returns model response on success", async () => {
    mockInvoke.mockResolvedValueOnce({ content: "<speak>texto formatado</speak>" });
    const result = await formatarSsml("texto de entrada");
    expect(result).toBe("<speak>texto formatado</speak>");
  });

  test("returns original text on error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("OpenAI error"));
    const result = await formatarSsml("texto original");
    expect(result).toBe("texto original");
  });

  test("calls model with system prompt and user text", async () => {
    mockInvoke.mockResolvedValueOnce({ content: "ssml output" });
    await formatarSsml("minha mensagem");
    const calls = mockInvoke.mock.calls;
    const lastCall = calls[calls.length - 1] as [Array<{ role: string; content: string }>];
    const msgs = lastCall[0];
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe("minha mensagem");
  });
});

describe("formatarTexto", () => {
  // Deixou de ser uma chamada de LLM: nas convs 6941/6943 o modelo RESPONDIA a pergunta do
  // agente em vez de formatá-la, e o lead recebia dez mensagens inventadas. Agora é função pura
  // e síncrona — não chama modelo nenhum. Cobertura completa em response-formatter-deterministico.
  test("não chama modelo nenhum", () => {
    const antes = mockInvoke.mock.calls.length;
    formatarTexto("Me conta como foi tua última semana de estudo, na prática.");
    expect(mockInvoke.mock.calls.length).toBe(antes);
  });

  test("devolve a pergunta intacta, sem responder", () => {
    const p = "Me conta como foi tua última semana de estudo, na prática.";
    expect(formatarTexto(p)).toBe(p);
  });
});
