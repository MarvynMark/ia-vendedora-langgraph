import { describe, test, expect, mock, beforeEach } from "bun:test";

// Captura as chamadas de enviarMensagem — o Alertar_gestor deve criar UMA nota privada na conversa
// do lead e UM alerta no grupo, SEM pausar a IA (não mexe em labels/etiquetas). O alerta no grupo
// só pode sair UMA vez por conversa.
const calls: Array<{ conta: unknown; conversa: unknown; texto: string; opts?: { private?: boolean } }> = [];
let falharEnvioGrupo = false;
// mock.module VAZA entre arquivos no bun: substituir o módulo inteiro faz os outros testes que
// importam chatwoot.ts falharem ao CARREGAR ("Export named X not found"). Preservamos o módulo
// real e trocamos só o que este arquivo precisa observar.
const chatwootReal = await import("../../src/services/chatwoot.ts");
mock.module("../../src/services/chatwoot.ts", () => ({
  ...chatwootReal,
  enviarMensagem: async (conta: unknown, conversa: unknown, texto: string, opts?: { private?: boolean }) => {
    if (falharEnvioGrupo && !opts?.private) throw new Error("falha de rede");
    calls.push({ conta, conversa, texto, opts });
  },
  // avisarGrupo = enviarMensagem + reabrirConversa; aqui só o destino e o texto importam.
  avisarGrupo: async (conversa: unknown, texto: string) => {
    if (falharEnvioGrupo) throw new Error("falha de rede");
    calls.push({ conta: undefined, conversa, texto });
  },
}));

// Trava de dedup em memória, no lugar do Postgres.
const reivindicadas = new Set<string>();
const liberadas: string[] = [];
const alertasReal = await import("../../src/db/alertas.ts");
mock.module("../../src/db/alertas.ts", () => ({
  ...alertasReal,
  reivindicarAlertaGestor: async (idConversa: string) => {
    if (reivindicadas.has(idConversa)) return false;
    reivindicadas.add(idConversa);
    return true;
  },
  liberarAlertaGestor: async (idConversa: string) => {
    reivindicadas.delete(idConversa);
    liberadas.push(idConversa);
  },
}));

const { criarToolAlertarGestor } = await import("../../src/tools/alertar-gestor.ts");
const { env } = await import("../../src/config/env.ts");

const criar = (idConversa: string) =>
  criarToolAlertarGestor({
    telefone: "+5511999999999", nome: "Ana", idConta: "8", idConversa,
    ultimaMensagem: "vou pagar dia 10",
  });

describe("Alertar_gestor", () => {
  beforeEach(() => {
    calls.length = 0;
    liberadas.length = 0;
    reivindicadas.clear();
    falharEnvioGrupo = false;
  });

  test("cria nota privada no lead + alerta no grupo (2 mensagens), sem pausar a IA", async () => {
    await criar("100").invoke({ motivo: "ia pagar dia 10, travou na virada do cartão" });

    expect(calls.length).toBe(2);

    // 1ª chamada: nota PRIVADA na conversa do lead (idConversa "100")
    const nota = calls[0]!;
    expect(nota.conversa).toBe("100");
    expect(nota.opts?.private).toBe(true);
    expect(nota.texto).toContain("ia pagar dia 10");

    // 2ª chamada: alerta no grupo interno (CHATWOOT_ALERT_CONVERSATION_ID), sem private
    const alerta = calls[1]!;
    expect(alerta.conversa).toBe(env.CHATWOOT_COMERCIAL_CONVERSATION_ID);
    expect(alerta.opts?.private).toBeUndefined();
    expect(alerta.texto).toContain("Ana");
    expect(alerta.texto).toContain("+5511999999999");
    // link direto da conversa, pra equipe agir a partir do único alerta que vai receber
    expect(alerta.texto).toContain(`/app/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations/100`);
  });

  test("segunda chamada na mesma conversa não repete o alerta no grupo", async () => {
    const tool = criar("100");
    await tool.invoke({ motivo: "ia pagar dia 10" });
    calls.length = 0;

    const retorno = await tool.invoke({ motivo: "ia pagar dia 10, confirmou de novo" });

    // só a nota privada; nada no grupo
    expect(calls.length).toBe(1);
    expect(calls[0]!.conversa).toBe("100");
    expect(calls[0]!.opts?.private).toBe(true);
    // o modelo não pode achar que falhou e tentar de novo no turno seguinte
    expect(JSON.parse(retorno as string).resultado).toBe("ok");
  });

  test("outra conversa continua recebendo seu próprio alerta", async () => {
    await criar("100").invoke({ motivo: "ia pagar dia 10" });
    calls.length = 0;

    await criar("200").invoke({ motivo: "mandou o comprovante" });

    expect(calls.length).toBe(2);
    expect(calls[1]!.conversa).toBe(env.CHATWOOT_COMERCIAL_CONVERSATION_ID);
  });

  test("falha no envio ao grupo libera a trava pra não queimar a única chance", async () => {
    falharEnvioGrupo = true;
    await criar("100").invoke({ motivo: "ia pagar dia 10" });
    expect(liberadas).toEqual(["100"]);

    // com a trava liberada, a próxima tentativa envia normalmente
    falharEnvioGrupo = false;
    calls.length = 0;
    await criar("100").invoke({ motivo: "ia pagar dia 10" });
    expect(calls.length).toBe(2);
  });
});
