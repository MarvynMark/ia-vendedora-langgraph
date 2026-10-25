import { describe, test, expect } from "bun:test";
import { avaliarAlertaQuente } from "../../src/lib/alerta-quente.ts";

const PRECO = "Pro seu momento, o plano que eu indico é o Anual Completo. Fica em 12x de R$ 394 no cartão.";
const LINK = "Aqui está o teu link do Anual: https://peritowalker.com.br/mentoriaperitoanual";

describe("avaliarAlertaQuente", () => {
  test("preço só no turno atual: bloqueia (padrão 'tô pronta pra começar', conv 10966)", () => {
    expect(
      avaliarAlertaQuente({
        falasIaAnteriores: ["Você tá pronta pra começar agora ou ainda tá se organizando?"],
        ultimaMensagem: "Ainda não",
        motivo: "Janaina está pronta para começar e não tem material. Vai pagar agora.",
      }),
    ).toEqual({ enviar: false, razao: "sem_preco_antes" });
  });

  test("motivo de decisão com data: bloqueia mesmo depois do preço (conv 10605)", () => {
    expect(
      avaliarAlertaQuente({
        falasIaAnteriores: [PRECO],
        ultimaMensagem: "Posso te responder na segunda",
        motivo: "vai decidir na próxima semana, travou no valor do Anual",
      }),
    ).toEqual({ enviar: false, razao: "motivo_de_decisao" });
  });

  test("lead objetando o preço: bloqueia", () => {
    expect(
      avaliarAlertaQuente({
        falasIaAnteriores: [PRECO],
        ultimaMensagem: "Não teria um mais em conta?",
        motivo: "vai pagar agora",
      }),
    ).toEqual({ enviar: false, razao: "objecao_preco" });
  });

  test("pedido de informação: bloqueia (conv 10913)", () => {
    expect(
      avaliarAlertaQuente({
        falasIaAnteriores: [PRECO],
        ultimaMensagem: "Me manda as duas opções então, com e sem material",
        motivo: "Guilherme está considerando presentear a namorada e pediu informações sobre planos",
      }).enviar,
    ).toBe(false);
  });

  test("link já enviado + data de pagamento: envia (conv 10824)", () => {
    expect(
      avaliarAlertaQuente({
        falasIaAnteriores: [PRECO, LINK],
        ultimaMensagem: "Pago sexta quando o cartão virar",
        motivo: "vai pagar na sexta-feira, quando o cartão virar",
      }),
    ).toEqual({ enviar: true });
  });

  test("lead que já sabe o valor e pede o link: envia mesmo sem preço no histórico", () => {
    expect(
      avaliarAlertaQuente({
        falasIaAnteriores: [],
        ultimaMensagem: "Já sei o valor, manda o link que eu pago",
        motivo: "pediu o link do Anual pra pagar agora",
      }),
    ).toEqual({ enviar: true });
  });
});
