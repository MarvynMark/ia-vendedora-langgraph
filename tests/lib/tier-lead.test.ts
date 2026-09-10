import { describe, test, expect } from "bun:test";
import { tierDoLead, ETIQUETA_TIER } from "../../src/lib/tier-lead.ts";

describe("tierDoLead", () => {
  test("as duas alternativas exatas do formulário", () => {
    expect(tierDoLead("Sim, é o que eu quero!")).toBe("sim");
    expect(tierDoLead("Infelizmente não no momento!")).toBe("nao");
  });

  test("tolera caixa, acento e espaço em volta", () => {
    expect(tierDoLead("  SIM, É O QUE EU QUERO!  ")).toBe("sim");
    expect(tierDoLead("infelizmente nao no momento")).toBe("nao");
  });

  test("sem resposta não entra em nenhum grupo da medição", () => {
    expect(tierDoLead("")).toBeNull();
    expect(tierDoLead("   ")).toBeNull();
    expect(tierDoLead(null)).toBeNull();
    expect(tierDoLead(undefined)).toBeNull();
  });

  test("resposta livre inesperada não é chutada para um dos lados", () => {
    expect(tierDoLead("talvez")).toBeNull();
    expect(tierDoLead("depende do valor")).toBeNull();
  });

  test("as etiquetas não colidem com as labels sim/nao aposentadas", () => {
    expect(ETIQUETA_TIER.sim).toBe("investe-sim");
    expect(ETIQUETA_TIER.nao).toBe("investe-nao");
  });
});
