import { describe, test, expect } from "bun:test";
import {
  extrairRespostas,
  nomeDoAluno,
  whatsappDoAluno,
  duracaoEstimada,
  separarBolhas,
  montarCabecalhoMensagemDim,
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

  test("Respondi: usa respondent.answers e ignora raw_answers", () => {
    const r = extrairRespostas({
      form: { form_name: "Diagnóstico Inicial – Vestigium", form_id: "Fzj4Z08x" },
      respondent: {
        status: "completed",
        answers: { "Nome completo": "Ana Souza", "WhatsApp com DDD, só números": "55 62981384100" },
        raw_answers: [
          { question: { question_title: "Nome completo", question_id: "x7l", question_type: "name" }, answer: "ana souza" },
        ],
      },
    });
    expect(r).toEqual([
      { pergunta: "Nome completo", resposta: "Ana Souza" },
      { pergunta: "WhatsApp com DDD, só números", resposta: "55 62981384100" },
    ]);
    expect(whatsappDoAluno(r)).toBe("+5562981384100");
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

  test("separa o concurso e as 3 bolhas pelo separador ---", () => {
    expect(separarBolhas("CONCURSO: PCI-SC\nAna, seja bem-vinda!\n---\nSua formação...\n\nSegundo parágrafo.\n---\nBora! 🚀")).toEqual({
      concurso: "PCI-SC",
      bolhas: ["Ana, seja bem-vinda!", "Sua formação...\n\nSegundo parágrafo.", "Bora! 🚀"],
    });
  });

  test("sem separador, cai nos parágrafos; sem concurso, NÃO INFORMADO", () => {
    expect(separarBolhas("Ana, bem-vinda.\n\nDiagnóstico.\n\nBora.")).toEqual({
      concurso: "NÃO INFORMADO",
      bolhas: ["Ana, bem-vinda.", "Diagnóstico.", "Bora."],
    });
  });

  test("nunca passa de 3 bolhas: o excedente vai para a última", () => {
    const { bolhas } = separarBolhas("CONCURSO: PF\nUm\n---\nDois\n---\nTrês\n---\nQuatro");
    expect(bolhas).toEqual(["Um", "Dois", "Três\n\nQuatro"]);
  });

  test("cabeçalho para o Walker", () => {
    expect(montarCabecalhoMensagemDim({ nome: "Ana Souza", concurso: "PF", whatsapp: null })).toBe(
      "📝 Mensagem do Diagnóstico Inicial: Ana Souza\nConcurso prioritário: PF\nWhatsApp do aluno: não informado\n\nRevise e envie ao aluno as 3 mensagens abaixo, na ordem.",
    );
  });
});
