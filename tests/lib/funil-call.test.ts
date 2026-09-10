import { describe, test, expect, afterEach } from "bun:test";
import { trilhaDoLead } from "../../src/lib/funil-call.ts";
import { env } from "../../src/config/env.ts";

// env é `as const`; nos testes o valor é trocado via cast para exercitar os três modos.
const setFlag = (v: "off" | "piloto" | "on") => { (env as unknown as Record<string, string>)["FUNIL_CALL"] = v; };
afterEach(() => setFlag("off"));

describe("trilhaDoLead", () => {
  test("off é o default e mantém TODO mundo no funil antigo", () => {
    setFlag("off");
    expect(trilhaDoLead({ ofertaJaApresentada: false })).toBe("antigo");
    expect(trilhaDoLead({ etiquetas: ["investe-sim"], ofertaJaApresentada: false })).toBe("antigo");
  });

  test("on manda todo mundo para a sessão", () => {
    setFlag("on");
    expect(trilhaDoLead({ ofertaJaApresentada: false })).toBe("sessao");
    expect(trilhaDoLead({ etiquetas: ["investe-nao"], ofertaJaApresentada: false })).toBe("sessao");
  });

  test("piloto separa pelos tiers", () => {
    setFlag("piloto");
    expect(trilhaDoLead({ etiquetas: ["agente-on", "investe-sim"], ofertaJaApresentada: false })).toBe("sessao");
    expect(trilhaDoLead({ etiquetas: ["agente-on", "investe-nao"], ofertaJaApresentada: false })).toBe("antigo");
    expect(trilhaDoLead({ etiquetas: ["agente-on"], ofertaJaApresentada: false })).toBe("antigo");
  });

  test("quem JÁ ouviu preço nunca muda de trilha no meio da negociação", () => {
    for (const modo of ["on", "piloto"] as const) {
      setFlag(modo);
      expect(trilhaDoLead({ etiquetas: ["investe-sim"], ofertaJaApresentada: true })).toBe("antigo");
    }
  });
});
