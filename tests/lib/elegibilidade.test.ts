import { describe, test, expect } from "bun:test";
import { negaElegibilidadePorGraduacao, RESPOSTA_ELEGIBILIDADE } from "../../src/lib/elegibilidade.ts";

describe("negaElegibilidadePorGraduacao", () => {
  test("as duas frases exatas da conv 7197", () => {
    expect(negaElegibilidadePorGraduacao(
      "Para prestar o concurso de Perito, você precisa ter a graduação completa, conforme o que está previsto no edital.",
    )).toBe(true);
    expect(negaElegibilidadePorGraduacao(
      "Como você está no segundo semestre, ainda não seria elegível para prestar o concurso.",
    )).toBe(true);
  });

  test("variações da mesma inverdade", () => {
    expect(negaElegibilidadePorGraduacao("Você não pode prestar enquanto não tiver a graduação.")).toBe(true);
    expect(negaElegibilidadePorGraduacao("Infelizmente não é elegível, porque ainda está cursando a faculdade.")).toBe(true);
    expect(negaElegibilidadePorGraduacao("Precisa estar formado para prestar o concurso.")).toBe(true);
    expect(negaElegibilidadePorGraduacao("Pra fazer a prova é preciso ter o diploma concluído.")).toBe(true);
  });

  test("a VERDADE passa — é o que a IA deve dizer", () => {
    expect(negaElegibilidadePorGraduacao(
      "Você pode prestar mesmo cursando: o diploma só é exigido na posse.",
    )).toBe(false);
    expect(negaElegibilidadePorGraduacao(
      "Na posse você vai precisar apresentar o diploma da graduação prevista no edital.",
    )).toBe(false);
    expect(negaElegibilidadePorGraduacao(
      "Quais graduações o edital aceita muda de estado pra estado, a gente confere no edital do teu concurso.",
    )).toBe(false);
    expect(negaElegibilidadePorGraduacao(RESPOSTA_ELEGIBILIDADE)).toBe(false);
  });

  test("recusa por outro motivo, sem contexto de graduação, não é bloqueada", () => {
    expect(negaElegibilidadePorGraduacao("Não pode fazer o pagamento em dois cartões.")).toBe(false);
    expect(negaElegibilidadePorGraduacao("Não é elegível para o desconto de ex-aluno.")).toBe(false);
    expect(negaElegibilidadePorGraduacao("")).toBe(false);
  });
});
