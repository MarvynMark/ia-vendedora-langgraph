import { describe, test, expect } from "bun:test";
import { formatarTexto, ssmlPreservaOTexto, agruparAteLimite, MAX_BOLHAS_POR_TURNO } from "../../src/lib/response-formatter.ts";

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

// Conv 7021: o modelo escreveu UM parágrafo e dividirEmFrases o transformou em 8 bolhas
// seguidas, para um teto de 5 que só existia no prompt. O teto agora é código, e funde em vez
// de descartar — a cauda (preço, pergunta, CTA, link) tem que continuar uma por bolha.
describe("agruparAteLimite", () => {
  const PITCH = [
    "Entendo, Julia.",
    "Mesmo sem a data do edital, começar agora te coloca na frente.",
    "Vou te mostrar os planos que fazem sentido pro teu momento.",
    "Maravilha, o plano que faz sentido é o Anual Completo, que já vem com a Premium do Estratégia.",
    "Fica em 12x de R$ 394 no cartão.",
    "Tem também o Semestral Premium, mesma coisa em 6 meses, em 12x de R$ 246 no cartão.",
    "Qual desses encaixa melhor pro seu momento, o Anual Completo ou o Semestral Premium?",
    "Pode ser transparente comigo.",
  ];

  test("respeita o teto de 5 bolhas", () => {
    expect(agruparAteLimite(PITCH).length).toBe(5);
  });

  test("não descarta nada — todo o texto continua presente", () => {
    const juntas = agruparAteLimite(PITCH).join(" ");
    for (const frase of PITCH) expect(juntas).toContain(frase);
  });

  test("funde as bolhas curtas primeiro e deixa as longas sozinhas", () => {
    const bolhas = agruparAteLimite(PITCH);
    // "Entendo, Julia." é a mais curta: some dentro de uma bolha maior, nunca fica sozinha
    expect(bolhas).not.toContain("Entendo, Julia.");
    expect(bolhas[0]).toContain("Entendo, Julia.");
    // a frase mais longa do pitch sobrevive como bolha própria, com conteúdo
    expect(bolhas[2]).toBe(PITCH[3]);
    // e a pergunta cai junto do "pode ser transparente comigo" — que é exatamente o que o
    // prompt tentava conseguir pedindo ao modelo "duas frases, não três"
    expect(bolhas[4]).toBe(`${PITCH[6]} ${PITCH[7]}`);
    // e a ordem do texto nunca muda
    expect(bolhas.join(" ")).toBe(PITCH.join(" "));
  });

  test("abaixo do teto passa intacto", () => {
    const tres = PITCH.slice(0, 3);
    expect(agruparAteLimite(tres)).toEqual(tres);
    expect(agruparAteLimite([])).toEqual([]);
  });

  test("teto de 1 junta tudo numa bolha só", () => {
    expect(agruparAteLimite(PITCH, 1)).toEqual([PITCH.join(" ")]);
  });

  test("MAX_BOLHAS_POR_TURNO é o teto que o roteiro usa no pitch e no fechamento", () => {
    expect(MAX_BOLHAS_POR_TURNO).toBe(5);
  });
});
