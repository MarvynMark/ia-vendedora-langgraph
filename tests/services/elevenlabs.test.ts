import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockFetch = mock(async () => new Response(new ArrayBuffer(8), { status: 200 }));

import { gerarAudioTts } from "../../src/services/elevenlabs.ts";

beforeEach(() => {
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => new Response(new ArrayBuffer(8), { status: 200 }));
  globalThis.fetch = mockFetch as typeof fetch;
});

describe("gerarAudioTts", () => {
  test("faz requisição com URL, headers e body corretos", async () => {
    await gerarAudioTts("Olá, tudo bem?");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.elevenlabs.io/v1/text-to-speech");
    expect(url).toContain("mp3_44100_32");
    const headers = opts.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBeDefined();
    const body = JSON.parse(opts.body as string);
    expect(body.model_id).toBe("eleven_flash_v2_5");
    expect(body.voice_settings).toBeDefined();
    expect(body.voice_settings.stability).toBe(0.35);
  });

  test("retorna Uint8Array em caso de sucesso", async () => {
    const result = await gerarAudioTts("Teste");
    expect(result).toBeInstanceOf(Uint8Array);
  });

  test("lança erro em resposta não-ok", async () => {
    // Use a hard throw so retry gives up immediately (no network round-trip)
    // Still retries 3 times with delays, but each attempt is near-instant
    mockFetch.mockImplementation(async () => {
      throw new Error("[elevenlabs] TTS falhou (401): Unauthorized");
    });
    await expect(gerarAudioTts("Teste")).rejects.toThrow("TTS falhou");
    mockFetch.mockImplementation(async () => new Response(new ArrayBuffer(8), { status: 200 }));
  }, 10000);
});
