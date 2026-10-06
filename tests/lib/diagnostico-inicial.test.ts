import { describe, test, expect } from "bun:test";
import {
  extrairRespostas,
  nomeDoAluno,
  whatsappDoAluno,
  duracaoEstimada,
  separarSaidaIA,
  montarMensagemRoteiro,
} from "../../src/lib/diagnostico-inicial.ts";

describe("extrairRespostas", () => {
  test("formato plano pergunta → resposta", () => {
    const r = extrairRespostas({ "Nome completo": "Ana Souza", "Qual seu WhatsApp?": "(62) 98138-4100" });
    expect(r).toEqual([
      { pergunta: "Nome completo", resposta: "Ana Souza" },
      { pergunta: "Qual seu WhatsApp?", resposta: "(62) 98138-4100" },
    ]);
  });

  test("respostas aninhadas e múltipla escolha viram texto", () => {
    const r = extrairRespostas({
      form: { form_id: "abc", form_name: "Diagnóstico" },
      respondent: { respondent_id: "x1", answers: { "Nome completo": "Ana", "Turnos disponíveis": ["Manhã", "Noite"] } },
    });
    expect(r).toEqual([
      { pergunta: "Nome completo", resposta: "Ana" },
      { pergunta: "Turnos disponíveis", resposta: "Manhã, Noite" },
    ]);
  });

  test("lista de itens question/answer, pulando os vazios", () => {
    const r = extrairRespostas({
      answers: [
        { question: "Nome completo", answer: "Ana" },
        { question: "Formação", answer: "" },
        { title: "Matérias", value: ["Química", "Física"] },
      ],
    });
    expect(r).toEqual([
      { pergunta: "Nome completo", resposta: "Ana" },
      { pergunta: "Matérias", resposta: "Química, Física" },
    ]);
  });
});

describe("nome e WhatsApp", () => {
  const respostas = [
    { pergunta: "Nome completo", resposta: "Gusthavo Abreu Batista" },
    { pergunta: "WhatsApp", resposta: "(62) 98138-4100" },
  ];

  test("acha pelos títulos das perguntas", () => {
    expect(nomeDoAluno(respostas)).toBe("Gusthavo Abreu Batista");
    expect(whatsappDoAluno(respostas)).toBe("+5562981384100");
  });

  test("não duplica o 55 e recusa número curto demais", () => {
    expect(whatsappDoAluno([{ pergunta: "WhatsApp", resposta: "+55 62 98138-4100" }])).toBe("+5562981384100");
    expect(whatsappDoAluno([{ pergunta: "WhatsApp", resposta: "123" }])).toBeNull();
  });
});

describe("saída", () => {
  test("duração a 2,6 palavras por segundo", () => {
    expect(duracaoEstimada(Array(166).fill("palavra").join(" "))).toBe("1min04s");
    expect(duracaoEstimada("uma duas")).toBe("0min01s");
  });

  test("separa a linha do concurso e junta o roteiro num parágrafo", () => {
    expect(separarSaidaIA("CONCURSO: PCI-SC\n\nAna, seja bem-vinda.\nBora.")).toEqual({
      concurso: "PCI-SC",
      roteiro: "Ana, seja bem-vinda. Bora.",
    });
    expect(separarSaidaIA("Ana, seja bem-vinda.").concurso).toBe("NÃO INFORMADO");
  });

  test("cabeçalho no formato do exemplo", () => {
    const msg = montarMensagemRoteiro({ nome: "Ana Souza", concurso: "PF", whatsapp: null, roteiro: "Ana, bora." });
    expect(msg).toBe(
      "Roteiro de boas-vindas: Ana Souza\nConcurso prioritário: PF\nWhatsApp do aluno: não informado\nDuração estimada: 0min01s\n\nAna, bora.",
    );
  });
});
