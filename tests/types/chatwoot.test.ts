import { describe, test, expect } from "bun:test";
import type { ChatwootWebhookPayload, ChatwootFollowUpPayload, ContextoWebhook } from "../../src/types/chatwoot.ts";

describe("ChatwootWebhookPayload type", () => {
  test("accepts valid payload", () => {
    const payload: ChatwootWebhookPayload = {
      event: "message_created",
      id: 123,
      content: "Olá",
      content_type: "text",
      content_attributes: {},
      message_type: 0,
      created_at: Date.now() / 1000,
      account: { id: 8 },
      conversation: {
        id: 1,
        inbox_id: 1,
        labels: ["testando-agente"],
      },
      sender: {
        id: 1,
        name: "Paciente",
        phone_number: "+5511999999999",
      },
    };
    expect(payload.message_type).toBe(0);
    expect(payload.content_attributes.in_reply_to).toBeUndefined();
  });

  test("supports in_reply_to", () => {
    const payload: ChatwootWebhookPayload = {
      event: "message_created",
      id: 123,
      content: "Resposta",
      content_type: "text",
      content_attributes: { in_reply_to: 100 },
      message_type: 0,
      created_at: Date.now() / 1000,
      account: { id: 8 },
      conversation: {
        id: 1,
        inbox_id: 1,
        labels: [],
      },
      sender: { id: 1, name: "Test" },
    };
    expect(payload.content_attributes.in_reply_to).toBe(100);
  });
});

describe("ChatwootFollowUpPayload type", () => {
  test("accepts kanban_task_overdue payload", () => {
    const payload: ChatwootFollowUpPayload = {
      event: "kanban_task_overdue",
      account_id: 8,
      board_id: 1,
      task: {
        id: 1,
        title: "Test",
        description: null,
        due_date: null,
        board_step_id: 1,
        board_step: { id: 1, name: "Qualificado" },
        conversations: [{
          id: 1,
          inbox_id: 1,
          display_id: 1,
          contact: { phone_number: "+5511999999999", name: "Test" },
        }],
      },
    };
    expect(payload.event).toBe("kanban_task_overdue");
  });
});
