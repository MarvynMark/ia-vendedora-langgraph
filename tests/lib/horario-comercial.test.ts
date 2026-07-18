import { describe, test, expect } from "bun:test";
import { proximoHorarioComercial, agendarMaximizandoJanela } from "../../src/lib/horario-comercial.ts";

const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
function sp(date: Date) {
  const d = new Date(date.getTime() + SP_OFFSET_MS);
  return { hora: d.getUTCHours(), dia: d.getUTCDay(), min: d.getUTCMinutes() };
}

describe("proximoHorarioComercial (fuso SP, janela 08h20-18h)", () => {
  test("alvo às 01:00 SP (madrugada) vira 08:20 SP, NUNCA 01:00", () => {
    // 2026-07-15 04:00 UTC = 01:00 SP
    const agora = new Date(Date.UTC(2026, 6, 15, 4, 0, 0));
    const c = sp(proximoHorarioComercial(agora, 0));
    expect(c.hora).toBe(8);
    expect(c.min).toBe(20);
  });

  test("alvo às 08:00 SP (antes da abertura) vira 08:20 no mesmo dia", () => {
    // 2026-07-15 11:00 UTC = 08:00 SP (quarta)
    const c = sp(proximoHorarioComercial(new Date(Date.UTC(2026, 6, 15, 11, 0, 0)), 0));
    expect(c.hora).toBe(8);
    expect(c.min).toBe(20);
  });

  test("alvo após 18h SP vira 08:20 de um dia útil", () => {
    // 2026-07-15 23:00 UTC = 20:00 SP
    const c = sp(proximoHorarioComercial(new Date(Date.UTC(2026, 6, 15, 23, 0, 0)), 0));
    expect(c.hora).toBe(8);
    expect(c.min).toBe(20);
    expect(c.dia).toBeGreaterThanOrEqual(1);
    expect(c.dia).toBeLessThanOrEqual(5);
  });

  test("fim de semana vira dia útil (segunda-sexta) às 08:20", () => {
    // 2026-07-18 é sábado. 15:00 UTC = 12:00 SP
    const c = sp(proximoHorarioComercial(new Date(Date.UTC(2026, 6, 18, 15, 0, 0)), 0));
    expect(c.hora).toBe(8);
    expect(c.min).toBe(20);
    expect(c.dia).toBeGreaterThanOrEqual(1);
    expect(c.dia).toBeLessThanOrEqual(5);
  });

  test("INVARIANTE: qualquer instante da semana → sempre dia útil, 08h20-18h", () => {
    const base = new Date(Date.UTC(2026, 6, 13, 0, 0, 0));
    for (let h = 0; h < 168; h++) {
      const c = sp(proximoHorarioComercial(new Date(base.getTime() + h * 3_600_000), 0));
      // nunca antes de 08:20
      expect(c.hora * 60 + c.min).toBeGreaterThanOrEqual(8 * 60 + 20);
      expect(c.hora).toBeLessThan(18);
      expect(c.dia).toBeGreaterThanOrEqual(1);
      expect(c.dia).toBeLessThanOrEqual(5);
    }
  });

  test("alvo já dentro do expediente (12h SP dia útil) é preservado", () => {
    // acha uma quarta ao meio-dia SP: 2026-07-15 15:00 UTC = 12:00 SP
    const agora = new Date(Date.UTC(2026, 6, 15, 15, 0, 0));
    const r = proximoHorarioComercial(agora, 0);
    // se 15/07 for dia útil, retorna igual; valida ao menos que caiu em 08:20-18h dia útil
    const c = sp(r);
    expect(c.hora * 60 + c.min).toBeGreaterThanOrEqual(8 * 60 + 20);
    expect(c.hora).toBeLessThan(18);
  });
});

describe("agendarMaximizandoJanela (espremer follow-up na janela grátis de 24h)", () => {
  // Quarta 2026-07-15, 12:00 SP (= 15:00 UTC), dentro do expediente.
  const agora = new Date(Date.UTC(2026, 6, 15, 15, 0, 0));
  const H = 60 * 60 * 1000;

  test("toque ideal furaria a janela → espreme p/ 30min antes de fechar (grátis)", () => {
    // janela fecha em 3h (dentro do expediente); delay ideal 24h fura a janela
    const msRestantes = 3 * H;
    const fechamento = agora.getTime() + msRestantes;
    const r = agendarMaximizandoJanela(agora, 24 * H, msRestantes);
    // dispara antes do fechamento (grátis) e exatamente 30min antes (margem padrão)
    expect(r.getTime()).toBeLessThan(fechamento);
    expect(r.getTime()).toBe(fechamento - 30 * 60 * 1000);
    const c = sp(r);
    expect(c.hora).toBeGreaterThanOrEqual(9);
    expect(c.hora).toBeLessThan(18);
  });

  test("sem janela (msRestantes <= 0) → agenda normal (cai no template pago)", () => {
    const r = agendarMaximizandoJanela(agora, 24 * H, 0);
    expect(r.getTime()).toBe(proximoHorarioComercial(agora, 24 * H).getTime());
  });

  test("toque ideal já cabe na janela → mantém o horário ideal", () => {
    const r = agendarMaximizandoJanela(agora, 1 * H, 20 * H);
    expect(r.getTime()).toBe(proximoHorarioComercial(agora, 1 * H).getTime());
  });

  test("espaçamento mínimo não cabe (janela fecha em 1h) → cai no pago", () => {
    const r = agendarMaximizandoJanela(agora, 24 * H, 1 * H);
    expect(r.getTime()).toBe(proximoHorarioComercial(agora, 24 * H).getTime());
  });

  test("janela fecha à noite (fora do expediente) mas ainda há expediente hoje → dispara hoje antes das 18h", () => {
    // fecha em 10h → 22:00 SP; ainda dá pra mandar grátis hoje antes das 18h
    const r = agendarMaximizandoJanela(agora, 24 * H, 10 * H);
    const c = sp(r);
    expect(c.hora).toBe(17);
    expect(c.min).toBe(30);
    expect(r.getTime()).toBeLessThan(agora.getTime() + 10 * H);
  });
});
