import { describe, test, expect } from "bun:test";
import { motivoNaoRegistrarSaida } from "../../src/lib/saida-externa.ts";

const APP = 3; // usuário do Chatwoot com que o app envia (VESTIGIUM)

describe("motivoNaoRegistrarSaida", () => {
  test("mensagem de atendente humano É registrada", () => {
    // Pedro respondeu o lead na mão: sem isto a IA retoma de onde parou e ignora.
    expect(motivoNaoRegistrarSaida(1, 5, false, "Oi, aqui é o Pedro", APP)).toBeNull();
    expect(motivoNaoRegistrarSaida("outgoing", 5, undefined, "Bom dia!", APP)).toBeNull();
  });

  test("mensagem do painel de disparo É registrada", () => {
    // O painel envia autenticado como quem logou nele, não como o app.
    expect(motivoNaoRegistrarSaida(1, 1, false, "Oi Maria, lembrei de você", APP)).toBeNull();
  });

  test("fala do próprio agente NÃO é registrada de novo", () => {
    // O grafo já grava via salvarMensagem. Registrar aqui duplicaria toda fala da IA.
    expect(motivoNaoRegistrarSaida(1, APP, false, "Me conta, como tá os estudos?", APP))
      .toBe("e_do_agente");
  });

  test("mensagem recebida do lead não passa por aqui", () => {
    expect(motivoNaoRegistrarSaida(0, 99, false, "oi", APP)).toBe("nao_e_saida");
    expect(motivoNaoRegistrarSaida("incoming", 99, false, "oi", APP)).toBe("nao_e_saida");
  });

  test("nota privada não entra: o lead nunca viu", () => {
    expect(motivoNaoRegistrarSaida(1, 5, true, "lead pediu desconto, avaliar", APP))
      .toBe("nota_privada");
  });

  test("sem texto não entra", () => {
    expect(motivoNaoRegistrarSaida(1, 5, false, null, APP)).toBe("sem_texto");
    expect(motivoNaoRegistrarSaida(1, 5, false, "   ", APP)).toBe("sem_texto");
  });
});
