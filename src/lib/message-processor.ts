import { transcreverAudio } from "../services/openai.ts";
import { enviarMensagem } from "../services/chatwoot.ts";
import type { ChatwootWebhookPayload } from "../types/chatwoot.ts";
import { logger } from "./logger.ts";

export interface MensagemProcessada {
  idMensagem: string;
  idMensagemReferenciada: string | null;
  idConta: string;
  idConversa: string;
  idContato: string;
  idInbox: string;
  telefone: string;
  nome: string;
  mensagem: string;
  mensagemProcessada: string;
  mensagemDeAudio: boolean;
  timestamp: string;
  tipoArquivo: string | null;
  idAnexo: string | null;
  urlArquivo: string | null;
  etiquetas: string[];
  atributosContato: Record<string, unknown>;
  atributosConversa: string;
}

export async function processarMensagem(payload: ChatwootWebhookPayload): Promise<MensagemProcessada> {
  const mensagem = payload.content ?? "";
  const attachment = payload.attachments?.[0];
  const tipoArquivo = attachment?.file_type ?? null;
  const urlArquivo = attachment?.data_url ?? null;
  const idAnexo = attachment?.id?.toString() ?? null;

  let mensagemProcessada = mensagem;
  let mensagemDeAudio = false;

  if (tipoArquivo === "audio" && urlArquivo) {
    try {
      logger.info("message-processor", "Transcrevendo áudio...");
      const transcricao = await transcreverAudio(urlArquivo);
      if (!transcricao || transcricao.trim() === "") {
        mensagemProcessada = "<mensagem de audio nao audivel>";
      } else if (transcricao.includes("Amara.org")) {
        mensagemProcessada = "<mensagem de audio nao audivel>";
      } else {
        mensagemProcessada = `<mensagem-de-audio>${transcricao}</mensagem-de-audio>`;
      }
      mensagemDeAudio = true;

      // Salvar transcrição como nota privada no Chatwoot
      try {
        await enviarMensagem(
          payload.account.id.toString(),
          payload.conversation.id.toString(),
          `Transcrição do áudio: ${mensagemProcessada}`,
          { private: true },
        );
      } catch (e) {
        logger.warn("message-processor", "Erro ao salvar transcrição:", e);
      }
    } catch (e) {
      logger.error("message-processor", "Erro na transcrição:", e);
      mensagemProcessada = "<erro na transcrição do áudio>";
    }
  } else if (tipoArquivo === "image") {
    mensagemProcessada = `${mensagemProcessada}\n<usuario enviou uma imagem. peca que envie a informacao por audio ou texto>`.trim();
  } else if (tipoArquivo && tipoArquivo !== "audio") {
    mensagemProcessada = `${mensagemProcessada}\n<usuario enviou um arquivo do tipo ${tipoArquivo}>`.trim();
  }

  if (!mensagemProcessada || mensagemProcessada.trim() === "") {
    mensagemProcessada = "<mensagem nao suportada. solicitar que usuario envie informacao por texto>";
  }

  const telefone = payload.sender.phone_number ??
    payload.sender.additional_attributes?.social_profiles?.instagram ??
    payload.conversation.contact_inbox?.source_id ?? "";

  logger.info("message-processor", "Dados extraídos", {
    telefone,
    nome: payload.sender.name,
    idConversa: payload.conversation.id,
    idInbox: payload.conversation.inbox_id,
    tipoArquivo,
    mensagemDeAudio,
    contentLength: mensagemProcessada.length,
  });

  const idMensagemReferenciada = payload.content_attributes?.in_reply_to?.toString() ?? null;

  return {
    idMensagem: payload.id.toString(),
    idMensagemReferenciada,
    idConta: payload.account.id.toString(),
    idConversa: payload.conversation.id.toString(),
    idContato: (payload.conversation.contact_inbox?.contact_id ?? payload.sender.id).toString(),
    idInbox: payload.conversation.inbox_id.toString(),
    telefone,
    nome: payload.sender.name,
    mensagem,
    mensagemProcessada,
    mensagemDeAudio,
    timestamp: typeof payload.created_at === "number"
      ? new Date(payload.created_at * 1000).toISOString()
      : new Date(payload.created_at).toISOString(),
    tipoArquivo,
    idAnexo,
    urlArquivo,
    etiquetas: payload.conversation.labels,
    atributosContato: payload.sender.custom_attributes ?? {},
    atributosConversa: JSON.stringify(payload.conversation.custom_attributes ?? {}),
  };
}
