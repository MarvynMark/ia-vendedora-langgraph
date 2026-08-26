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

  test("pitch de um plano só passa inteiro", () => {
    const frases = [
      "Maravilha, o plano que faz sentido pro teu momento é o Anual Completo",
      "Fica em 12x de R$ 394 no cartão ou R$ 3.997 à vista no PIX, já com a Premium do Estratégia inclusa",
      "Você testa por 7 dias e, se não for pra você, devolvo cada centavo. Cartão ou boleto parcelado?",
    ];
    expect(filtrarTurno("t1", frases)).toEqual(frases);
  });

  test("cardápio: mantém o primeiro plano e derruba os demais (caso da conv 5917)", () => {
    const frases = [
      "Além do Anual Completo, temos o plano Anual normal, que é só a mentoria",
      "Ele fica em 12x de R$ 315 no cartão ou R$ 3.197 à vista no PIX",
      "Se você preferir algo mais enxuto, tem o Semestral, por 12x de R$ 197 ou R$ 1.997 à vista",
      "Se precisar de algo ainda mais enxuto, tem o Trimestral, por 12x de R$ 98,35 ou R$ 997 à vista",
      "Qual desses planos você acha que encaixa melhor no seu momento?",
    ];
    expect(filtrarTurno("t1", frases)).toEqual([
      "Além do Anual Completo, temos o plano Anual normal, que é só a mentoria",
      "Ele fica em 12x de R$ 315 no cartão ou R$ 3.197 à vista no PIX",
      "Qual desses planos você acha que encaixa melhor no seu momento?",
    ]);
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

  test("a primeira frase com preço passa mesmo trazendo dois planos (melhor que ficar sem preço)", () => {
    const frases = ["O Anual é 12x de R$ 315 e o Semestral 12x de R$ 197", "E o Trimestral sai por 12x de R$ 98,35"];
    expect(filtrarTurno("t1", frases)).toEqual([frases[0]!]);
  });

  test("a trava é por TURNO: o downsell do turno seguinte é permitido", () => {
    filtrarTurno("t1", ["O Anual fica em 12x de R$ 315"]);
    // turno seguinte, depois de o lead recusar
    expect(filtrarTurno("t1", ["Então o Semestral: 12x de R$ 197 ou R$ 1.997 à vista"])).toEqual([
      "Então o Semestral: 12x de R$ 197 ou R$ 1.997 à vista",
    ]);
  });

  test("conversas diferentes não interferem uma na outra", () => {
    iniciarTurnoDePreco("A");
    iniciarTurnoDePreco("B");
    expect(blocoIntroduzSegundoPlano("A", "O Anual fica em 12x de R$ 315")).toBe(false);
    expect(blocoIntroduzSegundoPlano("B", "O Semestral fica em 12x de R$ 197")).toBe(false);
    expect(blocoIntroduzSegundoPlano("A", "O Semestral fica em 12x de R$ 197")).toBe(true);
  });

  test("trilha de médico: o segundo plano do médico também é travado", () => {
    const frases = [
      "O Médico Legista Semestral fica em 12x de R$ 394 ou R$ 3.997 à vista",
      "Se quiser um plano mais longo, o Médico Legista Anual sai por 12x de R$ 641",
    ];
    expect(filtrarTurno("t1", frases)).toEqual([frases[0]!]);
  });
});

describe("blocoPerguntaEscolhaDeCardapio", () => {
  beforeEach(() => iniciarTurnoDePreco("t2"));

  test("derruba a pergunta órfã depois de a trava remover os outros planos", () => {
    expect(blocoIntroduzSegundoPlano("t2", "O Anual fica em 12x de R$ 315")).toBe(false);
    expect(blocoIntroduzSegundoPlano("t2", "E o Semestral por 12x de R$ 197")).toBe(true);
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Qual desses planos encaixa melhor no seu momento?")).toBe(true);
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Qual dessas opções faz mais sentido pra você?")).toBe(true);
  });

  test("sem trava no turno, a pergunta passa (pitch de um plano só não é afetado)", () => {
    blocoIntroduzSegundoPlano("t2", "O Anual fica em 12x de R$ 315");
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Qual desses planos encaixa melhor?")).toBe(false);
  });

  test("a pergunta da forma de pagamento nunca é derrubada", () => {
    blocoIntroduzSegundoPlano("t2", "O Anual fica em 12x de R$ 315");
    blocoIntroduzSegundoPlano("t2", "E o Semestral por 12x de R$ 197");
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Cartão ou o pix/boleto parcelado sem precisar de limite?")).toBe(false);
    expect(blocoPerguntaEscolhaDeCardapio("t2", "Quer que eu já te passe o link?")).toBe(false);
  });
});
