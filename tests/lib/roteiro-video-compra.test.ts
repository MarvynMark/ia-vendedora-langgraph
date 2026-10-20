import { describe, test, expect } from "bun:test";
import {
  PROMPT_ROTEIRO_VIDEO,
  montarEntradaVideo,
  montarMensagemRoteiroVideo,
  separarSaidaIA,
} from "../../src/lib/roteiro-video-compra.ts";
import { AUTORIDADE_WALKER, BORDAO_WALKER } from "../../src/lib/diagnostico-inicial.ts";

const APLICACAO = {
  concurso: "PCDF perito criminal",
  formacao: "Odontologia",
  nivel: null,
  jaFoiAluno: "Não",
  maiorDificuldade: "Muitas matérias",
  motivo: "Um direcionamento de estudos de maneira personalizada",
  expectativa: "Aprovação na PCDF",
  oQueFaltou: "  ",
  diferencaComMentor: null,
  criadoEm: new Date("2026-10-09T19:34:00Z"),
};

describe("montarEntradaVideo", () => {
  test("com aplicação: só os campos preenchidos, na ordem", () => {
    expect(montarEntradaVideo({ nome: "Yan de Souza Lima", plano: "6 meses", aplicacao: APLICACAO })).toBe(
      "Nome: Yan de Souza Lima\nPlano comprado: 6 meses\n"
      + "Concurso desejado: PCDF perito criminal\nFormação: Odontologia\nJá foi aluno da Vestigium: Não\n"
      + "Maior dificuldade: Muitas matérias\nO que te fez dar o primeiro passo (motivo): Um direcionamento de estudos de maneira personalizada\n"
      + "O que espera da mentoria: Aprovação na PCDF",
    );
  });

  test("sem aplicação: avisa a IA para usar a versão curta", () => {
    expect(montarEntradaVideo({ nome: "Ana", plano: "Anual", aplicacao: null })).toBe("Nome: Ana\nPlano comprado: Anual\nSEM APLICAÇÃO");
  });
});

describe("prompt", () => {
  test("carrega os textos fixos do Walker", () => {
    expect(PROMPT_ROTEIRO_VIDEO).toContain(AUTORIDADE_WALKER);
    expect(PROMPT_ROTEIRO_VIDEO).toContain(BORDAO_WALKER);
  });
});

describe("saída", () => {
  test("separa a linha do concurso e junta o roteiro num parágrafo", () => {
    expect(separarSaidaIA("CONCURSO: PCI-SC\n\nAna, seja bem-vinda.\nBora.")).toEqual({
      concurso: "PCI-SC",
      roteiro: "Ana, seja bem-vinda. Bora.",
    });
    expect(separarSaidaIA("Ana, seja bem-vinda.").concurso).toBe("NÃO INFORMADO");
  });

  test("cabeçalho com a data da aplicação", () => {
    const msg = montarMensagemRoteiroVideo({
      nome: "Yan De Souza Lima", plano: "6 meses", concurso: "PCDF", telefone: "+5561999980737",
      roteiro: "Yan, bora.", aplicacaoEm: APLICACAO.criadoEm,
    });
    expect(msg).toBe(
      "🎥 Roteiro de vídeo de boas-vindas: Yan De Souza Lima\nPlano: 6 meses\nConcurso: PCDF\n"
      + "WhatsApp do aluno: (61) 99998-0737\nDuração estimada: 0min01s\nBase: aplicação da mentoria de 09/10/2026\n\nYan, bora.",
    );
  });

  test("sem aplicação, o cabeçalho avisa que o roteiro é genérico", () => {
    const msg = montarMensagemRoteiroVideo({ nome: "Ana", plano: "Anual", concurso: "NÃO INFORMADO", roteiro: "Ana, bora.", aplicacaoEm: null });
    expect(msg).toContain("⚠️ Sem aplicação da mentoria: roteiro genérico");
    expect(msg).toContain("WhatsApp do aluno: (não informado)");
  });
});

describe("respostas obrigatórias", () => {
  test("o prompt exige primeiro passo, dificuldade e expectativa, cada uma no seu trecho", () => {
    expect(PROMPT_ROTEIRO_VIDEO).toContain('"O que te fez dar o primeiro passo (motivo)" → item 2');
    expect(PROMPT_ROTEIRO_VIDEO).toContain('"Maior dificuldade" → item 3');
    expect(PROMPT_ROTEIRO_VIDEO).toContain('"O que espera da mentoria" → item 4');
  });

  test("os rótulos da entrada batem com os que o prompt cita", () => {
    const entrada = montarEntradaVideo({ nome: "Yan", plano: "6 meses", aplicacao: APLICACAO });
    expect(entrada).toContain("O que te fez dar o primeiro passo (motivo): ");
    expect(entrada).toContain("Maior dificuldade: ");
    expect(entrada).toContain("O que espera da mentoria: ");
  });
});
