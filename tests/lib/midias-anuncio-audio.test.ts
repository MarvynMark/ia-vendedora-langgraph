import { describe, expect, test } from "bun:test";
import { dividirNoAnuncioDeAudio } from "../../src/graphs/main-agent/graph.ts";

describe("dividirNoAnuncioDeAudio", () => {
  test("o texto até o anúncio vai antes do áudio e o resto depois (conv 9614)", () => {
    const r = dividirNoAnuncioDeAudio(
      "Eu estou bem também, obrigado por perguntar. Vi que você está cursando Farmácia. Vou te mandar um áudio que explica como a mentoria pode te ajudar. Como está sua rotina hoje?",
    );
    expect(r.antes).toBe("Eu estou bem também, obrigado por perguntar. Vi que você está cursando Farmácia. Vou te mandar um áudio que explica como a mentoria pode te ajudar.");
    expect(r.depois).toBe("Como está sua rotina hoje?");
  });

  test("\"outro áudio\" também separa", () => {
    const r = dividirNoAnuncioDeAudio("Sem rotina fica difícil. Vou te mandar outro áudio que explica isso.");
    expect(r.antes).toBe("Sem rotina fica difícil. Vou te mandar outro áudio que explica isso.");
    expect(r.depois).toBe("");
  });

  test("sem anúncio, nada muda", () => {
    expect(dividirNoAnuncioDeAudio("Como está sua rotina?")).toEqual({ antes: "", depois: "Como está sua rotina?" });
  });
});
