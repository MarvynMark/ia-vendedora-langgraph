import { describe, test, expect } from "bun:test";
import {
  linkOnboarding, templateBoasVindas, mensagemBoasVindas,
  LINK_ONBOARDING, LINK_ONBOARDING_ESTRATEGIA, TEMPLATES_ONBOARDING_SINCRONIZADOS,
} from "../../src/graphs/follow-up/graph.ts";
import { CONTEUDO_TEMPLATES, TEMPLATE_META } from "../../src/lib/templates.ts";

const PADRAO = "https://lp.mentoriavestigium.com.br/onboarding";
const ESTRATEGIA = "https://lp.mentoriavestigium.com.br/onboarding-estrategia";

describe("linkOnboarding", () => {
  test("links apontam para os atalhos do site", () => {
    expect(LINK_ONBOARDING).toBe(PADRAO);
    expect(LINK_ONBOARDING_ESTRATEGIA).toBe(ESTRATEGIA);
  });

  test("plano de Perito Criminal comum → onboarding sem Estratégia", () => {
    const description = "💳 - Plano: Mentoria Vestigium - Perito Criminal - 6 meses\nboas-vindas: enviado";
    expect(linkOnboarding(description)).toBe(PADRAO);
  });

  test("plano com Estratégia no nome (com e sem acento) → onboarding com Estratégia", () => {
    expect(linkOnboarding("💳 - Plano: Mentoria Vestigium + Estratégia - 12 meses")).toBe(ESTRATEGIA);
    expect(linkOnboarding("💳 - Plano: Mentoria Vestigium Estrategia Anual")).toBe(ESTRATEGIA);
  });

  test("plano Premium → onboarding com Estratégia", () => {
    expect(linkOnboarding("💳 - Plano: Mentoria Vestigium - Perito Criminal - PREMIUM")).toBe(ESTRATEGIA);
  });

  test("médico legista (todos têm Estratégia) → onboarding com Estratégia", () => {
    expect(linkOnboarding("💳 - Plano: Mentoria Vestigium - Médico Legista - 12 meses")).toBe(ESTRATEGIA);
    expect(linkOnboarding("💳 - Plano: Mentoria Vestigium - Medico Legista")).toBe(ESTRATEGIA);
  });

  test("description sem linha de plano → onboarding sem Estratégia", () => {
    expect(linkOnboarding("followup-templates: 2\nboas-vindas: enviado")).toBe(PADRAO);
    expect(linkOnboarding("")).toBe(PADRAO);
  });

  test("palavras fora da linha do plano não mudam o link", () => {
    // O lead pode ter escrito "sou médico" ou "estudo pelo Estratégia" numa anotação do card.
    const description = "Lead é médico e estuda pelo Estratégia\n💳 - Plano: Mentoria Vestigium - Perito Criminal - Anual";
    expect(linkOnboarding(description)).toBe(PADRAO);
  });
});

describe("templateBoasVindas", () => {
  test("cada link usa um template que leva ao mesmo destino", () => {
    if (TEMPLATES_ONBOARDING_SINCRONIZADOS) {
      expect(templateBoasVindas(PADRAO)).toBe("boas_vindas_onboarding");
      expect(templateBoasVindas(ESTRATEGIA)).toBe("boas_vindas_onboarding_estrat");
    } else {
      // Ponte: os antigos redirecionam (primeiros-passos-medico → onboarding com Estratégia).
      expect(templateBoasVindas(PADRAO)).toBe("boas_vindas_perito");
      expect(templateBoasVindas(ESTRATEGIA)).toBe("boas_vindas_medico");
    }
  });

  test("templates novos: texto do CRM igual ao texto livre e mesmo link", () => {
    const novos = { boas_vindas_onboarding: PADRAO, boas_vindas_onboarding_estrat: ESTRATEGIA } as const;
    for (const [nome, link] of Object.entries(novos)) {
      expect(CONTEUDO_TEMPLATES[nome as keyof typeof CONTEUDO_TEMPLATES]).toBe(mensagemBoasVindas("[Nome]", link));
      expect(TEMPLATE_META[nome]?.bodyVars).toBe(1);
    }
  });

  test("a mensagem não promete matrícula liberada", () => {
    expect(mensagemBoasVindas("Ana", PADRAO)).not.toContain("matrícula");
  });
});
