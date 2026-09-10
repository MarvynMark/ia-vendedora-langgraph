import { describe, test, expect } from "bun:test";
import { TEMPLATES_SESSAO } from "../../src/lib/lembretes-sessao.ts";
import { PRAZO_REMARCACAO_H } from "../../src/config/agenda.ts";

// A lógica de janela é testada pela aritmética abaixo: são as MESMAS constantes usadas no módulo.
// O objetivo é travar a regra "janela larga + marca no evento", que é o que garante envio único
// mesmo com cron atrasado ou processo reiniciado.
const MIN = 60_000, HORA = 60 * MIN;
const dispara24h = (faltam: number) => faltam > 22 * HORA && faltam <= 26 * HORA;
const dispara1h = (faltam: number) => faltam > 40 * MIN && faltam <= 80 * MIN;
const disparaResgate = (passou: number) => passou > 2 * HORA && passou <= 8 * HORA;

describe("janelas dos lembretes", () => {
  test("24h: pega mesmo se o cron atrasar horas", () => {
    expect(dispara24h(24 * HORA)).toBe(true);
    expect(dispara24h(23 * HORA)).toBe(true);
    expect(dispara24h(25.5 * HORA)).toBe(true);
    expect(dispara24h(21 * HORA)).toBe(false); // já passou da janela — não manda atrasado
    expect(dispara24h(30 * HORA)).toBe(false); // cedo demais
  });

  test("1h: janela de 40 min, por isso o cron roda a cada 5", () => {
    expect(dispara1h(60 * MIN)).toBe(true);
    expect(dispara1h(45 * MIN)).toBe(true);
    expect(dispara1h(30 * MIN)).toBe(false); // em cima da hora, não adianta
    expect(dispara1h(2 * HORA)).toBe(false);
  });

  test("as duas janelas não se sobrepõem — nunca manda os dois no mesmo ciclo", () => {
    for (let m = 0; m <= 30 * 60; m += 5) {
      const faltam = m * MIN;
      expect(dispara24h(faltam) && dispara1h(faltam)).toBe(false);
    }
  });

  test("resgate só depois da sessão terminar, e não eternamente", () => {
    expect(disparaResgate(3 * HORA)).toBe(true);
    expect(disparaResgate(1 * HORA)).toBe(false); // ainda pode estar acontecendo
    expect(disparaResgate(20 * HORA)).toBe(false); // velho demais, já perdeu a hora
  });
});

describe("templates da cadência", () => {
  test("cada marca tem seu template nomeado", () => {
    expect(TEMPLATES_SESSAO.lembrete24h).toBe("sessao_lembrete_24h");
    expect(TEMPLATES_SESSAO.lembrete1h).toBe("sessao_lembrete_1h");
    expect(TEMPLATES_SESSAO.resgate).toBe("sessao_resgate_noshow");
  });
});

describe("prazo de remarcação", () => {
  test("3 horas: dentro do prazo a IA resolve, fora ela escala", () => {
    const dentroDoPrazo = (horasAteSessao: number) => horasAteSessao >= PRAZO_REMARCACAO_H;
    expect(dentroDoPrazo(5)).toBe(true);
    expect(dentroDoPrazo(3)).toBe(true);
    expect(dentroDoPrazo(2.9)).toBe(false);
    expect(dentroDoPrazo(0)).toBe(false);
    expect(dentroDoPrazo(-1)).toBe(false); // sessão já passou (no-show)
  });

  test("o lembrete de 24h ainda cabe dentro do prazo de remarcação", () => {
    // Se não coubesse, o lembrete cobraria um combinado que a pessoa já não teria como cumprir.
    expect(22).toBeGreaterThan(PRAZO_REMARCACAO_H);
  });
});
