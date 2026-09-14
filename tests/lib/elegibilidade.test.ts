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

// ── Trava em código do gate de nível superior (conv 7297, 14/09/2026) ─────────────────────────
import {
  formacaoDoLead,
  leadDeclarouSuperior,
  motivoBloqueioSessao,
  convidaParaSessao,
  RESPOSTA_INELEGIVEL,
} from "../../src/lib/elegibilidade.ts";

describe("motivoBloqueioSessao", () => {
  test("Amanda: 'Ensino médio' no formulário e nada na conversa — barrada", () => {
    expect(motivoBloqueioSessao("Ensino médio", ["Sim", "Valor"])).toBe("sem_superior");
  });

  test("formação não aceita como única — barrada", () => {
    expect(motivoBloqueioSessao("Investigação forense e perícia criminal", ["Boa noite"])).toBe("formacao_nao_aceita");
  });

  test("mas se o lead disser na conversa que está cursando, o formulário perde", () => {
    expect(motivoBloqueioSessao("Ensino médio", ["na verdade tô cursando o 2º semestre de biomedicina"])).toBeNull();
    expect(motivoBloqueioSessao("Ensino médio", ["sou formada em farmácia"])).toBeNull();
  });

  test("formação declarada passa sem olhar a conversa", () => {
    expect(motivoBloqueioSessao("Odontologia", [])).toBeNull();
    expect(motivoBloqueioSessao("", [])).toBeNull();
  });
});

describe("leadDeclarouSuperior", () => {
  test("reconhece cursando e formado, ignora conversa comum", () => {
    expect(leadDeclarouSuperior(["Estou no 5 semestre"])).toBe(true);
    expect(leadDeclarouSuperior(["me formei em direito ano passado"])).toBe(true);
    expect(leadDeclarouSuperior(["Manhã", "Valor", "Ok obrigada"])).toBe(false);
  });
});

describe("formacaoDoLead", () => {
  test("prefere o atributo do contato; cai no formulário se não houver", () => {
    expect(formacaoDoLead({ qual_formacao: "Ensino médio" }, "Formação: Direito")).toBe("Ensino médio");
    expect(formacaoDoLead({}, "Concurso: Sp | Formação: Ensino médio | Maior dificuldade: Nenhum")).toBe("Ensino médio");
    expect(formacaoDoLead(null, null)).toBe("");
  });
});

describe("convidaParaSessao", () => {
  test("pega o convite que saiu para a Amanda", () => {
    expect(convidaParaSessao("Na conversa, eu te mostro o que faz sentido pro teu caso. Prefere marcar de manhã, à tarde ou à noite?")).toBe(true);
    expect(convidaParaSessao("Consigo te encaixar segunda às 9h ou terça às 9h.")).toBe(true);
    expect(convidaParaSessao("Fechado! Nossa conversa está marcada para segunda (14/09) às 9h.")).toBe(true);
  });

  test("não pega resposta honesta sem convite", () => {
    expect(convidaParaSessao(RESPOSTA_INELEGIVEL.sem_superior)).toBe(false);
    expect(convidaParaSessao(RESPOSTA_INELEGIVEL.formacao_nao_aceita)).toBe(false);
    expect(convidaParaSessao("Você pode prestar mesmo cursando: o diploma só é exigido na posse.")).toBe(false);
  });
});

describe("RESPOSTA_INELEGIVEL", () => {
  test("sem travessão e no máximo três frases-bolha", () => {
    for (const texto of Object.values(RESPOSTA_INELEGIVEL)) {
      expect(texto).not.toContain("—");
      expect(texto.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(4);
    }
  });
});
