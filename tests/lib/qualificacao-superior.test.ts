import { describe, test, expect } from "bun:test";
import { qualificacaoSuperior, podeIrParaSessao, formacaoNaoAceita, motivoInelegivel } from "../../src/lib/elegibilidade.ts";

describe("qualificacaoSuperior", () => {
  test("nome de curso é graduação declarada", () => {
    expect(qualificacaoSuperior("Biomedicina")).toBe("tem");
    expect(qualificacaoSuperior("Direito")).toBe("tem");
    expect(qualificacaoSuperior("Enfermagem")).toBe("tem");
  });

  test("cursando é CURSANDO — quem tem mais tempo de preparo pela frente", () => {
    expect(qualificacaoSuperior("Cursando Direito")).toBe("cursando");
    expect(qualificacaoSuperior("estou no 2º semestre de Biomedicina")).toBe("cursando");
    expect(qualificacaoSuperior("segundo período de Farmácia")).toBe("cursando");
    expect(qualificacaoSuperior("graduação incompleta")).toBe("cursando");
    expect(qualificacaoSuperior("tô terminando a faculdade")).toBe("cursando");
  });

  test("cursando vence a negação quando as duas aparecem (regressão da conv 7197)", () => {
    expect(qualificacaoSuperior("não tenho ainda, tô cursando o 3º período")).toBe("cursando");
    expect(qualificacaoSuperior("ainda não concluí, estou cursando")).toBe("cursando");
  });

  test("sem superior é a única resposta que barra", () => {
    expect(qualificacaoSuperior("não tenho")).toBe("nao");
    expect(qualificacaoSuperior("só o ensino médio")).toBe("nao");
    expect(qualificacaoSuperior("Ensino Médio completo")).toBe("nao");
    expect(qualificacaoSuperior("nenhuma")).toBe("nao");
  });

  test("vazio e lixo ficam indefinidos", () => {
    expect(qualificacaoSuperior("")).toBeNull();
    expect(qualificacaoSuperior(null)).toBeNull();
    expect(qualificacaoSuperior("-")).toBeNull();
    expect(qualificacaoSuperior("??")).toBeNull();
  });
});

describe("podeIrParaSessao — o default é QUALIFICAR", () => {
  test("passa quem tem, quem cursa e quem não deu para saber", () => {
    expect(podeIrParaSessao("Biomedicina")).toBe(true);
    expect(podeIrParaSessao("cursando o 2º semestre")).toBe(true);
    expect(podeIrParaSessao("")).toBe(true);
    expect(podeIrParaSessao(null)).toBe(true);
    expect(podeIrParaSessao("??")).toBe(true);
  });

  test("barra só a declaração explícita de que não tem e não cursa", () => {
    expect(podeIrParaSessao("não tenho")).toBe(false);
    expect(podeIrParaSessao("só o ensino médio")).toBe(false);
  });
});

describe("formacaoNaoAceita — Investigação Forense e Perícia Criminal não vale como graduação (11/09/2026)", () => {
  test("barra quem só tem essa formação, em qualquer grafia", () => {
    for (const f of [
      "Investigação Forense e Perícia Criminal",
      "investigacao forense",
      "Tecnólogo em Perícia Criminal",
      "cursando investigação forense e perícia criminal",
      "Formada em Investigação Forense e Perícia Criminal, completo",
    ]) {
      expect(formacaoNaoAceita(f)).toBe(true);
      expect(podeIrParaSessao(f)).toBe(false);
      expect(motivoInelegivel(f)).toBe("formacao_nao_aceita");
    }
  });

  test("passa quem tem OUTRA graduação junto — falso negativo custa venda", () => {
    for (const f of [
      "Biomedicina e tecnólogo em Investigação Forense",
      "Direito, e também perícia criminal",
      "Farmácia (cursando investigação forense)",
    ]) {
      expect(formacaoNaoAceita(f)).toBe(false);
      expect(podeIrParaSessao(f)).toBe(true);
    }
  });

  test("não confunde interesse com formação: formação normal passa", () => {
    for (const f of ["Biomedicina", "Enfermagem", "Química", "cursando Direito", ""]) {
      expect(formacaoNaoAceita(f)).toBe(false);
    }
  });

  test("sem superior continua com o motivo antigo", () => {
    expect(motivoInelegivel("só o ensino médio")).toBe("sem_superior");
    expect(motivoInelegivel("Biomedicina")).toBeNull();
  });
});
