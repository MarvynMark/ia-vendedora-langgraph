import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo, enviarMensagem, pausaComDigitando, calcularDelayDigitando, registrarTextoMidia } from "../services/chatwoot.ts";
import { dividirEmFrases } from "../lib/response-formatter.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { logger } from "../lib/logger.ts";

// Áudios pré-gravados do Perito Walker (formato ogg/opus) enviados como nota de voz
// em pontos específicos da qualificação. Hospedados no S3 (bucket arquivosclientes, prefixo Vestigium/).
export const AUDIO_WALKER_01_URL =
  "https://s3.stkd.site/arquivosclientes/Vestigium/audio%20-%2001.ogg";
export const AUDIO_WALKER_02_URL =
  "https://s3.stkd.site/arquivosclientes/Vestigium/audio%20-%2002.ogg";
export const AUDIO_WALKER_03_URL =
  "https://s3.stkd.site/arquivosclientes/Vestigium/audio%20-%2003.ogg";

const URLS_AUDIO: Record<1 | 2 | 3, string> = {
  1: AUDIO_WALKER_01_URL,
  2: AUDIO_WALKER_02_URL,
  3: AUDIO_WALKER_03_URL,
};

// Dedupe por (conversa, número do áudio): um Set único cobre os 3 áudios sem um bloquear o outro.
const audiosEnviados = new Set<string>();

interface ContextoEnviarAudio {
  idConta: string;
  idConversa: string;
}

// Envia um áudio do Walker para a conversa (com dedupe por áudio e fallback em link).
// Exportado para ser reutilizado tanto pela tool do LLM quanto pela guarda determinística
// do grafo principal (garante o envio mesmo quando o LLM narra o envio sem chamar a tool).
export async function enviarAudioWalker(
  numero: 1 | 2 | 3,
  idConta: string,
  idConversa: string,
  mensagemAntes?: string,
): Promise<string> {
  const chaveDedupe = `${idConversa}:${numero}`;
  if (audiosEnviados.has(chaveDedupe)) {
    return `Áudio ${numero} já enviado nesta conversa.`;
  }
  audiosEnviados.add(chaveDedupe);

  // Envia o texto de contexto ANTES do áudio. Garante a ordem texto -> áudio (que a
  // arquitetura sozinha não garante, pois a tool roda antes do texto de resposta) e deixa
  // a apresentação do áudio personalizada, para não parecer um áudio gravado solto.
  if (mensagemAntes && mensagemAntes.trim()) {
    try {
      // Cada frase vira uma mensagem separada, com "digitando" proporcional antes de cada
      for (const frase of dividirEmFrases(mensagemAntes)) {
        await pausaComDigitando(idConta, idConversa, calcularDelayDigitando(frase));
        await enviarMensagem(idConta, idConversa, frase);
      }
      // Registra o texto para que o envio do output filtre qualquer repetição feita pelo LLM
      registrarTextoMidia(idConversa, mensagemAntes);
      await pausaComDigitando(idConta, idConversa, 3000);
    } catch (e) {
      logger.warn("tool:enviar-audio-walker", "Erro ao enviar mensagem antes do áudio:", e);
    }
  }

  const url = URLS_AUDIO[numero];
  try {
    logger.info("tool:enviar-audio-walker", `Baixando áudio ${numero} de:`, url);
    const res = await fetchComTimeout(url, { method: "GET", timeout: 60_000 });
    if (!res.ok) throw new Error(`Download falhou: ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error("URL retornou HTML — verifique se o link do MinIO está acessível.");
    }

    const buffer = await res.arrayBuffer();
    const dados = new Uint8Array(buffer);

    logger.info("tool:enviar-audio-walker", `Enviando áudio ${numero} (${dados.length} bytes)...`);
    // isRecordedAudio: true faz o WhatsApp tratar como nota de voz (PTT), não como anexo de arquivo.
    await enviarArquivo(idConta, idConversa, dados, `walker-audio-0${numero}.ogg`, "audio/ogg", {
      isRecordedAudio: true,
    });

    // Pausa maior para a nota de voz (PTT) terminar de subir no WhatsApp antes da próxima
    // mensagem — o áudio demora mais que o texto para ser entregue, então sem essa pausa a
    // pergunta seguinte chega antes do áudio.
    await pausaComDigitando(idConta, idConversa, 8000);

    return `Áudio ${numero} do Walker enviado com sucesso.`;
  } catch (e) {
    logger.error("tool:enviar-audio-walker", `Erro ao enviar áudio ${numero}:`, e);
    try {
      const fallback = `O áudio ficou pesado pra chegar por aqui. Dá uma escutada direto nesse link: ${url}`;
      await enviarMensagem(idConta, idConversa, fallback);
      logger.info("tool:enviar-audio-walker", `Link fallback do áudio ${numero} enviado.`);
    } catch (fallbackErr) {
      logger.error("tool:enviar-audio-walker", `Erro ao enviar fallback do áudio ${numero}:`, fallbackErr);
    }
    return `Não consegui enviar o áudio ${numero}, mas enviei o link alternativo diretamente para o lead. Continue a conversa normalmente.`;
  }
}

const SCHEMA_AUDIO = z.object({
  mensagem_antes: z
    .string()
    .optional()
    .describe(
      "Texto curto que apresenta o áudio, enviado como mensagem ANTES dele. Sempre preencha.",
    ),
});

export function criarToolEnviarAudioWalker1(contexto: ContextoEnviarAudio) {
  return tool(
    async ({ mensagem_antes }: { mensagem_antes?: string }) =>
      enviarAudioWalker(1, contexto.idConta, contexto.idConversa, mensagem_antes),
    {
      name: "Enviar_audio_walker_1",
      description:
        "Envia o 1º áudio do Perito Walker (falta de direcionamento e método) como nota de voz, na qualificação inicial. 'mensagem_antes' = frase que apresenta o áudio, enviada antes dele.",
      schema: SCHEMA_AUDIO,
    },
  );
}

export function criarToolEnviarAudioWalker2(contexto: ContextoEnviarAudio) {
  return tool(
    async ({ mensagem_antes }: { mensagem_antes?: string }) =>
      enviarAudioWalker(2, contexto.idConta, contexto.idConversa, mensagem_antes),
    {
      name: "Enviar_audio_walker_2",
      description:
        "Envia o 2º áudio do Perito Walker (como a mentoria funciona por dentro) como nota de voz, ao apresentar a mentoria. 'mensagem_antes' = frase que apresenta o áudio, enviada antes dele.",
      schema: SCHEMA_AUDIO,
    },
  );
}

