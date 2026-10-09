import { describe, test, expect } from "bun:test";
import {
  montarLinhaPlanilha,
  carimboBrasilia,
  comoTexto,
  COLUNA_CONCURSO_IA,
  COLUNA_ROTEIRO_IA,
  ORIGEM_RESPONDI,
} from "../../src/lib/planilha-alunos.ts";
import { linhaDoIntervalo } from "../../src/services/google-sheets.ts";

// Cabeçalho real da aba "Respostas ao formulário 1" (09/10/2026), com o "Coluna 28" que sobrou.
const CABECALHO_FORMS = [
  "Carimbo de data/hora", "Nome completo: ", "Idade:", "Data de nascimento:", "CPF:",
  "Telefone para contato:", "E-mail:", "É casado(a), solteiro(a)? Tem filho(s)?",
  "Já estudou para concurso público? Se sim, para qual(quais)?", "Quantos dias da semana você estuda?",
  "Quantas horas por dia você estuda?", "Há quanto tempo você estuda para concurso público?",
  "Já foi aprovado em algum concurso? Se sim, qual(quais)?", "Qual nível de concurseiro você se considera?",
  "Qual é a sua área de formação?", "Qual é o seu concurso de interesse?",
  "Para qual plano você deseja ser matriculado na mentoria e ter o planejamento individualizado?",
  "Já fez alguma mentoria para concurso público antes? Se sim, qual?",
  "Qual é o seu objetivo com a Mentoria Vestigium?",
  "Quais são as suas maiores dificuldades em relação ao planejamento e organização de estudos?",
  "Quais são as matérias que você tem mais afinidade?", "Quais são as matérias que você tem mais dificuldade?",
  "O que você espera do mentor que irá te acompanhar?", "Você trabalha ou dedica período integral aos estudos?",
  "Caso você trabalhe, quantas horas por dia você trabalha?", "Como você lida com frustrações?",
  "Quais são os maiores desafios que você enfrenta atualmente nos seus estudos?",
  "O planejamento de estudos de escolha é para Perito Criminal ou Médico Legista?", "Coluna 28",
];

// Títulos reais do "Diagnóstico Inicial – Vestigium" no Respondi (form Fzj4Z08x), 09/10/2026.
const RESPOSTAS = [
  ["Nome completo", "Ana Souza"],
  ["Idade", "29"],
  ["WhatsApp com DDD, só números", "+55 62 98138-4100"],
  ["E-mail", "ana@exemplo.com"],
  ["Qual sua formação?", "Farmácia"],
  ["Quais concursos pensa em prestar?", "PCI-SC, PCDF"],
  ["Qual concurso é seu FOCO hoje?", "PCI-SC"],
  ["O que mais atrapalha sua constância nos estudos atualmente?", "Falta de tempo"],
  ["Quais disciplinas tem mais facilidade?", "Química"],
  ["Quais disciplinas tem mais dificuldade?", "Português"],
  ["Há quanto tempo estuda para concurso?", "1 a 2 anos"],
  ["Como você REVISA o conteúdo que já estudou?", "Releio o PDF"],
  ["Seu planejamento é para qual cargo?", "Perito Criminal"],
  ["Na última semana, em quantos dias você estudou de fato?", "3 a 4 dias"],
  ["Por qual razão, sonho, motivo de fato você quer ser aprovado ou aprovada?", "Minha família"],
  ["O que você mais quer resolver com a mentoria?", "Ter constância e disciplina"],
  ["Já foi aprovado em algum concurso? Se sim, qual?", "Não"],
  ["Já fez outra mentoria para concurso? Se sim, qual e o que achou?", "Não"],
  ["Como organiza seus estudos hoje?", "Sem cronograma"],
  ["Qual é a sua situação familiar hoje?", "Solteiro(a), com filhos"],
  ["Você trabalha atualmente? Qual a sua carga horária semanal?", "Sim, 40h"],
  ["Tem filhos ou outras responsabilidades familiares que consomem sua energia mental?", "Um filho"],
  ["TEMPO DISPONÍVEL PARA ESTUDAR (SEGUNDA-FEIRA)", "2 horas"],
  ["O que você mais espera do seu mentor?", "Me cobrar quando eu sair do ritmo"],
].map(([pergunta, resposta]) => ({ pergunta: pergunta!, resposta: resposta! }));

const RECEBIDO = new Date("2026-10-09T17:03:27Z"); // 14:03:27 em Brasília

function montar(cabecalho = CABECALHO_FORMS, extras: { concurso?: string | null; roteiro?: string | null } = {}) {
  return montarLinhaPlanilha({
    cabecalho, respostas: RESPOSTAS, recebidoEm: RECEBIDO,
    concurso: extras.concurso ?? "PCI-SC", roteiro: extras.roteiro ?? "Ana, seja bem-vinda.",
  });
}

function valor(r: ReturnType<typeof montar>, coluna: string): string | undefined {
  return r.linha[r.cabecalho.indexOf(coluna)];
}

