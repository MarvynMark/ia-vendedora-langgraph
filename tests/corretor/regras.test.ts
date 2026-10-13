import { describe, test, expect } from "bun:test";
import {
  buscarQuestao,
  calcularNota,
  codigoQuestaoNoTexto,
  dividirMensagem,
  formatarNumero,
  interpretarArea,
  interpretarComando,
  interpretarConcurso,
  linhasDeTextoDigitado,
} from "../../src/corretor/regras.ts";
import { perfilPcdf } from "../../src/corretor/perfis/pcdf/perfil.ts";
import { PERFIS } from "../../src/corretor/perfis/index.ts";
import { montarDevolutiva } from "../../src/corretor/devolutiva.ts";
import type { AvaliacaoIA } from "../../src/corretor/tipos.ts";

function avaliacao(parcial: Partial<AvaliacaoIA> = {}): AvaliacaoIA {
  return {
    oQueAQuestaoExigia: "Explicar X e diferenciar Y.",
    espelho: [{ elemento: "Conceito de X", status: "ATENDIDO", comentario: "ok" }],
    criterios: {
      TX: { nota: 4, justificativa: "a" },
      AR: { nota: 3.5, justificativa: "b" },
      CA: { nota: 4, justificativa: "c" },
      EC: { nota: 6.5, justificativa: "d" },
    },
    errosPortugues: [
      { linha: 2, trecho: "pericia", correcao: "perícia", tipo: "acentuação", explicacao: "proparoxítona" },
      { linha: 5, trecho: "a nível", correcao: "em nível", tipo: "propriedade vocabular", explicacao: "x" },
      { linha: 9, trecho: "haviam", correcao: "havia", tipo: "concordância", explicacao: "impessoal" },
    ],
    fugaAoTema: false,
    identificacaoIndevida: false,
    pontosFortes: ["p1", "p2", "p3"],
    ondePerdeu: ["o1"],
    prioridades: ["a", "b", "c", "d"],
    espelhoIdeal: ["e1"],
    respostaModelo: "modelo",
    veredito: "bom caminho",
    ...parcial,
  };
}

const linhas = (n: number) => Array.from({ length: n }, (_, i) => `linha ${i + 1} do texto`);

describe("interpretarComando", () => {
  test("/corrigir sozinho, com concurso e com código", () => {
    expect(interpretarComando("/corrigir")).toEqual({ tipo: "iniciar", concurso: null, codigo: null });
    expect(interpretarComando("/Corrigir PCDF")).toEqual({ tipo: "iniciar", concurso: "pcdf", codigo: null });
    expect(interpretarComando("/corrigir pcdf g5")).toEqual({ tipo: "iniciar", concurso: "pcdf", codigo: "G05" });
    expect(interpretarComando("/corrigir E03")).toEqual({ tipo: "iniciar", concurso: null, codigo: "E03" });
  });

  test("CORRIGIR sem barra é a confirmação; palavra solta no meio da conversa não é comando", () => {
    expect(interpretarComando("CORRIGIR")).toEqual({ tipo: "corrigir" });
    expect(interpretarComando("pode corrigir minha redação?")).toBeNull();
    expect(interpretarComando("corrigir redação")).toBeNull();
  });

  test("pronto e cancelar", () => {
    expect(interpretarComando("PRONTO")).toEqual({ tipo: "pronto" });
    expect(interpretarComando("/pronto")).toEqual({ tipo: "pronto" });
    expect(interpretarComando("/cancelar")).toEqual({ tipo: "cancelar" });
    expect(interpretarComando("pronto, paguei o boleto")).toBeNull();
  });
});

