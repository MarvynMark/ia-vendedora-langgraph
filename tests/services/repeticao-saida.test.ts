import { describe, test, expect } from "bun:test";
import { registrarSaidasRecentes, blocoRepeteSaidaRecente } from "../../src/services/chatwoot.ts";

// Conv 9619 (03/10/2026): o lead respondeu "Combinado" e recebeu de novo as duas bolhas da despedida.
const CONV = "teste-9619";
registrarSaidasRecentes(CONV, [
  "Qual desses encaixa melhor pro seu momento, o Anual ou o Semestral? Pode ser transparente comigo.",
  "Perfeito, André. Vou te chamar na segunda-feira pra ver como ficou. Qualquer dúvida que surgir até lá, é só me avisar. Boa reflexão e até segunda!",
]);

describe("blocoRepeteSaidaRecente", () => {
  test("a despedida repetida no turno seguinte é descartada", () => {
    expect(blocoRepeteSaidaRecente(CONV, "Vou te chamar na segunda-feira pra ver como ficou.")).toBe(true);
    expect(blocoRepeteSaidaRecente(CONV, "Boa reflexão e até segunda!")).toBe(true);
  });

  test("o 'pode ser transparente comigo' não sai duas vezes", () => {
    expect(blocoRepeteSaidaRecente(CONV, "Pode ser transparente comigo.")).toBe(true);
  });

  test("frase nova passa", () => {
    expect(blocoRepeteSaidaRecente(CONV, "Que tal começar com algum desses?")).toBe(false);
  });

  test("link e preço reenviados a pedido do lead passam", () => {
    registrarSaidasRecentes("teste-link", ["Aqui está o teu link: https://exemplo.com/x. Fica em 12x de R$ 315 no cartão."]);
    expect(blocoRepeteSaidaRecente("teste-link", "Aqui está o teu link: https://exemplo.com/x.")).toBe(false);
    expect(blocoRepeteSaidaRecente("teste-link", "Fica em 12x de R$ 315 no cartão.")).toBe(false);
  });

  test("conversa sem histórico registrado: nada é descartado", () => {
    expect(blocoRepeteSaidaRecente("sem-historico", "Boa reflexão e até segunda!")).toBe(false);
  });
});

import { blocoTemFraseProibida, blocoSoEmoji } from "../../src/services/chatwoot.ts";

describe("frases de IA apontadas na conv 9619", () => {
  test("papagaio, 'boa reflexão' e 'importante se sentir seguro' são descartados", () => {
    expect(blocoTemFraseProibida("Você mencionou que quer refletir sobre os valores e o melhor plano até segunda-feira.")).toBe(true);
    expect(blocoTemFraseProibida("Boa reflexão e até segunda!")).toBe(true);
    expect(blocoTemFraseProibida("É importante se sentir seguro na decisão.")).toBe(true);
  });

  test("usar a palavra do lead no meio da frase continua valendo", () => {
    expect(blocoTemFraseProibida("Como você mencionou a rotina na FAB, o plano vai respeitar teus horários.")).toBe(false);
    expect(blocoTemFraseProibida("Blz, André, vê o que encaixa melhor pra você.")).toBe(false);
  });
});

describe("blocoSoEmoji", () => {
  test("bolha só com emoji sai; texto com emoji fica", () => {
    expect(blocoSoEmoji("👍")).toBe(true);
    expect(blocoSoEmoji("👍🏻!")).toBe(true);
    expect(blocoSoEmoji("Show, André 👍")).toBe(false);
    expect(blocoSoEmoji("")).toBe(false);
  });
});
