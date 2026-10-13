import { describe, test, expect } from "bun:test";
import { corrigirRegrasDeLingua, regraDeterministica } from "../../src/corretor/lingua.ts";

// Os casos que a IA errou no teste de 13/10/2026, e outros comuns em discursiva.
describe("regraDeterministica (acentuação e crase)", () => {
  test("proparoxítonas", () => {
    expect(regraDeterministica("O Codigo Penal", "O Código Penal")?.regra).toContain('"código" é proparoxítona');
    expect(regraDeterministica("a pratica", "a prática")?.regra).toContain('"prática" é proparoxítona');
    expect(regraDeterministica("analise", "análise")?.regra).toContain("proparoxítona");
  });

  test("paroxítonas pela terminação", () => {
    expect(regraDeterministica("carater", "caráter")?.regra).toContain('"caráter" é paroxítona terminada em -r');
    expect(regraDeterministica("relevancia", "relevância")?.regra).toContain("terminada em ditongo");
    expect(regraDeterministica("historia", "história")?.regra).toContain("terminada em ditongo");
    expect(regraDeterministica("facil", "fácil")?.regra).toContain("terminada em -l");
  });

  test("oxítonas", () => {
    expect(regraDeterministica("tambem", "também")?.regra).toContain('"também" é oxítona');
    expect(regraDeterministica("voce", "você")?.regra).toContain("oxítona");
  });

  test("crase vira tipo crase", () => {
    const r = regraDeterministica("Quanto as circunstâncias", "Quanto às circunstâncias");
    expect(r?.tipo).toBe("crase");
    expect(r?.regra).toContain('"às"');
  });

  test("casos fora das regras ficam com a IA", () => {
    expect(regraDeterministica("saude", "saúde")).toBeNull();          // hiato
    expect(regraDeterministica("infracao", "infração")).toBeNull();    // só til
    expect(regraDeterministica("haviam situações", "havia situações")).toBeNull(); // não é acento
  });

  test("corrigirRegrasDeLingua troca só o que reconhece", () => {
    const [a, b] = corrigirRegrasDeLingua([
      { trecho: "carater", correcao: "caráter", tipo: "acentuação", regra: "oxítona terminada em -er" },
      { trecho: "haviam", correcao: "havia", tipo: "concordância", regra: "haver é impessoal" },
    ]);
    expect(a!.regra).toContain("paroxítona terminada em -r");
    expect(b!.regra).toBe("haver é impessoal");
  });
});
