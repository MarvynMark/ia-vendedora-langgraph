import { describe, test, expect } from "bun:test";
import { normalizarPedidoDeLink, PERGUNTA_LINK } from "../../src/lib/pedido-link.ts";

describe("normalizarPedidoDeLink (conv 9360)", () => {
  test("anúncio de link + 'Pode ser?' vira a pergunta canônica", () => {
    const r = normalizarPedidoDeLink(["Ótimo, Dorineide!", "Vou gerar o link pra você, pra gente já finalizar agora.", "Pode ser?"]);
    expect(r).toEqual(["Ótimo, Dorineide!", PERGUNTA_LINK]);
  });

  test("mantém o eco que vem antes da pergunta", () => {
    const r = normalizarPedidoDeLink(["Com o edital no fim do ano, o Semestral é o caminho.", "Vou te mandar o link agora."]);
    expect(r).toEqual(["Com o edital no fim do ano, o Semestral é o caminho.", PERGUNTA_LINK]);
  });

  test("turno que já tem o link não muda", () => {
    const f = ["Aqui está o teu link: https://peritowalker.com.br/mentoriaperito.", "Ele expira em alguns minutos."];
    expect(normalizarPedidoDeLink(f)).toEqual(f);
  });

  test("a pergunta canônica, já certa, passa intacta", () => {
    const f = ["Com o edital no fim do ano, o Semestral é o caminho.", PERGUNTA_LINK];
    expect(normalizarPedidoDeLink(f)).toEqual(f);
  });

  test("resposta longa de conteúdo sobre o link (simular parcelas) não é anúncio", () => {
    const f = ["Vou te passar o link de pagamento e nele você consegue simular exatamente quantas parcelas quiser e ver o valor de cada uma delas."];
    expect(normalizarPedidoDeLink(f)).toEqual(f);
  });
});
