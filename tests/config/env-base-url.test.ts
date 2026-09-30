import { describe, test, expect } from "bun:test";
import { semBarraFinal } from "../../src/config/env.ts";

// Regressão: a CHATWOOT_BASE_URL do Coolify veio com barra no fim e os links dos alertas do grupo
// comercial saíam "https://chat.stkd.site//app/accounts/1/conversations/8572" — o WhatsApp não abre.
describe("semBarraFinal (CHATWOOT_BASE_URL)", () => {
  test("remove a barra final e o link da conversa sai limpo", () => {
    const base = semBarraFinal("https://chat.stkd.site/");
    expect(base).toBe("https://chat.stkd.site");
    expect(`${base}/app/accounts/1/conversations/8572`).toBe("https://chat.stkd.site/app/accounts/1/conversations/8572");
  });

  test("não altera URL que já vem sem barra; tolera várias barras", () => {
    expect(semBarraFinal("https://chat.stkd.site")).toBe("https://chat.stkd.site");
    expect(semBarraFinal("https://chat.stkd.site///")).toBe("https://chat.stkd.site");
  });
});
