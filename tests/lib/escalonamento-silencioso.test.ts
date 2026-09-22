import { describe, test, expect } from "bun:test";
import { anunciaEscalacao, removerAnuncioDeEscalacao } from "../../src/lib/escalonamento-silencioso.ts";

describe("anunciaEscalacao", () => {
  test("pega o que saiu na conv 4014", () => {
    expect(anunciaEscalacao("Vou passar essa questão para um humano da equipe te ajudar diretamente com isso.")).toBe(true);
    expect(anunciaEscalacao("Eles vão entrar em contato com você em breve para resolver essa diferença no valor.")).toBe(true);
  });

  test("pega as variações que o prompt já proibia", () => {
    for (const f of [
      "Vou te encaminhar para o suporte.",
      "Vou chamar alguém aqui pra te ajudar.",
      "A equipe vai te responder já já.",
      "Um instante que já te respondem.",
      "Já estou acionando a equipe responsável.",
      "Vou transferir você para um atendente.",
      "Um especialista vai assumir a partir daqui.",
    ]) expect(anunciaEscalacao(f)).toBe(true);
  });

  test("não pega fala normal de venda", () => {
    for (const f of [
      "Vou te passar o valor certinho agora.",
      "Vou gerar o teu link com essa condição e já te mando por aqui.",
      "Vou te mandar o link do Anual.",
      "Eu mesmo acompanho você na mentoria, com suporte no WhatsApp.",
      "Me avisa quando conseguir finalizar que eu já libero teus acessos.",
      "A gente vai montar teu plano de estudos juntos.",
      "Vou te dar um tempo pra pensar, sem pressão.",
    ]) expect(anunciaEscalacao(f)).toBe(false);
  });
});

describe("removerAnuncioDeEscalacao", () => {
  test("tira só a frase que entrega a escalação e mantém o resto da bolha", () => {
    const r = removerAnuncioDeEscalacao("Entendi a sua dúvida sobre o valor. Vou passar essa questão para um humano da equipe te ajudar.");
    expect(r.texto).toBe("Entendi a sua dúvida sobre o valor.");
    expect(r.removidas).toHaveLength(1);
  });

  test("turno que era SÓ anúncio fica vazio (nada é enviado ao lead)", () => {
    const r = removerAnuncioDeEscalacao("Vou passar essa questão para um humano da equipe te ajudar diretamente com isso.\nEles vão entrar em contato com você em breve.");
    expect(r.texto).toBe("");
    expect(r.removidas).toHaveLength(2);
  });

  // Regressão conv 8660 (22/09): a versão que comparava o texto limpo com o original escalava
  // quando a limpeza só normalizava espaçamento. Formatação do modelo NÃO é anúncio.
  test("espaçamento variado não conta como remoção e o texto sai intacto", () => {
    for (const saida of [
      "Uma frase.  Outra frase.",
      "Frase final.   ",
      " Começa com espaço.",
      "Compreendo, Amanda. A organização é essencial.\n \nVou te mandar um vídeo que mostra como funciona.",
      "Linha um.\n\n\n\nLinha dois.",
      "São 12x de R$ 315 no cartão.\nQuer que eu te mande o link?",
    ]) {
      const r = removerAnuncioDeEscalacao(saida);
      expect(r.removidas).toHaveLength(0);
      expect(r.texto).toBe(saida);
    }
  });
});
