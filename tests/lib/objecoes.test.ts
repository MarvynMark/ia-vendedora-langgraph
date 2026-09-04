import { describe, test, expect } from "bun:test";
import { classificarObjecao, montarAlertaObjecao } from "../../src/lib/objecoes.ts";

describe("classificarObjecao — preço", () => {
  const CASOS = [
    "ta muito caro pra mim agora",
    "achei caro",
    "É caro demais pro meu bolso",
    "não tenho esse valor agora",
    "não tenho como pagar isso",
    "to sem dinheiro esse mês",
    "tô apertado agora",
    "não tenho condições no momento",
    "tem algo mais barato?",
    "queria o mais em conta",
    "isso ta fora do meu orçamento",
    "não cabe no meu bolso",
  ];
  for (const c of CASOS) {
    test(`"${c}"`, () => expect(classificarObjecao(c)).toBe("preco"));
  }
});

describe("classificarObjecao — adiamento", () => {
  const CASOS = [
    "vou pensar e te falo",
    "preciso analisar melhor",
    "vou falar com minha esposa primeiro",
    "vou conversar com meu marido",
    "depois eu te falo",
    "te chamo semana que vem",
    "agora não dá",
    "não é o meu momento",
    "quero ver isso mais pra frente",
    "vou avaliar com calma",
  ];
  for (const c of CASOS) {
    test(`"${c}"`, () => expect(classificarObjecao(c)).toBe("adiamento"));
  }
});

describe("classificarObjecao — pagamento", () => {
  const CASOS = [
    "não tenho cartão de crédito",
    "meu cartão não tem limite",
    "estou sem limite no cartão",
    "só consigo no pix",
    "dá pra pagar no boleto?",
    "meu cartão vira dia 10",
  ];
  for (const c of CASOS) {
    test(`"${c}"`, () => expect(classificarObjecao(c)).toBe("pagamento"));
  }
});

// A parte que decide se o grupo vira ferramenta ou ruído.
describe("classificarObjecao — o que NÃO pode disparar", () => {
  const CASOS = [
    ["entusiasmo com a palavra caro", "achei caro no começo, mas vale a pena demais"],
    ["decisão tomada", "não vou pensar duas vezes, quero começar"],
    ["já decidiu", "já decidi, manda o link"],
    ["pergunta de preço é pedido de pitch", "quanto custa a mentoria?"],
    ["pergunta de preço 2", "qual o valor?"],
    ["pergunta de preço 3", "me passa os valores por favor"],
    ["comparação favorável", "é mais barato que o cursinho que eu pago hoje"],
    ["falta de tempo não é preço", "to sem tempo pra estudar essa semana"],
    ["rotina apertada não é preço", "minha agenda ta apertada de tarefa"],
    ["confirmação simples", "sim, pode mandar"],
    ["saudação", "oi, tudo bem?"],
    ["injeção interna do grafo", "[SISTEMA: sua resposta ignorou o que o lead disse]"],
    ["vazio", ""],
  ];
  for (const [rotulo, texto] of CASOS) {
    test(rotulo!, () => expect(classificarObjecao(texto!)).toBeNull());
  }
});

// Os dois falsos positivos que o dry-run pegou nas conversas reais dos últimos 7 dias.
describe("classificarObjecao — falsos positivos achados no dry-run", () => {
  test("conv 6698: 'onde vou ver' é dúvida de aluno, não adiamento", () => {
    expect(classificarObjecao("Onde vou ver que vai ter encontro ao vivo hoje?")).toBeNull();
  });

  test("'vou ver o vídeo' também não é adiamento", () => {
    expect(classificarObjecao("beleza, vou ver o vídeo agora")).toBeNull();
  });

  test("'vou ver se consigo' continua sendo adiamento", () => {
    expect(classificarObjecao("vou ver se consigo me organizar")).toBe("adiamento");
  });

  test("conv 6363: travou no PIX pelo horário é PAGAMENTO, não falta de dinheiro", () => {
    expect(classificarObjecao("Pelo horário não consigo pagar por pix")).toBe("pagamento");
  });

  test("mas 'não consigo pagar isso' sem forma de pagamento continua preço", () => {
    expect(classificarObjecao("não consigo pagar isso agora")).toBe("preco");
  });
});

describe("classificarObjecao — prioridade e formatos", () => {
  test("preço vence adiamento: 'tá caro, vou pensar' é o valor que trava", () => {
    expect(classificarObjecao("ta caro, vou pensar melhor")).toBe("preco");
  });

  test("pergunta de preço COM objeção junto ainda alerta", () => {
    expect(classificarObjecao("quanto custa? porque vou ter que falar com meu esposo")).toBe("adiamento");
  });

  test("lê áudio transcrito (vem embrulhado pelo message-processor)", () => {
    expect(classificarObjecao("<mensagem-de-audio>olha, ta muito caro pra mim</mensagem-de-audio>")).toBe("preco");
  });

  test("funciona sem acento e em caixa alta", () => {
    expect(classificarObjecao("NAO TENHO CONDICOES AGORA")).toBe("preco");
  });
});

describe("montarAlertaObjecao", () => {
  test("monta o alerta com rótulo, fala e link", () => {
    const alerta = montarAlertaObjecao({
      tipo: "preco",
      nome: "Joel Soria",
      telefone: "+5569984090485",
      fala: "ta muito caro pra mim agora",
      link: "https://chat.stkd.site/app/accounts/1/conversations/6948",
    });
    expect(alerta).toContain("travou no preço");
    expect(alerta).toContain("Joel Soria");
    expect(alerta).toContain("+5569984090485");
    expect(alerta).toContain("ta muito caro pra mim agora");
    expect(alerta).toContain("/conversations/6948");
  });

  test("aguenta lead sem nome e limpa a marcação de áudio", () => {
    const alerta = montarAlertaObjecao({
      tipo: "adiamento",
      nome: "",
      telefone: "+5511999999999",
      fala: "<mensagem-de-audio>vou pensar</mensagem-de-audio>",
      link: "https://x/y",
    });
    expect(alerta).toContain("(sem nome)");
    expect(alerta).not.toContain("mensagem-de-audio");
    expect(alerta).toContain('"vou pensar"');
  });
});
