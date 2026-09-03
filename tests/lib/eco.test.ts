import { describe, test, expect } from "bun:test";
import { respostaIgnoraOLead, temEco, palavrasDeConteudo, instrucaoReescrita } from "../../src/lib/eco.ts";

// Casos reais de agosto: 85% das falas substantivas do lead receberam resposta que não tocava
// no que ele disse. Estas são as conversas exatas.
describe("respostaIgnoraOLead", () => {
  const MAE = "Posso dar uma resposta mais assertiva amanhã? Vou verificar se a minha mãe pode me ajudar";
  const QUER = "Eu quero sim fazer o curso, é ótimo. Mas não será possível fazer por enquanto";
  const DATA = "Te acionarei a partir do dia 10 de Setembro quando receberei o pagamento. E aí, voltamos a negociar.";

  test("bloqueia os três casos reais do diagnóstico", () => {
    expect(respostaIgnoraOLead(MAE, "Claro, Ana!")).toBe(true);
    expect(respostaIgnoraOLead(QUER, "Tranquilo, Andreia")).toBe(true);
    expect(respostaIgnoraOLead(DATA, "Perfeito, Emerson")).toBe(true);
  });

  test("passa quando a resposta devolve o fato da fala", () => {
    expect(respostaIgnoraOLead(MAE, "Claro. E me diz: se sua mãe topar te ajudar, você já quer começar?")).toBe(false);
    expect(respostaIgnoraOLead(DATA, "Fechado, dia 10 então. Te chamo nesse dia.")).toBe(false);
  });

  test("fala curta do lead não exige eco", () => {
    expect(respostaIgnoraOLead("ok", "boa")).toBe(false);
    expect(respostaIgnoraOLead("sim", "Perfeito!")).toBe(false);
    expect(respostaIgnoraOLead("Anual", "Aqui está o link pra garantir teu acesso")).toBe(false);
  });

  test("resposta longa com conteúdo próprio passa mesmo sem repetir palavra", () => {
    const longa = "Essa sensação de correr atrás e não sair do lugar é o que mais aparece em quem estuda sozinho, e é exatamente o primeiro ponto que a gente organiza no plano que eu monto pra você, com meta diária e revisão.";
    expect(respostaIgnoraOLead(QUER, longa)).toBe(false);
  });

  test("palavras genéricas do funil não contam como eco", () => {
    expect(temEco("Preciso estudar mais para o concurso de perito", "Vamos estudar juntos para o concurso")).toBe(false);
  });

  test("extrai as palavras de conteúdo da fala", () => {
    const p = palavrasDeConteudo("Trabalho 12h por dia e só consigo estudar de madrugada");
    expect(p).toContain("trabalho");
    expect(p).toContain("madrugada");
    expect(p).not.toContain("estudar"); // genérica do funil
  });

  test("a instrução de reescrita cita o que o lead falou", () => {
    const i = instrucaoReescrita(MAE);
    expect(i).toContain("[SISTEMA:");
    expect(i.toLowerCase()).toContain("assertiva");
  });
});
