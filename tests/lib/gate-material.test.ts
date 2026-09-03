import { describe, test, expect } from "bun:test";
import {
  descobertaMaterialFeita,
  classificarRespostaMaterial,
  materialDeclaradoPeloLead,
  falaSubstantiva,
  situacaoDescoberta,
} from "../../src/lib/gate-material.ts";
import { ehMedicoLead, ehMedicoPorFormacao } from "../../src/lib/medico.ts";

const ai = (content: string) => ({ type: "ai", content });
const lead = (content: string) => ({ type: "human", content });

describe("descobertaMaterialFeita", () => {
  test("pergunta feita e lead respondeu → descoberta concluída", () => {
    expect(
      descobertaMaterialFeita([
        ai("Bora ver os planos?"),
        ai("Pra eu te indicar o plano certo: você já tem um material ou curso organizado (tipo Estratégia, Gran) ou ainda tá sem isso?"),
        lead("já tenho o estratégia"),
      ]),
    ).toBe(true);
  });

  test("pergunta feita mas o lead ainda não respondeu → não concluída", () => {
    expect(
      descobertaMaterialFeita([
        ai("você já tem um material organizado ou ainda tá sem isso?"),
      ]),
    ).toBe(false);
  });

  test("a IA falou de material sem perguntar nada → não conta como descoberta", () => {
    expect(
      descobertaMaterialFeita([
        ai("O Anual Completo já vem com o material do Estratégia incluso."),
        lead("entendi"),
      ]),
    ).toBe(false);
  });

  test("histórico vazio → não concluída", () => {
    expect(descobertaMaterialFeita([])).toBe(false);
  });
});

describe("classificarRespostaMaterial", () => {
  test("lead já tem material", () => {
    expect(classificarRespostaMaterial("Eu já tenho a assinatura do estratégia concurso")).toBe("sim");
    expect(classificarRespostaMaterial("tenho um cursinho aqui")).toBe("sim");
    expect(classificarRespostaMaterial("já assino o Gran")).toBe("sim");
  });

  test("lead não tem material", () => {
    expect(classificarRespostaMaterial("não tenho nada ainda")).toBe("nao");
    expect(classificarRespostaMaterial("tô sem material nenhum")).toBe("nao");
    expect(classificarRespostaMaterial("comecei do zero")).toBe("nao");
  });

  test("resposta ambígua → indefinido (deixa a leitura com o LLM)", () => {
    expect(classificarRespostaMaterial("mais ou menos")).toBe(null);
    expect(classificarRespostaMaterial("ok")).toBe(null);
  });

  test("negativa tem prioridade sobre o verbo ter", () => {
    expect(classificarRespostaMaterial("não tenho material, só uns PDFs soltos")).toBe("nao");
  });
});

describe("materialDeclaradoPeloLead", () => {
  test("pega a declaração espontânea, sem pergunta anterior (caso da conv 5929)", () => {
    expect(
      materialDeclaradoPeloLead([
        ai("Bora ver os planos?"),
        lead("Eu já tenho a assinatura do estratégia concurso"),
      ]),
    ).toBe("sim");
  });

  test("ignora o que a IA disse — só olha o lead", () => {
    expect(
      materialDeclaradoPeloLead([ai("ele já vem com o material do Estratégia incluso")]),
    ).toBe(null);
  });
});

describe("ehMedicoLead", () => {
  test("label 'medico' é autoritativa", () => {
    expect(ehMedicoLead({ etiquetas: ["medico"], dadosFormulario: "Formação: Direito" })).toBe(true);
  });

  test("formação do formulário, tolerante a typo", () => {
    expect(ehMedicoLead({ dadosFormulario: "Nome: Ana | Formação: Medicina | Idade: 30" })).toBe(true);
    expect(ehMedicoLead({ dadosFormulario: "Formação: Mediciba" })).toBe(true);
  });

  test("custom_attribute qual_formacao (leads importados, sem formulário)", () => {
    expect(ehMedicoLead({ atributosContato: { qual_formacao: "medicina" } })).toBe(true);
  });

  test("biomedicina e veterinária não são médicos", () => {
    expect(ehMedicoPorFormacao("Biomedicina")).toBe(false);
    expect(ehMedicoPorFormacao("Medicina Veterinária")).toBe(false);
  });

  test("sem nenhuma fonte → não é médico", () => {
    expect(ehMedicoLead({})).toBe(false);
    expect(ehMedicoLead({ dadosFormulario: "Formação: Química" })).toBe(false);
  });
});

describe("gate de situação — o preço espera o lead contar a rotina", () => {
  test("monossílabo de cortesia não é fala substantiva", () => {
    expect(falaSubstantiva("sim")).toBe(false);
    expect(falaSubstantiva("Sim, pode sim, obrigado!")).toBe(false);
    expect(falaSubstantiva("ok blz")).toBe(false);
  });

  test("fala com contexto é substantiva", () => {
    expect(falaSubstantiva("Trabalho 12h e só consigo estudar de madrugada")).toBe(true);
    expect(falaSubstantiva("Estava cursando biomedicina mas parei pq engravidei")).toBe(true);
  });

  test("exige DUAS falas substantivas (o piso de qualificação)", () => {
    const uma = [{ type: "human", content: "Trabalho 12h e só consigo estudar de madrugada" }];
    expect(situacaoDescoberta(uma)).toBe(false);
    const duas = [...uma, { type: "human", content: "sim" }, { type: "human", content: "Já tentei cronograma mas nunca consigo seguir" }];
    expect(situacaoDescoberta(duas)).toBe(true);
  });

  test("conversa só de monossílabos nunca libera o preço", () => {
    const h = [{ type: "human", content: "sim" }, { type: "human", content: "ok" }, { type: "human", content: "pode sim" }];
    expect(situacaoDescoberta(h)).toBe(false);
  });
});
