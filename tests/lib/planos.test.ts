import { describe, test, expect } from "bun:test";
import { temPrecoDePlano, planosCitados, temLinkDePagamento, conferirFormaDePagamento } from "../../src/lib/planos.ts";

describe("temPrecoDePlano", () => {
  test("reconhece o valor no cartão e à vista", () => {
    expect(temPrecoDePlano("Fica em 12x de R$ 394 no cartão ou R$ 3.997 à vista no PIX.")).toBe(true);
    expect(temPrecoDePlano("Fica em 12x de R$ 197 no cartão")).toBe(true);
  });

  test("reconhece o valor com o negrito do WhatsApp", () => {
    expect(temPrecoDePlano("Fica em 12x de *R$ 315* no cartão")).toBe(true);
    expect(temPrecoDePlano("ou *R$ 3.197* à vista")).toBe(true);
  });

  test("reconhece o parcelado no boleto/PIX", () => {
    expect(temPrecoDePlano("são 12x de R$ 330 no boleto")).toBe(true);
    expect(temPrecoDePlano("12x de R$ 103,11")).toBe(true);
  });

  test("texto sem preço de plano não dispara", () => {
    expect(temPrecoDePlano("Quer que eu te mostre os planos?")).toBe(false);
    expect(temPrecoDePlano("um cargo que começa entre R$ 15 e 20 mil por mês")).toBe(false);
    expect(temPrecoDePlano("a Premium sozinha sai quase R$ 2.000")).toBe(false);
  });
});

describe("planosCitados", () => {
  test("um plano por vez", () => {
    expect(planosCitados("O Anual fica em 12x de R$ 315 ou R$ 3.197 à vista")).toEqual(["anual"]);
    expect(planosCitados("O Semestral fica em 12x de R$ 197 ou R$ 1.997 à vista")).toEqual(["semestral"]);
    expect(planosCitados("O Trimestral sai por 12x de R$ 98,35 ou R$ 997 à vista")).toEqual(["trimestral"]);
  });

  test("o cardápio devolve os planos na ordem em que aparecem", () => {
    const texto =
      "Além do Anual Completo, temos o Anual, que fica em 12x de R$ 315. " +
      "E se preferir algo mais enxuto, o Semestral sai por 12x de R$ 197. " +
      "Se precisar de algo ainda menor, o Trimestral fica em 12x de R$ 98,35.";
    expect(planosCitados(texto)).toEqual(["anual", "semestral", "trimestral"]);
  });

  test("R$ 997 do Trimestral não é confundido com R$ 3.997 nem R$ 1.997", () => {
    expect(planosCitados("R$ 3.997 à vista")).toEqual(["anual_completo"]);
    expect(planosCitados("R$ 1.997 à vista")).toEqual(["semestral"]);
    expect(planosCitados("R$ 997 à vista")).toEqual(["trimestral"]);
  });

  test("R$ 197 do Semestral não é confundido com R$ 3.197 do Anual", () => {
    expect(planosCitados("O Anual sai por R$ 3.197 à vista")).toEqual(["anual"]);
    expect(planosCitados("O Semestral sai por R$ 197 por mês")).toEqual(["semestral"]);
  });

  test("valores compartilhados: o nome do plano desempata Anual Completo x Médico Legista", () => {
    expect(planosCitados("O Anual Completo fica em 12x de R$ 394")).toEqual(["anual_completo"]);
    expect(planosCitados("O plano Médico Legista fica em 12x de R$ 394")).toEqual(["medico_semestral"]);
    expect(planosCitados("O Médico Legista Anual fica em 12x de R$ 641")).toEqual(["medico_anual"]);
  });

  test("valor ambíguo e sem nome: usa a preferência (plano ancorado no turno)", () => {
    expect(planosCitados("fica em 12x de R$ 394", "medico_semestral")).toEqual(["medico_semestral"]);
    expect(planosCitados("fica em 12x de R$ 394")).toEqual(["anual_completo"]);
  });

  test("o salário do cargo e o preço avulso da Premium não contam como plano", () => {
    expect(planosCitados("um cargo de R$ 15 a 20 mil por mês")).toEqual([]);
    expect(planosCitados("a Premium sozinha sai quase R$ 2.000")).toEqual([]);
  });
});

