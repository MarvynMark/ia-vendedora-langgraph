// Toques de curiosidade dentro da janela de 24h (decisão do Gusthavo, 03/10/2026).
//
// Depois da pergunta da IA (toque 1), quem não respondeu recebe dois "quebra-padrão":
//   - áudio MUDO (14s de silêncio) seguido de "O que você acha?" — a pessoa abre, não ouve nada
//     e responde perguntando o que era
//   - PDF "COMPROVANTE-PIX" de brincadeira, com a foto do Walker pedindo pra responder no WhatsApp
//
// Os dois só existem com a janela aberta (são mídia livre, sem template); fora dela a posição é
// pulada. No histórico fica registrado o que foi de verdade, pra o agente principal assumir a
// brincadeira quando o lead perguntar ("o áudio não tem nada", "que PIX é esse?").

import { enviarArquivo, enviarMensagem, pausaComDigitando } from "../services/chatwoot.ts";
import { salvarMensagem } from "../db/memoria.ts";
import { fetchComTimeout } from "./fetch-with-timeout.ts";
import { logger } from "./logger.ts";

const BASE = "https://s3.stkd.site/arquivosclientes/Vestigium/followup";
export const URL_AUDIO_MUDO = `${BASE}/audio-mudo.ogg`;
export const URL_COMPROVANTE_PIX = `${BASE}/COMPROVANTE-PIX.pdf`;

/** Marcadores das posições da sequência que são mídia de curiosidade. */
export const TOQUE_AUDIO_MUDO = "__toque_audio_mudo__";
export const TOQUE_PIX = "__toque_pix__";

export const PERGUNTA_POS_AUDIO = "O que você acha?";

export const REGISTRO_AUDIO_MUDO =
  "[enviado ao lead: áudio de voz MUDO, sem nada gravado, mandado de propósito só pra despertar a curiosidade]";
export const REGISTRO_PIX =
  "[enviado ao lead: PDF \"COMPROVANTE-PIX\" de brincadeira, com a foto do Walker pedindo pra responder no WhatsApp; não houve PIX nenhum]";

export function ehToqueCuriosidade(nome: string | undefined): boolean {
  return nome === TOQUE_AUDIO_MUDO || nome === TOQUE_PIX;
}

async function registrar(telefone: string | undefined, content: string) {
  if (!telefone) return;
  await salvarMensagem(telefone, { type: "ai", content, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
}

async function baixar(url: string): Promise<Uint8Array> {
  const res = await fetchComTimeout(url, { method: "GET", timeout: 60_000 });
  if (!res.ok) throw new Error(`Download falhou (${res.status}): ${url}`);
  if ((res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`URL retornou HTML: ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Envia o toque de curiosidade da posição `nome` e registra no histórico. Lança se a mídia falhar. */
export async function enviarToqueCuriosidade(
  nome: string,
  accountId: string | number,
  conversationId: string | number,
  telefone?: string,
): Promise<void> {
  if (nome === TOQUE_AUDIO_MUDO) {
    // "Gravando" antes, como quem grava um áudio de verdade.
    await pausaComDigitando(accountId, conversationId, 6000, "recording");
    // isRecordedAudio: chega como nota de voz (PTT), não como arquivo anexo.
    await enviarArquivo(accountId, conversationId, await baixar(URL_AUDIO_MUDO), "audio.ogg", "audio/ogg", { isRecordedAudio: true });
    await registrar(telefone, REGISTRO_AUDIO_MUDO);
    // A nota de voz demora mais pra chegar que o texto; sem a pausa a pergunta chega antes dela.
    await pausaComDigitando(accountId, conversationId, 8000);
    await enviarMensagem(accountId, conversationId, PERGUNTA_POS_AUDIO);
    await registrar(telefone, PERGUNTA_POS_AUDIO);
    logger.info("follow-up", "Toque de curiosidade: áudio mudo + pergunta enviados");
    return;
  }
  if (nome === TOQUE_PIX) {
    const dados = await baixar(URL_COMPROVANTE_PIX);
    await enviarArquivo(accountId, conversationId, dados, "COMPROVANTE-PIX.pdf", "application/pdf");
    await registrar(telefone, REGISTRO_PIX);
    logger.info("follow-up", "Toque de curiosidade: comprovante PIX enviado");
    return;
  }
  throw new Error(`Toque de curiosidade desconhecido: ${nome}`);
}
