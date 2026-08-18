import { describe, test, expect } from "bun:test";
import { normalizar, ehRepeticao, ehRepeticaoDeAlgum } from "../../src/lib/similaridade.ts";

// Textos REAIS das conversas que motivaram o filtro (ver output.ts / blocoDuplicaMidia).
// conv 5385 — mensagem_antes do Enviar_audio_walker_1
const ANTES_5385 =
  "Acabei de ver que você é formado em Medicina e que essa é a primeira vez que está estudando para concursos. Isso é mais comum do que parece, e quase nunca é falta de esforço.";
// conv 5525 — texto enviado no turno anterior, repetido depois no mensagem_antes
const TEXTO_5525 = "Isso é bem mais comum do que parece, e quase nunca é falta de esforço";

describe("normalizar", () => {
  test("minúsculas e sem acento", () => {
    expect(normalizar("Você É Formado")).toBe("voce e formado");
  });

  test("remove pontuação e emoji, colapsa espaços", () => {
    expect(normalizar("Está podendo agora? 👀")).toBe("esta podendo agora");
    expect(normalizar("  Ótimo,   Luiz!  ")).toBe("otimo luiz");
  });

  test("tolera entrada vazia/nula", () => {
    expect(normalizar("")).toBe("");
    expect(normalizar(undefined as unknown as string)).toBe("");
  });
});

describe("ehRepeticao — substring exata (comportamento antigo preservado)", () => {
  test("pega a mesma frase com pontuação/caixa diferente", () => {
    expect(
      ehRepeticao("vou te mostrar tudo que está incluso", "Vou te mostrar tudo que está incluso!"),
    ).toBe(true);
  });

  test("frase idêntica dentro de um texto maior", () => {
    expect(ehRepeticao("Isso é mais comum do que parece", ANTES_5385)).toBe(true);
  });
});

describe("ehRepeticao — paráfrase (conv 5385)", () => {
  test("'Vi que' vs 'Acabei de ver que' é repetição", () => {
    const bloco =
      "Vi que você é formado em Medicina e que essa é a primeira vez que está estudando para concursos.";
    expect(ehRepeticao(bloco, ANTES_5385)).toBe(true);
  });

  test("inserção de palavra ('bem mais comum') é repetição — conv 5525", () => {
    expect(
      ehRepeticao("Isso é mais comum do que parece, e quase nunca é falta de esforço", TEXTO_5525),
    ).toBe(true);
  });
});

describe("ehRepeticao — não-regressão: frases legítimas do roteiro NÃO são filtradas", () => {
  const legitimas = [
    "Você também sente isso na hora de estudar?",
    "Você é formado, tem disciplina, e mesmo assim trava na hora de estudar?",
    "E hoje, quanto tempo por dia você consegue estudar de verdade?",
    "Você já tentou montar um cronograma sozinho?",
    "Posso te mostrar os planos?",
  ];
  for (const f of legitimas) {
    test(`passa: "${f.slice(0, 45)}…"`, () => {
      expect(ehRepeticao(f, ANTES_5385)).toBe(false);
    });
  }
});

describe("ehRepeticao — guardas contra falso-positivo", () => {
  test("frase curta (< 6 palavras) só casa por substring exata", () => {
    // Todas as palavras existem no anterior, mas em outra ordem/recorte.
    expect(ehRepeticao("Esforço, medicina e concursos", ANTES_5385)).toBe(false);
    expect(ehRepeticao("Isso mesmo", ANTES_5385)).toBe(false);
  });

  test("frase longa com poucos trigramas em comum passa", () => {
    expect(
      ehRepeticao(
        "Acabei de receber a confirmação do seu pagamento e já vou liberar os acessos",
        ANTES_5385,
      ),
    ).toBe(false);
  });

  test("bloco vazio ou anterior vazio nunca é repetição", () => {
    expect(ehRepeticao("", ANTES_5385)).toBe(false);
    expect(ehRepeticao("qualquer coisa aqui", "")).toBe(false);
  });
});

describe("ehRepeticaoDeAlgum", () => {
  test("lista vazia → false", () => {
    expect(ehRepeticaoDeAlgum("Isso é mais comum do que parece", [])).toBe(false);
  });

  test("casa com qualquer item da lista", () => {
    const bloco =
      "Vi que você é formado em Medicina e que essa é a primeira vez que está estudando para concursos.";
    expect(ehRepeticaoDeAlgum(bloco, ["nada a ver", ANTES_5385])).toBe(true);
  });
});
