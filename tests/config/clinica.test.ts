import { describe, test, expect } from "bun:test";
import { clinica } from "../../src/config/clinica.ts";

describe("clinica", () => {
  test("tem 8 procedimentos", () => {
    expect(clinica.procedimentos.length).toBe(8);
  });

  test("avaliação é gratuita", () => {
    const avaliacao = clinica.procedimentos.find(p => p.id === "avaliacao");
    expect(avaliacao).toBeDefined();
    expect(avaliacao!.valor).toBe("Gratuita");
    expect(avaliacao!.duracao).toBe(30);
  });

  test("aceita 4 convênios", () => {
    expect(clinica.convenios.length).toBe(4);
    expect(clinica.convenios).toContain("Unimed");
  });

  test("horário de sábado é reduzido", () => {
    expect(clinica.horario.sabado).toBe("08h às 11h");
    expect(clinica.horario.domingo).toBe("Fechado");
  });
});
