import { describe, test, expect } from "bun:test";
import { formatarTexto } from "../../src/lib/response-formatter.ts";

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