describe("concurso, área e questão do banco", () => {
  test("concurso por número, código ou nome", () => {
    expect(interpretarConcurso("1", PERFIS)?.codigo).toBe("pcdf");
    expect(interpretarConcurso("PCDF", PERFIS)?.codigo).toBe("pcdf");
    expect(interpretarConcurso("perito criminal", PERFIS)?.codigo).toBe("pcdf");
    expect(interpretarConcurso("99", PERFIS)).toBeNull();
  });

  test("área por código, posição ou nome — química não casa com bioquímica", () => {
    expect(interpretarArea("103", perfilPcdf)).toBe("103");
    expect(interpretarArea("3", perfilPcdf)).toBe("103");
    expect(interpretarArea("sou de computação", perfilPcdf)).toBe("103");
    expect(interpretarArea("Química", perfilPcdf)).toBe("109");
    expect(interpretarArea("farmácia", perfilPcdf)).toBe("105");
    expect(interpretarArea("ciências", perfilPcdf)).toBeNull();
    expect(interpretarArea("medicina", perfilPcdf)).toBeNull();
  });

  test("código no texto", () => {
    expect(codigoQuestaoNoTexto("g5")).toBe("G05");
    expect(codigoQuestaoNoTexto("Questão E01")).toBe("E01");
    expect(codigoQuestaoNoTexto("explique o conceito")).toBeNull();
  });

  test("específica depende da área; geral não", () => {
    expect(buscarQuestao(perfilPcdf, "G01", null)?.enunciado).toContain("concurso de pessoas");
    expect(buscarQuestao(perfilPcdf, "E01", "103")?.enunciado).toContain("assinatura digital");
    expect(buscarQuestao(perfilPcdf, "E01", "101")?.enunciado).toContain("PCR");
    expect(buscarQuestao(perfilPcdf, "E01", null)).toBeNull();
    expect(buscarQuestao(perfilPcdf, "G99", null)).toBeNull();
  });
});

describe("perfil PCDF", () => {
  test("banco com 20 gerais e 8 por área, e conteúdo programático de todas as áreas no prompt", () => {
    expect(perfilPcdf.banco.filter((q) => q.area === null)).toHaveLength(20);
    for (const area of Object.keys(perfilPcdf.areas)) {
      expect(perfilPcdf.banco.filter((q) => q.area === area)).toHaveLength(8);
      expect(perfilPcdf.promptSistema(area)).toContain(`(CÓDIGO ${area})`);
    }
  });

  test("prompt traz instruções, metodologia, calibração e conteúdo gerais", () => {
    const p = perfilPcdf.promptSistema(null);
    expect(p).toContain("Professor Vestigium");
    expect(p).toContain("Metodologia Vestigium de correção");
    expect(p).toContain("Teste da benevolência");
    expect(p).toContain("ÁREA DE CONHECIMENTOS GERAIS");
    expect(p).not.toContain("Formato obrigatório de saída");
  });
});

describe("linhas de texto digitado", () => {
  test("respeita as linhas quando o aluno já quebrou como na folha", () => {
    const r = linhasDeTextoDigitado(linhas(12).join("\n"), perfilPcdf);
    expect(r).toEqual({ linhas: linhas(12), estimadas: false });
  });

  test("texto corrido é quebrado na largura de uma linha manuscrita", () => {
    const texto = "palavra ".repeat(100).trim(); // 799 caracteres
    const r = linhasDeTextoDigitado(texto, perfilPcdf);
    expect(r.estimadas).toBe(true);
    expect(r.linhas.every((l) => l.length <= perfilPcdf.caracteresPorLinha)).toBe(true);
    expect(r.linhas.length).toBe(13);
  });
});

