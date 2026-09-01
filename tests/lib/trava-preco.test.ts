import { describe, test, expect, beforeEach } from "bun:test";
import { blocoIntroduzSegundoPlano, blocoPerguntaEscolhaDeCardapio, iniciarTurnoDePreco } from "../../src/lib/trava-preco.ts";

// Simula o pipeline de envio: divide a resposta em frases (uma bolha cada) e aplica a trava,
// como enviarTextoComHistorico faz em src/graphs/main-agent/graph.ts.
function filtrarTurno(idConversa: string, frases: string[]): string[] {
  iniciarTurnoDePreco(idConversa);
  return frases.filter((f) => !blocoIntroduzSegundoPlano(idConversa, f));
}

describe("trava de cardápio (blocoIntroduzSegundoPlano)", () => {
  beforeEach(() => iniciarTurnoDePreco("t1"));

  test("o pitch de dois planos passa inteiro (Anual recomendado + Semestral)", () => {
    const frases = [
      "Maravilha, o plano que faz sentido pro teu momento é o Anual Completo, que já vem com a Premium do Estratégia inclusa",
      "Fica em 12x de R$ 394 no cartão",
      "Tem também o Semestral, 6 meses de acompanhamento, em 12x de R$ 197 no cartão",
      "Algum desses encaixa pro seu momento? Pode ser transparente comigo",
    ];
    expect(filtrarTurno("t1", frases)).toEqual(frases);
  });

  test("o TERCEIRO plano é derrubado — é ele que vira cardápio (caso da conv 5917)", () => {
    const frases = [
      "Ele fica em 12x de R$ 315 no cartão",
      "Se você preferir algo mais enxuto, tem o Semestral, por 12x de R$ 197",
      "Se precisar de algo ainda mais enxuto, tem o Trimestral, por 12x de R$ 98,35",
    ];
    expect(filtrarTurno("t1", frases)).toEqual([frases[0]!, frases[1]!]);
  });

  test("frases sem preço nunca são derrubadas", () => {
    const frases = ["Bora ver os planos?", "Como o edital ainda não saiu, dá tempo de construir base"];
    expect(filtrarTurno("t1", frases)).toEqual(frases);
  });

  test("o par cartão + à vista do MESMO plano passa em bolhas separadas", () => {
    const frases = ["Fica em 12x de R$ 197 no cartão", "Ou R$ 1.997 à vista no PIX"];
    expect(filtrarTurno("t1", frases)).toEqual(frases);
  });

  test("o parcelado no boleto do mesmo plano passa (12x R$ 206 = Semestral)", () => {
    const frases = [
      "O Semestral fica em 12x de R$ 197 no cartão",
      "No boleto parcelado ficam 12x de R$ 206, sem precisar de limite",
    ];
    expect(filtrarTurno("t1", frases)).toEqual(frases);
  });

  test("a primeira frase com preço passa mesmo trazendo três planos de uma vez", () => {
    const frases = [
      "O Anual é 12x de R$ 315, o Semestral 12x de R$ 197 e o Trimestral 12x de R$ 98,35",
      "E ainda tem o Anual Completo por 12x de R$ 394",
    ];
    expect(filtrarTurno("t1", frases)).toEqual([frases[0]!]);
  });

  test("a trava é por TURNO: o downsell do turno seguinte é permitido", () => {
    filtrarTurno("t1", ["O Anual fica em 12x de R$ 315", "Tem também o Semestral, 12x de R$ 197"]);
    // turno seguinte, depois de o lead recusar os dois
    expect(filtrarTurno("t1", ["Então o Trimestral: 12x de R$ 98,35 no cartão"])).toEqual([
      "Então o Trimestral: 12x de R$ 98,35 no cartão",
    ]);
  });

  test("conversas diferentes não interferem uma na outra", () => {
    iniciarTurnoDePreco("A");
    iniciarTurnoDePreco("B");
    expect(blocoIntroduzSegundoPlano("A", "O Anual fica em 12x de R$ 315")).toBe(false);
    expect(blocoIntroduzSegundoPlano("B", "O Semestral fica em 12x de R$ 197")).toBe(false);
    expect(blocoIntroduzSegundoPlano("A", "Tem também o Semestral, 12x de R$ 197")).toBe(false); // 2º plano de A
    expect(blocoIntroduzSegundoPlano("A", "E o Trimestral, 12x de R$ 98,35")).toBe(true);        // 3º plano de A
    expect(blocoIntroduzSegundoPlano("B", "E o Anual Completo, 12x de R$ 394")).toBe(false);     // 2º plano de B
  });

  test("trilha de médico: os dois planos de médico passam pela trava (é o prompt que a restringe a um)", () => {
    const frases = [
      "O Médico Legista Semestral fica em 12x de R$ 394 no cartão",
      "Se quiser um plano mais longo, o Médico Legista Anual sai por 12x de R$ 641",
    ];
    expect(filtrarTurno("t1", frases)).toEqual(frases);
  });
});

