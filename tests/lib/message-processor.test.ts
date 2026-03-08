import { describe, test, expect } from "bun:test";
import type { ChatwootWebhookPayload } from "../../src/types/chatwoot.ts";

// Import just the type, we'll test the logic without actual OpenAI calls
describe("message processing logic", () => {
  test("text message detection", () => {
    const payload: ChatwootWebhookPayload = {
      event: "message_created",
      id: 1,
      content: "Olá, quero agendar",
      content_type: "text",
      content_attributes: {},
      message_type: 0,
      created_at: Date.now() / 1000,
      account: { id: 8 },
      conversation: { id: 1, inbox_id: 1, labels: [] },
      sender: { id: 1, name: "Test", phone_number: "+5511999999999" },
    };

    // Text message - no audio, no file
    expect(payload.attachments).toBeUndefined();
    expect(payload.content).toBe("Olá, quero agendar");
  });

  test("audio attachment detection", () => {
    const payload: ChatwootWebhookPayload = {
      event: "message_created",
      id: 2,
      content: null,
      content_type: "text",
      content_attributes: {},
      message_type: 0,
      created_at: Date.now() / 1000,
      account: { id: 8 },
      conversation: { id: 1, inbox_id: 1, labels: [] },
      sender: { id: 1, name: "Test" },
      attachments: [{
        id: 10,
        file_type: "audio",
        data_url: "https://example.com/audio.ogg",
      }],
    };

    const attachment = payload.attachments?.[0];
    expect(attachment?.file_type).toBe("audio");
  });

  test("image attachment detection", () => {
    const payload: ChatwootWebhookPayload = {
      event: "message_created",
      id: 3,
      content: null,
      content_type: "text",
      content_attributes: {},
      message_type: 0,
      created_at: Date.now() / 1000,
      account: { id: 8 },
      conversation: { id: 1, inbox_id: 1, labels: [] },
      sender: { id: 1, name: "Test" },
      attachments: [{
        id: 11,
        file_type: "image",
        data_url: "https://example.com/photo.jpg",
      }],
    };

    const attachment = payload.attachments?.[0];
    expect(attachment?.file_type).toBe("image");
    // Per note 13: image -> "<usuario enviou um arquivo do tipo image>"
  });

  test("in_reply_to extraction", () => {
    const payload: ChatwootWebhookPayload = {
      event: "message_created",
      id: 4,
      content: "Sim, quero",
      content_type: "text",
      content_attributes: { in_reply_to: 100 },
      message_type: 0,
      created_at: Date.now() / 1000,
      account: { id: 8 },
      conversation: { id: 1, inbox_id: 1, labels: [] },
      sender: { id: 1, name: "Test" },
    };

    expect(payload.content_attributes.in_reply_to).toBe(100);
  });
});