// Conv 6890: a lead voltou com "Gostaria de contratar a mentoria" e a IA mandou o link do Anual
// sem escrever um único valor. Sem reconhecer o link, o guard de Kanban não rodaria e o card
// ficaria sem o marcador "link enviado" — que é o que roteia para a cadência de lembrete (20min)
// em vez da pós-preço (1h).
describe("temLinkDePagamento", () => {
  test("reconhece o link de checkout, inclusive dentro de markdown", () => {
    expect(temLinkDePagamento("Aqui está o link: https://peritowalker.com.br/mentoriaperitoanual.")).toBe(true);
    expect(temLinkDePagamento("[https://peritowalker.com.br/mentoriaperitoanual](https://peritowalker.com.br/mentoriaperitoanual)")).toBe(true);
    expect(temLinkDePagamento("https://peritowalker.com.br/medicolegista")).toBe(true);
    expect(temLinkDePagamento("https://peritowalker.com.br/mentoriaperitoanualparcelado")).toBe(true);
  });

  test("não confunde com o e-book nem com texto sem link", () => {
    expect(temLinkDePagamento("https://www.csiacademy.com.br/ebooks")).toBe(false);
    expect(temLinkDePagamento("Fica em 12x de R$ 315 no cartão.")).toBe(false);
    expect(temLinkDePagamento("")).toBe(false);
  });
});

// Conv 7021: lead sem limite no cartão, a IA prometeu boleto/PIX parcelado e mandou o link do
// CARTÃO rotulado "Parcelado". A lead abre, não consegue pagar e some.
describe("conferirFormaDePagamento", () => {
  const PROMESSA = "Dá pra fazer no boleto ou no PIX parcelado, em até 12x, sem depender de limite no cartão.";

  test("troca o link de cartão pelo de parcelado quando o plano tem os dois", () => {
    const r = conferirFormaDePagamento(`${PROMESSA} https://peritowalker.com.br/mentoriaperitoanual`);
    expect(r.texto).toContain("peritowalker.com.br/mentoriaperitoanualparcelado");
    expect(r.corrigidos[0]?.plano).toBe("anual");
    expect(r.semParcelado).toEqual([]);
  });

  test("não confunde o Semestral com os planos cujo slug o contém", () => {
    const r = conferirFormaDePagamento(`${PROMESSA} https://peritowalker.com.br/mentoriaperito`);
    expect(r.texto).toContain("peritowalker.com.br/mentoriaperitoparcelado");
    expect(r.corrigidos[0]?.plano).toBe("semestral");
  });

  test("corrige dentro de markdown, label e URL", () => {
    const r = conferirFormaDePagamento(
      `${PROMESSA} [Anual Completo](https://peritowalker.com.br/mentoriaperitoanualpremium)`,
    );
    expect(r.texto).toContain("mentoriaperitoanualpremiumparcelado");
    expect(r.texto).not.toMatch(/mentoriaperitoanualpremium(?!parcelado)/);
  });

  test("Semestral Premium não tem parcelado — sinaliza em vez de inventar URL", () => {
    const r = conferirFormaDePagamento(`${PROMESSA} https://peritowalker.com.br/mentoriaperitosemestralpremium`);
    expect(r.semParcelado).toEqual(["semestral_premium"]);
    expect(r.corrigidos).toEqual([]);
    expect(r.texto).toContain("mentoriaperitosemestralpremium"); // não inventa link
  });

  test("link que JÁ é o de parcelado passa intacto", () => {
    const r = conferirFormaDePagamento(`${PROMESSA} https://peritowalker.com.br/mentoriaperitoparcelado`);
    expect(r.corrigidos).toEqual([]);
    expect(r.semParcelado).toEqual([]);
  });

  test("sem promessa de parcelado, não mexe em nada", () => {
    const cartao = "Fica em 12x de R$ 315 no cartão. https://peritowalker.com.br/mentoriaperitoanual";
    const r = conferirFormaDePagamento(cartao);
    expect(r.texto).toBe(cartao);
    expect(r.corrigidos).toEqual([]);
  });

  test("texto vazio ou sem link não quebra", () => {
    expect(conferirFormaDePagamento("").texto).toBe("");
    expect(conferirFormaDePagamento(PROMESSA).corrigidos).toEqual([]);
  });
});
