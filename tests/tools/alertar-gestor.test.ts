import { describe, test, expect, mock, beforeEach } from "bun:test";

// Captura as chamadas de enviarMensagem — o Alertar_gestor deve criar UMA nota privada na conversa
// do lead e UM alerta no grupo, SEM pausar a IA (não mexe em labels/etiquetas).
const calls: Array<{ conta: unknown; conversa: unknown; texto: string; opts?: { private?: boolean } }> = [];
mock.module("../../src/services/chatwoot.ts", () => ({
  enviarMensagem: async (conta: unknown, conversa: unknown, texto: string, opts?: { private?: boolean }) => {
    calls.push({ conta, conversa, texto, opts });
  },
}));

const { criarToolAlertarGestor } = await import("../../src/tools/alertar-gestor.ts");
const { env } = await import("../../src/config/env.ts");

describe("Alertar_gestor", () => {
  beforeEach(() => { calls.length = 0; });

  test("cria nota privada no lead + alerta no grupo (2 mensagens), sem pausar a IA", async () => {
    const tool = criarToolAlertarGestor({
      telefone: "+5511999999999", nome: "Ana", idConta: "8", idConversa: "100",
      ultimaMensagem: "vou pagar dia 10",
    });
    await tool.invoke({ motivo: "ia pagar dia 10, travou na virada do cartão" });

    expect(calls.length).toBe(2);

    // 1ª chamada: nota PRIVADA na conversa do lead (idConversa "100")
    const nota = calls[0]!;
    expect(nota.conversa).toBe("100");
    expect(nota.opts?.private).toBe(true);
    expect(nota.texto).toContain("ia pagar dia 10");

    // 2ª chamada: alerta no grupo interno (CHATWOOT_ALERT_CONVERSATION_ID), sem private
    const alerta = calls[1]!;
    expect(alerta.conversa).toBe(env.CHATWOOT_ALERT_CONVERSATION_ID);
    expect(alerta.opts?.private).toBeUndefined();
    expect(alerta.texto).toContain("Ana");
    expect(alerta.texto).toContain("+5511999999999");
  });
});