describe("calcularNota (Edital PCDF 2016, item 13)", () => {
  test("NQ = DQ − NE/TL com memória fechando", () => {
    const c = calcularNota(perfilPcdf, avaliacao(), linhas(14));
    expect(c.dq).toBe(18);
    expect(c.ne).toBe(3);
    expect(c.tl).toBe(14);
    expect(c.nq).toBe(17.79);
    expect(c.zero).toBeNull();
  });

  test("nota da IA acima do máximo do critério é presa no máximo", () => {
    const c = calcularNota(perfilPcdf, avaliacao({ criterios: {
      TX: { nota: 7, justificativa: "" }, AR: { nota: -1, justificativa: "" },
      CA: { nota: 5, justificativa: "" }, EC: { nota: 12, justificativa: "" },
    } }), linhas(15));
    expect(c.criterios.map((x) => x.nota)).toEqual([5, 0, 5, 10]);
    expect(c.dq).toBe(20);
  });

  test("texto depois da 15ª linha é desconsiderado: TL = 15 e erro da linha 16 não conta", () => {
    const a = avaliacao({ errosPortugues: [
      { linha: 3, trecho: "x", correcao: "y", tipo: "grafia", explicacao: "" },
      { linha: 16, trecho: "x", correcao: "y", tipo: "grafia", explicacao: "" },
    ] });
    const c = calcularNota(perfilPcdf, a, linhas(18));
    expect(c.tl).toBe(15);
    expect(c.ne).toBe(1);
    expect(c.linhasDescartadas).toBe(3);
  });

  test("texto digitado (linhas estimadas) não é cortado: TL limitado a 15 e aviso do excedente", () => {
    const a = avaliacao({ errosPortugues: [
      { linha: 18, trecho: "x", correcao: "y", tipo: "grafia", explicacao: "" },
    ] });
    const c = calcularNota(perfilPcdf, a, linhas(21), true);
    expect(c.tl).toBe(15);
    expect(c.linhasDescartadas).toBe(0);
    expect(c.excedenteEstimado).toBe(6);
    expect(c.ne).toBe(1); // erro da linha 18 conta: o texto inteiro foi avaliado
    const [, m2] = montarDevolutiva(perfilPcdf, a, c, { linhasEstimadas: true, codigoQuestao: null });
    expect(m2).toContain("equivale a cerca de 21 linhas manuscritas");
    expect(m2).not.toContain("foram desconsideradas");
  });

  test("menos de 10 linhas zera a questão", () => {
    const c = calcularNota(perfilPcdf, avaliacao(), linhas(9));
    expect(c.zero).toBe("menos_linhas");
    expect(c.nq).toBe(0);
    expect(c.dq).toBe(18); // fica como referência pedagógica
  });

  test("fuga ao tema e identificação zeram", () => {
    expect(calcularNota(perfilPcdf, avaliacao({ fugaAoTema: true }), linhas(12)).zero).toBe("fuga_tema");
    expect(calcularNota(perfilPcdf, avaliacao({ identificacaoIndevida: true }), linhas(12)).zero).toBe("identificacao");
    expect(calcularNota(perfilPcdf, avaliacao(), []).zero).toBe("sem_texto");
  });

  test("resultado negativo vira zero", () => {
    const erros = Array.from({ length: 30 }, (_, i) => ({ linha: (i % 10) + 1, trecho: "x", correcao: "y", tipo: "grafia", explicacao: "" }));
    const c = calcularNota(perfilPcdf, avaliacao({
      criterios: { TX: { nota: 0.5, justificativa: "" }, AR: { nota: 0, justificativa: "" }, CA: { nota: 0, justificativa: "" }, EC: { nota: 0, justificativa: "" } },
      errosPortugues: erros,
    }), linhas(10));
    expect(c.nqCalculada).toBeLessThan(0);
    expect(c.nq).toBe(0);
    expect(c.zero).toBeNull();
  });
});

describe("devolutiva", () => {
  test("três blocos, cada um dentro do limite do WhatsApp, com a conta da nota", () => {
    const a = avaliacao();
    const msgs = montarDevolutiva(perfilPcdf, a, calcularNota(perfilPcdf, a, linhas(14)), { linhasEstimadas: false, codigoQuestao: "G01" });
    expect(msgs).toHaveLength(3);
    expect(msgs.every((m) => m.length <= 4000)).toBe(true);
    expect(msgs[0]).toContain("*NOTA: 17,79 / 25,00*");
    expect(msgs[0]).toContain("NQ = DQ − (NE / TL) = 18,00 − (3 / 14) = 17,79");
    expect(msgs[0]).not.toContain("p3"); // até 2 pontos fortes
    expect(msgs[1]).toContain("NE = 3");
    expect(msgs[1]).toContain("✅ ATENDIDO");
    expect(msgs[2]).toContain("referência de treino");
  });

  test("questão zerada explica o motivo", () => {
    const a = avaliacao();
    const [m1] = montarDevolutiva(perfilPcdf, a, calcularNota(perfilPcdf, a, linhas(8)), { linhasEstimadas: true, codigoQuestao: null });
    expect(m1).toContain("*NOTA: 0,00 / 25,00*");
    expect(m1).toContain("8 linha(s), abaixo do mínimo de 10");
    expect(m1).toContain("TL = 8 (estimado)");
  });
});

describe("utilitários", () => {
  test("formatarNumero usa vírgula", () => {
    expect(formatarNumero(17.789)).toBe("17,79");
    expect(formatarNumero(0)).toBe("0,00");
  });

  test("dividirMensagem corta entre parágrafos", () => {
    const p = "a".repeat(2000);
    const partes = dividirMensagem(`${p}\n\n${p}\n\n${p}`, 3500);
    expect(partes).toHaveLength(3);
    expect(dividirMensagem("curta")).toEqual(["curta"]);
  });
});
