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
  test("returns model response on success", async () => {
    mockInvoke.mockResolvedValueOnce({ content: "texto formatado sem emojis" });
    const result = await formatarTexto("texto com 🎉 emoji");
    expect(result).toBe("texto formatado sem emojis");
  });

  test("returns original text on error", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Network error"));
    const result = await formatarTexto("fallback text");
    expect(result).toBe("fallback text");
  });

  test("calls model with system prompt and user text", async () => {
    mockInvoke.mockResolvedValueOnce({ content: "clean text" });
    await formatarTexto("raw input");
    const calls = mockInvoke.mock.calls;
    const lastCall = calls[calls.length - 1] as [Array<{ role: string; content: string }>];
    const msgs = lastCall[0];
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe("raw input");
  });
});
