import { describe, test, expect } from "bun:test";
import { delayInicialMs, DELAY_INICIAL } from "../../src/lib/delays-followup.ts";

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

describe("delayInicialMs", () => {
  test("Novo Lead dispara quase imediato", () => {
    expect(delayInicialMs("Novo Lead")).toBe(5 * MIN);
  });

  test("Primeira mensagem espera o dia seguinte", () => {
    expect(delayInicialMs("Primeira mensagem")).toBe(1 * DIA);
  });

  test("Conexão espera 3h (era 1h — chegava no meio da conversa do lead)", () => {
    expect(delayInicialMs("Conexão")).toBe(3 * HORA);
    expect(delayInicialMs("Conexao")).toBe(3 * HORA); // o cron usa o nome sem acento
  });

  test("Nutrir e Perdido usam a esteira longa", () => {
    expect(delayInicialMs("Nutrir")).toBe(3 * DIA);
    expect(delayInicialMs("Perdido")).toBe(3 * DIA);
  });

  test("etapa desconhecida cai no padrão", () => {
    expect(delayInicialMs("Etapa Que Não Existe")).toBe(1 * DIA);
    expect(delayInicialMs("")).toBe(1 * DIA);
  });

  describe("Aguardando Pagamento — a descrição do card decide o ritmo", () => {
    const COM_LINK = "🟣 - Concurso: PCDF\n🔁 - Follow-ups: 0\n👤 - Descrição: link enviado";
    const SEM_LINK = "🟣 - Concurso: PCDF\n🔁 - Follow-ups: 0\n👤 - Descrição: em negociação";

    test("sem link enviado → pós-preço, 1h (o lead precisa de tempo com o preço)", () => {
      expect(delayInicialMs("Aguardando Pagamento", SEM_LINK)).toBe(1 * HORA);
    });

    test("com link enviado → lembrete, 20min (provável abandono de checkout)", () => {
      expect(delayInicialMs("Aguardando Pagamento", COM_LINK)).toBe(20 * MIN);
    });

    test("descrição vazia é tratada como pós-preço", () => {
      expect(delayInicialMs("Aguardando Pagamento")).toBe(1 * HORA);
      expect(delayInicialMs("Aguardando Pagamento", "")).toBe(1 * HORA);
    });

    test("reconhece variações de espaçamento em 'link enviado'", () => {
      expect(delayInicialMs("Aguardando Pagamento", "status: Link Enviado")).toBe(20 * MIN);
      expect(delayInicialMs("Aguardando Pagamento", "👤 - Descrição: linkenviado")).toBe(20 * MIN);
    });
  });

  test("a tabela exportada bate com o que a função devolve", () => {
    expect(delayInicialMs("Novo Lead")).toBe(DELAY_INICIAL.novoLead);
    expect(delayInicialMs("Conexão")).toBe(DELAY_INICIAL.conexao);
    expect(delayInicialMs("Aguardando Pagamento")).toBe(DELAY_INICIAL.posPreco);
  });
});
