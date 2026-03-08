import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { comRetry } from "../lib/retry.ts";

export async function transcreverAudio(urlAudio: string): Promise<string> {
  return comRetry(async () => {
    // Baixar o áudio
    const audioRes = await fetchComTimeout(urlAudio, { timeout: 60000 });
    if (!audioRes.ok) {
      throw new Error(`[openai] Falha ao baixar áudio: ${audioRes.status}`);
    }
    const audioBuffer = await audioRes.arrayBuffer();

    // Enviar para Whisper
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "audio.ogg");
    form.append("model", "whisper-1");
    form.append("language", "pt");

    const res = await fetchComTimeout("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: form,
      timeout: 60000,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[openai] Whisper falhou (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { text: string };
    return data.text;
  });
}
