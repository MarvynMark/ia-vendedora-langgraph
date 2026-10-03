import { describe, expect, test } from "bun:test";
import { selecionarPerdidas, montarPayloadWebhook } from "../../src/lib/webhook-perdido.ts";

const AGORA = 1_791_000_000;
const msg = (id: number, minutosAtras: number, extra: Record<string, unknown> = {}) => ({
  id, message_type: 0, content: `m${id}`, created_at: AGORA - minutosAtras * 60,
  sender: { id: 7, name: "Anna", phone_number: "+5563984184107" }, ...extra,
});

describe("selecionarPerdidas", () => {
  test("pega só mensagem do lead não registrada, entre 5min e 3h atrás", () => {
    const msgs = [
      msg(1, 60),                          // perdida
      msg(2, 60),                          // registrada
      msg(3, 2),                           // recente demais: pode estar chegando
      msg(4, 4 * 60),                      // velha demais
      msg(5, 60, { message_type: 1 }),     // saída nossa
      msg(6, 60, { private: true }),       // nota privada
    ];
    expect(selecionarPerdidas(msgs, new Set(["2"]), AGORA).map((m) => m.id)).toEqual([1]);
  });
});

describe("montarPayloadWebhook", () => {
  test("tem o formato que o /webhook/chatwoot valida e processa", () => {
    const p = montarPayloadWebhook({ id: 9614, labels: ["agente-on"], inbox_id: 11 }, msg(654494, 30), 1);
    expect(p.event).toBe("message_created");
    expect(p.id).toBe(654494);
    expect(p.message_type).toBe("incoming");
    expect(p.account).toEqual({ id: 1 });
    expect(p.sender.phone_number).toBe("+5563984184107");
    expect(p.conversation).toMatchObject({ id: 9614, labels: ["agente-on"], inbox_id: 11, contact_inbox: { contact_id: 7 } });
  });
});
