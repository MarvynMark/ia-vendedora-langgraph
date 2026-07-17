import { describe, test, expect } from "bun:test";
import {
  rastrear,
  aguardarDrenar,
  processamentosAtivos,
  estaEncerrando,
  marcarEncerrando,
} from "../../src/lib/processamentos-ativos.ts";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("processamentos-ativos (graceful shutdown)", () => {
  test("rastrear conta turnos ativos e zera ao terminar", async () => {
    expect(processamentosAtivos()).toBe(0);
    const p = rastrear(espera(30));
    expect(processamentosAtivos()).toBe(1);
    await p;
    expect(processamentosAtivos()).toBe(0);
  });

  test("aguardarDrenar resolve true quando todos os turnos terminam", async () => {
    rastrear(espera(20));
    rastrear(espera(40));
    expect(processamentosAtivos()).toBe(2);
    const drenou = await aguardarDrenar(1000);
    expect(drenou).toBe(true);
    expect(processamentosAtivos()).toBe(0);
  });

  test("aguardarDrenar retorna false se estourar o timeout", async () => {
    rastrear(espera(200)); // dura mais que o timeout do dreno
    const drenou = await aguardarDrenar(30);
    expect(drenou).toBe(false);
    await espera(220); // deixa o turno terminar para não vazar p/ outros testes
  });

  test("aguardarDrenar retorna true imediatamente quando não há turnos", async () => {
    expect(processamentosAtivos()).toBe(0);
    expect(await aguardarDrenar(1000)).toBe(true);
  });

  test("marcarEncerrando ativa o flag de recusa de novos webhooks", () => {
    expect(estaEncerrando()).toBe(false);
    marcarEncerrando();
    expect(estaEncerrando()).toBe(true);
  });
});
