import { describe, test, expect } from "bun:test";
import { formatarTexto, ssmlPreservaOTexto } from "../../src/lib/response-formatter.ts";

// Regressão das convs 6941 e 6943: o agente gerou 58 caracteres e o lead recebeu dez mensagens
// em que a IA narrava a própria semana de estudos. A causa era o formatador ser um LLM que
// recebia o texto do agente como mensagem `user` — e respondia perguntas em vez de formatá-las.
describe("formatarTexto — determinístico", () => {
  test("uma pergunta entra e a MESMA pergunta sai (convs 6941/6943)", () => {
    const p = "Me conta como foi tua última semana de estudo, na prática.";
    expect(formatarTexto(p)).toBe(p);
  });

  test("nunca inventa conteúdo: a saída só contém palavras da entrada", () => {
    const entrada = "O que mais te trava na hora de estudar?";
    const saida = formatarTexto(entrada);
    expect(saida).toBe(entrada);
    expect(saida.toLowerCase()).not.toContain("python");
  });

  test("negrito markdown vira negrito do WhatsApp", () => {
    expect(formatarTexto("Fica em **12x de R$ 315** no cartão.")).toBe("Fica em *12x de R$ 315* no cartão.");
  });

  test("remove cabeçalho markdown", () => {
    expect(formatarTexto("# Título\nTexto normal.")).toBe("Título Texto normal.");
  });

  test("respeita os blocos que o agente já separou", () => {
    const pitch = "Maravilha, o plano é o Anual.\n\nFica em 12x de R$ 315 no cartão.\n\nQual desses encaixa melhor?";
    expect(formatarTexto(pitch).split("\n\n")).toHaveLength(3);
  });

  test("lista fica inteira numa bolha só", () => {
    const lista = "Você vai ter:\n✅ Cronograma individual\n✅ Acompanhamento comigo\n✅ Encontros ao vivo";
    const blocos = formatarTexto(lista).split("\n\n");
    expect(blocos).toHaveLength(1);
    expect(blocos[0]).toContain("Cronograma");
    expect(blocos[0]).toContain("Encontros ao vivo");
  });

  test("texto vazio passa intacto", () => {
    expect(formatarTexto("")).toBe("");
    expect(formatarTexto("   ")).toBe("   ");
  });

  test("nunca passa de 10 bolhas, e não descarta conteúdo", () => {
    const muitas = Array.from({ length: 16 }, (_, i) => `Frase número ${i + 1}.`).join(" ");
    const blocos = formatarTexto(muitas).split("\n\n");
    expect(blocos.length).toBeLessThanOrEqual(10);
    expect(formatarTexto(muitas)).toContain("Frase número 16");
  });

  test("preserva link de pagamento intacto", () => {
    const t = "Aqui está o link: https://peritowalker.com.br/mentoriaperito";
    expect(formatarTexto(t)).toContain("https://peritowalker.com.br/mentoriaperito");
  });
});

// conv 6907 — mesmo modo de falha das 6941/6943, sobrevivendo no formatador de SSML: o texto do
// agente vai como `user` para um segundo modelo, que pode respondê-lo em vez de convertê-lo.
// Aqui o LLM não sai (converter número pra forma falada é o motivo dele existir), então a saída
// é validada.
describe("ssmlPreservaOTexto", () => {
  const ORIGINAL =
    "Oi, Wladimir! Vi que você mencionou a anatomia como sua maior dificuldade. Isso é bem comum, e quase nunca é falta de esforço. Me conta como foi tua última semana de estudo, na prática.";

  test("rejeita a recusa que o lead da 6907 recebeu", () => {
    const recusa =
      "Desculpe, mas não posso compartilhar informações pessoais ou experiências. Posso ajudar com dicas de estudo ou informações sobre técnicas de aprendizado, se você quiser!";
    expect(ssmlPreservaOTexto(ORIGINAL, recusa)).toBe(false);
  });

  test("rejeita o modelo narrando a própria semana (6941/6943)", () => {
    const narrativa =
      "<speak>Minha última semana foi bem produtiva! Estudei Python, trabalhei com Pandas e avancei em machine learning, revisando conceitos de regressão.</speak>";
    expect(ssmlPreservaOTexto(ORIGINAL, narrativa)).toBe(false);
  });

  test("aceita uma conversão SSML legítima", () => {
    const ssml =
      "<speak><break time='1.0s'/>Oi, Wladimir! Vi que você mencionou a anatomia como sua maior dificuldade. Isso é bem comum, e quase nunca é falta de esforço. Me conta como foi tua última semana de estudo, na prática.</speak>";
    expect(ssmlPreservaOTexto(ORIGINAL, ssml)).toBe(true);
  });

  test("aceita conversão de números para forma falada", () => {
    const orig = "Fica em 12x de R$ 394 no cartão, começando hoje mesmo na mentoria.";
    const ssml = "<speak>Fica em doze vezes de trezentos e noventa e quatro reais no cartão, começando hoje mesmo na mentoria.</speak>";
    expect(ssmlPreservaOTexto(orig, ssml)).toBe(true);
  });

  test("não julga texto curto demais", () => {
    expect(ssmlPreservaOTexto("Boa!", "<speak>qualquer coisa</speak>")).toBe(true);
  });
});
