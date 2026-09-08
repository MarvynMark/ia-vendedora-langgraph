import { describe, test, expect } from "bun:test";
import { PONTE_PITCH_HUMANO, montarAlertaPitch, montarNotaPitch, iaEstaPausada } from "../../src/lib/pausa-pitch.ts";
import { temPrecoDePlano, temLinkDePagamento } from "../../src/lib/planos.ts";

// A ponte é a última coisa que o lead ouve da IA antes de o atendente entrar. Se ela quebrar
// alguma das regras abaixo, a pausa vira um problema pior que o pitch da IA.
describe("PONTE_PITCH_HUMANO", () => {
  test("não cita preço nem link — senão o pitch já teria começado", () => {
    expect(temPrecoDePlano(PONTE_PITCH_HUMANO)).toBe(false);
    expect(temLinkDePagamento(PONTE_PITCH_HUMANO)).toBe(false);
  });

  test("não revela a escalação (escalação é silenciosa)", () => {
    expect(PONTE_PITCH_HUMANO).not.toMatch(/atendente|especialista|equipe|humano|transferir|encaminhar|consultor/i);
  });

  test("não promete prazo — quem responde é uma pessoa, e pode ser só amanhã", () => {
    expect(PONTE_PITCH_HUMANO).not.toMatch(/\b(minutos?|instante|já volto|agora mesmo|rapidinho|segundos?)\b/i);
  });

  test("não usa 'faz sentido?', proibido no roteiro inteiro", () => {
    expect(PONTE_PITCH_HUMANO.toLowerCase()).not.toContain("faz sentido");
  });

  test("é curta: cada frase vira uma bolha no WhatsApp", () => {
    const frases = PONTE_PITCH_HUMANO.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(frases.length).toBeLessThanOrEqual(3);
  });
});

describe("montarAlertaPitch", () => {
  const base = {
    nome: "Joel Soria",
    telefone: "+5569984090485",
    fala: "pode me mostrar os planos sim",
    link: "https://chat.stkd.site/app/accounts/1/conversations/6948",
  };

  test("deixa claro que é pra assumir, e que a IA não volta a falar", () => {
    const a = montarAlertaPitch(base);
    expect(a).toContain("PITCH");
    expect(a).toContain("Joel Soria");
    expect(a).toContain("+5569984090485");
    expect(a).toContain("/conversations/6948");
    expect(a).toMatch(/pausada/i);
  });

  test("leva o contexto da qualificação quando existe", () => {
    const a = montarAlertaPitch({ ...base, concurso: "PCDF", material: "sem material" });
    expect(a).toContain("PCDF");
    expect(a).toContain("sem material");
  });

  test("omite as linhas de contexto quando não há", () => {
    const a = montarAlertaPitch(base);
    expect(a).not.toContain("*Concurso*");
    expect(a).not.toContain("*Material*");
  });

  test("limpa a marcação de áudio e aguenta lead sem nome", () => {
    const a = montarAlertaPitch({
      ...base,
      nome: "",
      fala: "<mensagem-de-audio>quero ver os valores</mensagem-de-audio>",
    });
    expect(a).toContain("(sem nome)");
    expect(a).not.toContain("mensagem-de-audio");
    expect(a).toContain("quero ver os valores");
  });
});

describe("montarNotaPitch", () => {
  test("explica pra quem abre a conversa por que a IA parou", () => {
    const nota = montarNotaPitch("quero ver os planos");
    expect(nota).toMatch(/pausado/i);
    expect(nota).toContain("quero ver os planos");
    expect(nota).toMatch(/pessoa/i);
  });
});

// O follow-up é disparado pelo Kanban e NÃO passava pela checagem de agente-on que o webhook do
// Chatwoot já fazia: uma conversa escalada, ou pausada no pitch, seguia recebendo toque automático
// por cima do atendente que tinha assumido. Esta é a regra que os dois pontos passam a usar.
describe("iaEstaPausada", () => {
  test("com agente-on, a IA está ativa", () => {
    expect(iaEstaPausada(["agente-on"])).toBe(false);
    expect(iaEstaPausada(["mentoria", "agente-on"])).toBe(false);
  });

  test("sem agente-on, está pausada — o humano assumiu", () => {
    expect(iaEstaPausada([])).toBe(true);
    expect(iaEstaPausada(["mentoria"])).toBe(true);
  });

  test("labels ausentes contam como pausada (não fala por cima de quem assumiu)", () => {
    expect(iaEstaPausada(undefined)).toBe(true);
    expect(iaEstaPausada(null)).toBe(true);
  });
});

// O gatilho da pausa é o mesmo dos gates de qualificação: oferta = preço OU link. Estes são
// pitches reais que a IA produziu em simulação — todos precisam disparar a pausa, e as falas de
// qualificação que vêm antes, nenhuma.
describe("gatilho da pausa (oferta no turno)", () => {
  const ofertaNoTurno = (t: string) => temPrecoDePlano(t) || temLinkDePagamento(t);

  const PITCHES = [
    "Maravilha, o plano que faz sentido pro teu momento é o Anual, com 12 meses de acompanhamento meu. Fica em 12x de R$ 315 no cartão.",
    "Tem também o Semestral, mesma coisa em 6 meses, em 12x de R$ 197 no cartão.",
    "Fica em 12x de R$ 394 no cartão.",
    "à vista no PIX o Anual Completo fica R$ 3.997, que é o menor valor que eu consigo",
    "https://peritowalker.com.br/mentoriaperitosemestralpremium",
    "Tem o plano de 3 meses por 12x de R$ 98,35, menos de R$100 por mês.",
  ];
  for (const p of PITCHES) {
    test(`dispara: "${p.slice(0, 48)}..."`, () => expect(ofertaNoTurno(p)).toBe(true));
  }

  const QUALIFICACAO = [
    "Me conta, como tá os estudos hoje? Sente dificuldade em estudar?",
    "Posso te mandar um vídeo rapidinho de como é a mentoria por dentro?",
    "Pra eu te indicar o plano certo: você já tem um material ou curso organizado ou ainda tá sem isso?",
    "Se o valor fizer sentido pro teu momento, começar agora é algo que dá pra você?",
    PONTE_PITCH_HUMANO,
  ];
  for (const q of QUALIFICACAO) {
    test(`NÃO dispara: "${q.slice(0, 48)}..."`, () => expect(ofertaNoTurno(q)).toBe(false));
  }
});