describe("blocoPerguntaEscolhaDeCardapio", () => {
  beforeEach(() => iniciarTurnoDePreco("t2"));

  test("derruba a pergunta órfã depois de a trava remover um terceiro plano", () => {
    expect(blocoIntroduzSegundoPlano("t2", "O Anual fica em 12x de R$ 315")).toBe(false);
    expect(blocoIntroduzSegundoPlano("t2", "E o Semestral por 12x de R$ 197")).toBe(false);
    expect(blocoIntroduzSegundoPlano("t2", "E o Trimestral por 12x de R$ 98,35")).toBe(true);
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Qual desses três planos encaixa melhor no seu momento?")).toBe(true);
  });

  test("sem trava no turno, a pergunta de escolha passa (o pitch de dois planos precisa dela)", () => {
    blocoIntroduzSegundoPlano("t2", "O Anual fica em 12x de R$ 315");
    blocoIntroduzSegundoPlano("t2", "Tem também o Semestral, 12x de R$ 197");
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Algum desses encaixa pro seu momento?")).toBe(false);
  });

  test("a pergunta da forma de pagamento nunca é derrubada", () => {
    blocoIntroduzSegundoPlano("t2", "O Anual fica em 12x de R$ 315");
    blocoIntroduzSegundoPlano("t2", "E o Semestral por 12x de R$ 197");
    blocoIntroduzSegundoPlano("t2", "E o Trimestral por 12x de R$ 98,35");
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Cartão ou o pix/boleto parcelado sem precisar de limite?")).toBe(false);
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Quer que eu já te passe o link?")).toBe(false);
  });
});

describe("fecho oficial do pitch", () => {
  beforeEach(() => iniciarTurnoDePreco("t3"));

  test("nunca é derrubado, mesmo quando a trava barrou um terceiro plano", () => {
    blocoIntroduzSegundoPlano("t3", "O Anual Completo fica em 12x de R$ 394");
    blocoIntroduzSegundoPlano("t3", "Tem também o Semestral, 12x de R$ 197");
    expect(blocoIntroduzSegundoPlano("t3", "E o Trimestral por 12x de R$ 98,35")).toBe(true);
    expect(
      blocoPerguntaEscolhaDeCardapio("t3", "Qual desses encaixa melhor pro seu momento? O Anual Completo ou o Semestral? Pode ser transparente comigo."),
    ).toBe(false);
  });

  test("a pergunta de escolha SEM a assinatura do fecho continua sendo derrubada", () => {
    blocoIntroduzSegundoPlano("t3", "O Anual fica em 12x de R$ 315");
    blocoIntroduzSegundoPlano("t3", "E o Semestral por 12x de R$ 197");
    blocoIntroduzSegundoPlano("t3", "E o Trimestral por 12x de R$ 98,35");
    expect(blocoPerguntaEscolhaDeCardapio("t3", "Qual desses três você prefere?")).toBe(true);
  });
});
