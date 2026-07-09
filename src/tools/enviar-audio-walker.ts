import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo, enviarMensagem, pausaComDigitando } from "../services/chatwoot.ts";
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
): Promise<string> {
  const chaveDedupe = `${idConversa}:${numero}`;
  if (audiosEnviados.has(chaveDedupe)) {
    return `Áudio ${numero} já enviado nesta conversa.`;
  }
  audiosEnviados.add(chaveDedupe);

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

    // Pausa com "digitando" para o áudio terminar de carregar no WhatsApp antes da próxima
    // mensagem — senão o texto seguinte chega antes da nota de voz.
    await pausaComDigitando(idConta, idConversa, 5000);

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

export function criarToolEnviarAudioWalker1(contexto: ContextoEnviarAudio) {
  return tool(
    async () => enviarAudioWalker(1, contexto.idConta, contexto.idConversa),
    {
      name: "Enviar_audio_walker_1",
      description:
        "Envia o PRIMEIRO áudio do Perito Walker (sobre falta de direcionamento e método) como nota de voz no WhatsApp. Use logo após confirmar a dificuldade do lead na abertura, imediatamente depois de escrever 'Vou te mandar um áudio'. Chame esta tool ANTES de qualquer outro texto. Não precisa de parâmetros.",
      schema: z.object({}),
    },
  );
}

export function criarToolEnviarAudioWalker2(contexto: ContextoEnviarAudio) {
  return tool(
    async () => enviarAudioWalker(2, contexto.idConta, contexto.idConversa),
    {
      name: "Enviar_audio_walker_2",
      description:
        "Envia o SEGUNDO áudio do Perito Walker (como funciona a mentoria por dentro) como nota de voz no WhatsApp. Use depois que o lead responder sobre sentir falta de direcionamento, ANTES de enviar o vídeo da plataforma. Chame esta tool ANTES de qualquer outro texto. Não precisa de parâmetros.",
      schema: z.object({}),
    },
  );
}

export function criarToolEnviarAudioWalker3(contexto: ContextoEnviarAudio) {
  return tool(
    async () => enviarAudioWalker(3, contexto.idConta, contexto.idConversa),
    {
      name: "Enviar_audio_walker_3",
      description:
        "Envia o TERCEIRO áudio do Perito Walker (alinhamento de expectativas: a mentoria não é cursinho) como nota de voz no WhatsApp. Use depois de enviar a imagem de entregáveis, ANTES do texto sobre os 93% de aprovação e o convite de vaga. Chame esta tool ANTES de qualquer outro texto. Não precisa de parâmetros.",
      schema: z.object({}),
    },
  );
}