describe("montarLinhaPlanilha", () => {
  test("respostas com equivalente vão para as colunas antigas do Forms", () => {
    const r = montar();
    expect(r.linha[0]).toBe("09/10/2026 14:03:27");
    expect(valor(r, "Nome completo: ")).toBe("Ana Souza");
    expect(valor(r, "Idade:")).toBe("29");
    expect(valor(r, "Telefone para contato:")).toBe("'+55 62 98138-4100");
    expect(valor(r, "E-mail:")).toBe("ana@exemplo.com");
    expect(valor(r, "Qual é a sua área de formação?")).toBe("Farmácia");
    expect(valor(r, "Qual é o seu concurso de interesse?")).toBe("PCI-SC, PCDF");
    expect(valor(r, "Para qual plano você deseja ser matriculado na mentoria e ter o planejamento individualizado?")).toBe("PCI-SC");
    expect(valor(r, "Quais são os maiores desafios que você enfrenta atualmente nos seus estudos?")).toBe("Falta de tempo");
    expect(valor(r, "Quais são as matérias que você tem mais afinidade?")).toBe("Química");
    expect(valor(r, "Quais são as matérias que você tem mais dificuldade?")).toBe("Português");
    expect(valor(r, "Há quanto tempo você estuda para concurso público?")).toBe("1 a 2 anos");
    expect(valor(r, "Já foi aprovado em algum concurso? Se sim, qual(quais)?")).toBe("Não");
    expect(valor(r, "Você trabalha ou dedica período integral aos estudos?")).toBe("Sim, 40h");
    // As perguntas trazidas do Forms em 09/10/2026.
    expect(valor(r, "O planejamento de estudos de escolha é para Perito Criminal ou Médico Legista?")).toBe("Perito Criminal");
    expect(valor(r, "Quantos dias da semana você estuda?")).toBe("3 a 4 dias");
    expect(valor(r, "Qual é o seu objetivo com a Mentoria Vestigium?")).toBe("Ter constância e disciplina");
    expect(valor(r, "Já fez alguma mentoria para concurso público antes? Se sim, qual?")).toBe("Não");
    expect(valor(r, "É casado(a), solteiro(a)? Tem filho(s)?")).toBe("Solteiro(a), com filhos");
    expect(valor(r, "O que você espera do mentor que irá te acompanhar?")).toBe("Me cobrar quando eu sair do ritmo");
    // Sem equivalente no Respondi: fica em branco.
    expect(valor(r, "CPF:")).toBe("");
  });

  test("perguntas sem equivalente ganham coluna nova no lugar do 'Coluna 28'", () => {
    const r = montar();
    expect(r.cabecalhoMudou).toBe(true);
    expect(r.cabecalho.slice(0, 28)).toEqual(CABECALHO_FORMS.slice(0, 28));
    expect(r.cabecalho.slice(28)).toEqual([
      "Como você REVISA o conteúdo que já estudou?",
      "Por qual razão, sonho, motivo de fato você quer ser aprovado ou aprovada?",
      "Como organiza seus estudos hoje?",
      "Tem filhos ou outras responsabilidades familiares que consomem sua energia mental?",
      "TEMPO DISPONÍVEL PARA ESTUDAR (SEGUNDA-FEIRA)",
      "Origem",
      COLUNA_CONCURSO_IA,
      COLUNA_ROTEIRO_IA,
    ]);
    expect(valor(r, "Como organiza seus estudos hoje?")).toBe("Sem cronograma");
    expect(valor(r, "Origem")).toBe(ORIGEM_RESPONDI);
    expect(valor(r, COLUNA_ROTEIRO_IA)).toBe("Ana, seja bem-vinda.");
    expect(r.linha).toHaveLength(r.cabecalho.length);
  });

  test("na segunda resposta reaproveita as colunas criadas e não mexe no cabeçalho", () => {
    const primeira = montar();
    const segunda = montar(primeira.cabecalho);
    expect(segunda.cabecalhoMudou).toBe(false);
    expect(segunda.cabecalho).toEqual(primeira.cabecalho);
    expect(segunda.linha).toEqual(primeira.linha);
  });

  test("sem roteiro (IA falhou) grava as respostas e deixa as colunas da IA de fora", () => {
    const r = montarLinhaPlanilha({
      cabecalho: CABECALHO_FORMS, respostas: RESPOSTAS, recebidoEm: RECEBIDO, concurso: null, roteiro: null,
    });
    expect(r.cabecalho).not.toContain(COLUNA_ROTEIRO_IA);
    expect(valor(r, "Nome completo: ")).toBe("Ana Souza");
  });

  test("duas perguntas para a mesma coluna antiga: a segunda ganha a sua", () => {
    const r = montarLinhaPlanilha({
      cabecalho: CABECALHO_FORMS,
      respostas: [
        { pergunta: "Nome completo", resposta: "Ana" },
        { pergunta: "Nome social", resposta: "Aninha" },
      ],
      recebidoEm: RECEBIDO, concurso: null, roteiro: null,
    });
    expect(valor(r, "Nome completo: ")).toBe("Ana");
    expect(valor(r, "Nome social")).toBe("Aninha");
  });
});

describe("auxiliares", () => {
  test("carimbo no horário de Brasília, formato do Forms", () => {
    expect(carimboBrasilia(new Date("2026-01-05T03:04:05Z"))).toBe("05/01/2026 00:04:05");
  });

  test("resposta que pareceria fórmula vira texto", () => {
    expect(comoTexto("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(comoTexto("-")).toBe("'-");
    expect(comoTexto("Química")).toBe("Química");
  });
});

describe("linhaDoIntervalo", () => {
  test("lê a linha do intervalo devolvido pelo append", () => {
    expect(linhaDoIntervalo("'Respostas ao formulário 1'!A906:BD906")).toBe(906);
    expect(linhaDoIntervalo(undefined)).toBeNull();
  });
});
