import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { comRetry } from "../lib/retry.ts";

export async function gerarAudioTts(texto: string): Promise<Uint8Array> {
  return comRetry(async () => {
    const res = await fetchComTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_32`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: texto,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.44,
            speed: 1.1,
          },
        }),
        timeout: 60000,
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[elevenlabs] TTS falhou (${res.status}): ${text}`);
    }

    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  });
}
