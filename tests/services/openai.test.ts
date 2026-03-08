import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock fetch before importing service
const mockFetch = mock(async () =>
  new Response(JSON.stringify({ text: "transcrição" }), { status: 200 })
);
globalThis.fetch = mockFetch as typeof fetch;

import { transcreverAudio } from "../../src/services/openai.ts";

describe("transcreverAudio", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    // Default: audio download succeeds, whisper succeeds
    mockFetch.mockImplementation(async () =>
      new Response(new ArrayBuffer(8), { status: 200 })
    );
  });

  test("retorna transcrição do Whisper", async () => {
    // First call: download audio
    mockFetch.mockImplementationOnce(async () =>
      new Response(new ArrayBuffer(8), { status: 200 })
    );
    // Second call: Whisper API
    mockFetch.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ text: "olá mundo" }), { status: 200 })
    );
    const result = await transcreverAudio("http://example.com/audio.ogg");
    expect(result).toBe("olá mundo");
  });

  test("lança erro quando download de áudio falha", async () => {
    mockFetch.mockImplementation(async () =>
      new Response("Not Found", { status: 404 })
    );
    await expect(transcreverAudio("http://example.com/audio.ogg")).rejects.toThrow("404");
  });

  test("lança erro quando Whisper API falha após retries", async () => {
    // First call: audio download succeeds
    mockFetch.mockImplementationOnce(async () =>
      new Response(new ArrayBuffer(8), { status: 200 })
    );
    // Subsequent calls (retries): Whisper fails
    mockFetch.mockImplementation(async () =>
      new Response("Internal Server Error", { status: 500 })
    );
    await expect(transcreverAudio("http://example.com/audio.ogg")).rejects.toThrow("500");
  });

  test("envia FormData com model=whisper-1 e language=pt", async () => {
    mockFetch.mockImplementationOnce(async () =>
      new Response(new ArrayBuffer(8), { status: 200 })
    );
    mockFetch.mockImplementationOnce(async (_url: string, opts: RequestInit) => {
      const form = opts.body as FormData;
      expect(form.get("model")).toBe("whisper-1");
      expect(form.get("language")).toBe("pt");
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    });
    await transcreverAudio("http://example.com/audio.ogg");
  });

  test("chama a URL correta do Whisper", async () => {
    mockFetch.mockImplementationOnce(async () =>
      new Response(new ArrayBuffer(8), { status: 200 })
    );
    mockFetch.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ text: "ok" }), { status: 200 })
    );
    await transcreverAudio("http://example.com/audio.ogg");
    const whisperCall = mockFetch.mock.calls[1];
    expect((whisperCall?.[0] as string)).toContain("audio/transcriptions");
  });
});
