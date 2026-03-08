import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockTranscreverAudio = mock(async (_url: string) => "Olá, bom dia");
const mockEnviarMensagem = mock(async () => ({}));

mock.module("../../src/services/openai.ts", () => ({
  transcreverAudio: mockTranscreverAudio,
}));

mock.module("../../src/services/chatwoot.ts", () => ({
  enviarMensagem: mockEnviarMensagem,
}));

import { processarMensagem } from "../../src/lib/message-processor.ts";
import type { ChatwootWebhookPayload } from "../../src/types/chatwoot.ts";

function makePayload(overrides: Partial<ChatwootWebhookPayload> = {}): ChatwootWebhookPayload {
  return {
    event: "message_created",
    id: 1,
    content: "Olá",
    content_type: "text",
    content_attributes: {},
    message_type: 0,
    created_at: Date.now() / 1000,
    account: { id: 8 },
    conversation: { id: 100, inbox_id: 1, labels: [] },
    sender: { id: 1, name: "Test", phone_number: "+5511999999999" },
    ...overrides,
  };
}

describe("processarMensagem", () => {
  beforeEach(() => {
    mockTranscreverAudio.mockClear();
    mockTranscreverAudio.mockImplementation(async () => "Olá, bom dia");
  });

  test("texto simples - sem transformação", async () => {
    const payload = makePayload({ content: "Olá, quero agendar" });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("Olá, quero agendar");
    expect(result.mensagemDeAudio).toBe(false);
  });

  test("áudio - envolve em tags XML", async () => {
    mockTranscreverAudio.mockResolvedValueOnce("Quero marcar uma consulta");
    const payload = makePayload({
      content: null,
      attachments: [{ id: 1, file_type: "audio", data_url: "https://example.com/audio.ogg" }],
    });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("<mensagem-de-audio>Quero marcar uma consulta</mensagem-de-audio>");
    expect(result.mensagemDeAudio).toBe(true);
  });

  test("áudio - transcrição vazia → nao audivel", async () => {
    mockTranscreverAudio.mockResolvedValueOnce("");
    const payload = makePayload({
      content: null,
      attachments: [{ id: 1, file_type: "audio", data_url: "https://example.com/audio.ogg" }],
    });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("<mensagem de audio nao audivel>");
    expect(result.mensagemDeAudio).toBe(true);
  });

  test("áudio - Amara.org → nao audivel", async () => {
    mockTranscreverAudio.mockResolvedValueOnce("Subtitles by Amara.org community");
    const payload = makePayload({
      content: null,
      attachments: [{ id: 1, file_type: "audio", data_url: "https://example.com/audio.ogg" }],
    });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("<mensagem de audio nao audivel>");
    expect(result.mensagemDeAudio).toBe(true);
  });

  test("imagem com texto - preserva texto e adiciona notificação", async () => {
    const payload = makePayload({
      content: "Segue a foto",
      attachments: [{ id: 2, file_type: "image", data_url: "https://example.com/photo.jpg" }],
    });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("Segue a foto\n<usuario enviou uma imagem. peca que envie a informacao por audio ou texto>");
  });

  test("imagem sem texto - só notificação", async () => {
    const payload = makePayload({
      content: null,
      attachments: [{ id: 2, file_type: "image", data_url: "https://example.com/photo.jpg" }],
    });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("<usuario enviou uma imagem. peca que envie a informacao por audio ou texto>");
  });

  test("content null sem anexos - fallback mensagem não suportada", async () => {
    const payload = makePayload({ content: null });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("<mensagem nao suportada. solicitar que usuario envie informacao por texto>");
  });

  test("arquivo pdf com texto - preserva texto", async () => {
    const payload = makePayload({
      content: "Aqui está o exame",
      attachments: [{ id: 3, file_type: "document", data_url: "https://example.com/exam.pdf" }],
    });
    const result = await processarMensagem(payload);
    expect(result.mensagemProcessada).toBe("Aqui está o exame\n<usuario enviou um arquivo do tipo document>");
  });

  test("idContato usa contact_inbox.contact_id se disponível", async () => {
    const payload: ChatwootWebhookPayload = {
      ...makePayload(),
      conversation: {
        id: 100,
        inbox_id: 1,
        labels: [],
        contact_inbox: { source_id: "phone:+5511999999999", contact_id: 999 },
      },
      sender: { id: 1, name: "Test" },
    };
    const result = await processarMensagem(payload);
    expect(result.idContato).toBe("999");
  });

  test("idContato usa sender.id como fallback", async () => {
    const payload = makePayload({
      sender: { id: 42, name: "Test", phone_number: "+5511999999999" },
    });
    const result = await processarMensagem(payload);
    expect(result.idContato).toBe("42");
  });

  test("extrai campos básicos corretamente", async () => {
    const payload = makePayload({ content: "Olá" });
    const result = await processarMensagem(payload);
    expect(result.idMensagem).toBe("1");
    expect(result.idConta).toBe("8");
    expect(result.idConversa).toBe("100");
    expect(result.nome).toBe("Test");
    expect(result.telefone).toBe("+5511999999999");
  });
});
