import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo, enviarMensagem, pausaComDigitando, registrarMidiaEnviada } from "../services/chatwoot.ts";
import { enviarMensagemAntes } from "./mensagem-antes.ts";
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

// Áudio de RECUPERAÇÃO pós-preço (2º toque da cadência pós-preço, dentro da janela de 24h):
// o Walker fala direto com quem viu o preço e sumiu — cria conexão, pergunta a expectativa real
// e abre o Semestral. Gravação real do Walker (roteiro-base no PR/documentação).
// Gravação real do Walker no S3 (endpoint direto s3.stkd.site — HTTP 200, audio/ogg).
// Se ficar VAZIA, a cadência pós-preço NÃO envia áudio e cai no fallback de texto (recuperacao_enxuta).
export const AUDIO_WALKER_POSPRECO_URL: string = "https://s3.stkd.site/arquivosclientes/Vestigium/audio%20-%2004.opus";

// Duração de cada áudio. Antes de mandar, a IA fica "gravando" esse tempo, como uma pessoa que
// grava uma nota de voz de 1 minuto: o áudio chegava 3s depois do texto e denunciava a IA.
// Se trocar o arquivo, remeça (ffprobe) e atualize aqui.
const DURACAO_AUDIO_MS: Record<1 | 2 | 3, number> = { 1: 64_000, 2: 61_000, 3: 51_000 };

// Print de um cronograma real da plataforma (aluno Vitor), enviado logo depois do áudio 2.
export const IMAGEM_CRONOGRAMA_URL = "https://s3.stkd.site/arquivosclientes/Vestigium/cronograma-exemplo.jpg";
const FRASE_CRONOGRAMA = "Olha como fica o cronograma de um aluno meu na plataforma, semana a semana.";

// Nunca derruba o áudio: se a imagem falhar, só registra e segue (o áudio já foi).
async function enviarImagemCronograma(idConta: string, idConversa: string): Promise<boolean> {
  try {
    const res = await fetchComTimeout(IMAGEM_CRONOGRAMA_URL, { method: "GET", timeout: 30_000 });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
      throw new Error(`Download falhou: ${res.status} ${res.headers.get("content-type")}`);
    }
    const dados = new Uint8Array(await res.arrayBuffer());
    await enviarMensagemAntes(idConta, idConversa, FRASE_CRONOGRAMA, "tool:enviar-audio-walker");
    await enviarArquivo(idConta, idConversa, dados, "cronograma-exemplo.jpg", "image/jpeg");
    registrarMidiaEnviada(idConversa, "imagem do cronograma");
    await pausaComDigitando(idConta, idConversa, 5000);
    return true;
  } catch (e) {
    logger.error("tool:enviar-audio-walker", "Erro ao enviar a imagem do cronograma (áudio 2 já foi):", e);
    return false;
  }
}

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
  await enviarMensagemAntes(idConta, idConversa, mensagemAntes, "tool:enviar-audio-walker");

  await pausaComDigitando(idConta, idConversa, DURACAO_AUDIO_MS[numero], "recording");

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
    registrarMidiaEnviada(idConversa, `áudio ${numero} do Walker`);

    // Pausa maior para a nota de voz (PTT) terminar de subir no WhatsApp antes da próxima
    // mensagem — o áudio demora mais que o texto para ser entregue, então sem essa pausa a
    // pergunta seguinte chega antes do áudio.
    await pausaComDigitando(idConta, idConversa, 8000);

    // Junto com o áudio 2 vai o print de um cronograma real da plataforma (pedido do Gusthavo,
    // 01/10/2026): o áudio fala de método e organização, e a imagem mostra como isso fica na prática.
    if (numero === 2) {
      const cronograma = await enviarImagemCronograma(idConta, idConversa);
      if (cronograma) return `Áudio 2 do Walker e imagem do cronograma enviados com sucesso. NÃO descreva a imagem nem repita a frase dela; siga com a sua próxima pergunta.`;
    }

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

// Envia um áudio (nota de voz PTT) a partir de uma URL, para uso FORA do fluxo do agente
// (ex.: a cadência de follow-up pós-preço). Reaproveita download + enviarArquivo com isRecordedAudio.
export async function enviarAudioPorUrl(
  idConta: string | number,
  idConversa: string | number,
  url: string,
  nomeArquivo: string,
): Promise<void> {
  const res = await fetchComTimeout(url, { method: "GET", timeout: 60_000 });
  if (!res.ok) throw new Error(`Download do áudio falhou: ${res.status}`);
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error("URL de áudio retornou HTML — verifique o link.");
  }
  const dados = new Uint8Array(await res.arrayBuffer());
  await enviarArquivo(idConta, idConversa, dados, nomeArquivo, "audio/ogg", { isRecordedAudio: true });
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

