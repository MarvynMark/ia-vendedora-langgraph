import { describe, test, expect } from "bun:test";
import { linkPrimeirosPassos, templateBoasVindas } from "../../src/graphs/follow-up/graph.ts";
import { CONTEUDO_TEMPLATES, TEMPLATE_META } from "../../src/lib/templates.ts";

const MEDICO = "https://lp.mentoriavestigium.com.br/primeiros-passos-medico";
const PERITO = "https://lp.mentoriavestigium.com.br/primeiros-passos-perito";

describe("linkPrimeirosPassos", () => {
  test("plano de Médico Legista → página do médico", () => {
    const description = "💳 - Plano: Mentoria Vestigium - Médico Legista - 12 meses\nboas-vindas: enviado";
    expect(linkPrimeirosPassos(description)).toBe(MEDICO);
  });

  test("plano de Médico Legista sem acento → página do médico", () => {
    expect(linkPrimeirosPassos("💳 - Plano: Mentoria Vestigium - Medico Legista")).toBe(MEDICO);
  });

  test("plano de Perito Criminal → página do perito", () => {
    const description = "💳 - Plano: Mentoria Vestigium - Perito Criminal - 6 meses\nboas-vindas: enviado";
    expect(linkPrimeirosPassos(description)).toBe(PERITO);
  });

  test("description sem linha de plano → fallback para perito", () => {
    expect(linkPrimeirosPassos("followup-templates: 2\nboas-vindas: enviado")).toBe(PERITO);
    expect(linkPrimeirosPassos("")).toBe(PERITO);
  });

  test("'médico' fora da linha do plano não desvia a trilha", () => {
    // O lead pode ter escrito "sou médico" numa anotação do card; só o plano decide.
    const description = "Lead comentou que é médico do trabalho\n💳 - Plano: Mentoria Vestigium - Perito Criminal - Anual";
    expect(linkPrimeirosPassos(description)).toBe(PERITO);
  });
});

describe("templateBoasVindas", () => {
  test("cada trilha usa o template com o próprio link", () => {
    expect(templateBoasVindas(MEDICO)).toBe("boas_vindas_medico");
    expect(templateBoasVindas(PERITO)).toBe("boas_vindas_perito");
  });

  test("texto registrado no CRM aponta pro mesmo link do template", () => {
    expect(CONTEUDO_TEMPLATES.boas_vindas_medico).toContain(MEDICO);
    expect(CONTEUDO_TEMPLATES.boas_vindas_perito).toContain(PERITO);
    expect(TEMPLATE_META.boas_vindas_medico?.bodyVars).toBe(1);
    expect(TEMPLATE_META.boas_vindas_perito?.bodyVars).toBe(1);
  });
});
