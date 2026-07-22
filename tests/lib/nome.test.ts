import { describe, test, expect } from "bun:test";
import { primeiroNomeSaudacao, substituirNome, substituirCampos } from "../../src/lib/nome.ts";

describe("primeiroNomeSaudacao", () => {
  test("nome normal → primeiro nome", () => {
    expect(primeiroNomeSaudacao("Maria Silva")).toBe("Maria");
    expect(primeiroNomeSaudacao("João")).toBe("João");
  });

  test("telefone/wa_id → fallback (não usa o número como nome)", () => {
    expect(primeiroNomeSaudacao("5518997537716")).toBe("");
    expect(primeiroNomeSaudacao("+55 18 99753-7716")).toBe("");
    expect(primeiroNomeSaudacao("(18) 99753-7716")).toBe("");
  });

  test("vazio/nulo → fallback", () => {
    expect(primeiroNomeSaudacao("")).toBe("");
    expect(primeiroNomeSaudacao(null)).toBe("");
    expect(primeiroNomeSaudacao(undefined)).toBe("");
  });

  test("fallback customizado (boas-vindas)", () => {
    expect(primeiroNomeSaudacao("5518997537716", "aluno(a)")).toBe("aluno(a)");
    expect(primeiroNomeSaudacao("", "aluno(a)")).toBe("aluno(a)");
    expect(primeiroNomeSaudacao("Ana", "aluno(a)")).toBe("Ana");
  });
});

describe("substituirNome", () => {
  test("com nome válido substitui [Nome]", () => {
    expect(substituirNome("Oi [Nome], imagino que a rotina tá corrida.", "Maria Silva"))
      .toBe("Oi Maria, imagino que a rotina tá corrida.");
  });

  test("sem nome válido remove [Nome] e a pontuação órfã", () => {
    expect(substituirNome("Oi [Nome], imagino que a rotina tá corrida.", "5518997537716"))
      .toBe("Oi, imagino que a rotina tá corrida.");
    expect(substituirNome("Oi [Nome], imagino que a rotina tá corrida.", ""))
      .toBe("Oi, imagino que a rotina tá corrida.");
    expect(substituirNome("Olá [Nome]! Aqui é o Perito Walker.", "5518997537716"))
      .toBe("Olá! Aqui é o Perito Walker.");
  });

  test("texto sem [Nome] fica inalterado", () => {
    const t = "Como você não respondeu, vou encerrar seu atendimento.";
    expect(substituirNome(t, "Maria")).toBe(t);
    expect(substituirNome(t, "5518997537716")).toBe(t);
  });

  test("preserva quebras de linha do template", () => {
    expect(substituirNome("Oi [Nome], tudo bem?\n\nSegue o link.", "5518997537716"))
      .toBe("Oi, tudo bem?\n\nSegue o link.");
  });
});

describe("substituirCampos (personalização de follow-up)", () => {
  const T = "Oi [Nome], imagino que a rotina tá corrida{{, ainda mais pra quem quer a aprovação em [concurso]}}.";

  test("concurso presente → injeta o segmento opcional", () => {
    expect(substituirCampos(T, { nome: "Maria", concurso: "PCDF" }))
      .toBe("Oi Maria, imagino que a rotina tá corrida, ainda mais pra quem quer a aprovação em PCDF.");
  });

  test("concurso ausente → remove o segmento inteiro, sem [concurso] cru", () => {
    const out = substituirCampos(T, { nome: "Maria", concurso: null });
    expect(out).toBe("Oi Maria, imagino que a rotina tá corrida.");
    expect(out).not.toContain("[concurso]");
    expect(out).not.toContain("[[");
  });

  test("nome inválido (telefone) + concurso ausente degrada limpo", () => {
    expect(substituirCampos(T, { nome: "5518997537716", concurso: "" }))
      .toBe("Oi, imagino que a rotina tá corrida.");
  });

  test("dificuldade opcional é injetada em minúscula", () => {
    const t = "Sei que {{organizar [dificuldade] }}é o que mais trava.";
    expect(substituirCampos(t, { nome: null, dificuldade: "Organização de tempo" }))
      .toBe("Sei que organizar organização de tempo é o que mais trava.");
    expect(substituirCampos(t, { nome: null, dificuldade: null }))
      .toBe("Sei que é o que mais trava.");
  });
});
