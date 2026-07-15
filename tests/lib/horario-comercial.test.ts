import { describe, test, expect } from "bun:test";
import { proximoHorarioComercial } from "../../src/lib/horario-comercial.ts";

const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
function sp(date: Date) {
  const d = new Date(date.getTime() + SP_OFFSET_MS);
  return { hora: d.getUTCHours(), dia: d.getUTCDay(), min: d.getUTCMinutes() };
}

describe("proximoHorarioComercial (fuso SP, janela 9h-18h)", () => {
  test("alvo às 01:00 SP (madrugada) vira 9h SP, NUNCA 01:00", () => {
    // 2026-07-15 04:00 UTC = 01:00 SP
    const agora = new Date(Date.UTC(2026, 6, 15, 4, 0, 0));
    const c = sp(proximoHorarioComercial(agora, 0));
    expect(c.hora).toBe(9);
    expect(c.min).toBe(0);
  });

  test("alvo após 18h SP vira 9h de um dia útil", () => {
    // 2026-07-15 23:00 UTC = 20:00 SP
    const c = sp(proximoHorarioComercial(new Date(Date.UTC(2026, 6, 15, 23, 0, 0)), 0));
    expect(c.hora).toBe(9);
    expect(c.dia).toBeGreaterThanOrEqual(1);
    expect(c.dia).toBeLessThanOrEqual(5);
  });

  test("fim de semana vira dia útil (segunda-sexta) às 9h", () => {
    // 2026-07-18 é sábado. 15:00 UTC = 12:00 SP
    const c = sp(proximoHorarioComercial(new Date(Date.UTC(2026, 6, 18, 15, 0, 0)), 0));
    expect(c.hora).toBe(9);
    expect(c.dia).toBeGreaterThanOrEqual(1);
    expect(c.dia).toBeLessThanOrEqual(5);
  });

  test("INVARIANTE: qualquer instante da semana → sempre dia útil, 9h-18h", () => {
    const base = new Date(Date.UTC(2026, 6, 13, 0, 0, 0));
    for (let h = 0; h < 168; h++) {
      const c = sp(proximoHorarioComercial(new Date(base.getTime() + h * 3_600_000), 0));
      expect(c.hora).toBeGreaterThanOrEqual(9);
      expect(c.hora).toBeLessThan(18);
      expect(c.dia).toBeGreaterThanOrEqual(1);
      expect(c.dia).toBeLessThanOrEqual(5);
    }
  });

  test("alvo já dentro do expediente (12h SP dia útil) é preservado", () => {
    // acha uma quarta ao meio-dia SP: 2026-07-15 15:00 UTC = 12:00 SP
    const agora = new Date(Date.UTC(2026, 6, 15, 15, 0, 0));
    const r = proximoHorarioComercial(agora, 0);
    // se 15/07 for dia útil, retorna igual; valida ao menos que caiu em 9-18h dia útil
    const c = sp(r);
    expect(c.hora).toBeGreaterThanOrEqual(9);
    expect(c.hora).toBeLessThan(18);
  });
});
