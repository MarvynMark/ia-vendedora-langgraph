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
import { comentarioAutoavaliacao, mensagemDetalhes, mensagemErros, mensagemModelo, mensagemPrincipal } from "../../src/corretor/devolutiva.ts";
import { errosRecorrentes, historicoParaIA, linhaEvolucao } from "../../src/corretor/historico.ts";
import { interpretarNotaEstimada } from "../../src/corretor/regras.ts";
import type { CorrecaoSalva } from "../../src/corretor/sessao.ts";
import type { AvaliacaoIA } from "../../src/corretor/tipos.ts";

function avaliacao(parcial: Partial<AvaliacaoIA> = {}): AvaliacaoIA {
  return {
    oQueAQuestaoExigia: "Explicar X e diferenciar Y.",
    espelho: [
      { elemento: "Conceito de X", origem: "EXIGIDO", status: "ATENDIDO", comentario: "ok" },
      { elemento: "Exemplos de X", origem: "EXIGIDO", status: "PARCIAL", comentario: "só um exemplo" },
      { elemento: "Bloqueador de escrita", origem: "APROFUNDAMENTO", status: "NAO_ATENDIDO", comentario: "" },
    ],
    criterios: {
      TX: { faixa: "B", nota: 4, justificativa: "a" },
      AR: { faixa: "B", nota: 3.5, justificativa: "b" },
      CA: { faixa: "B", nota: 4, justificativa: "c" },
      EC: { faixa: "C", nota: 6.5, justificativa: "d" },
    },
    errosPortugues: [
      { linha: 2, trecho: "pericia", correcao: "perícia", tipo: "acentuação", regra: "Toda proparoxítona é acentuada." },
      { linha: 5, trecho: "a nível", correcao: "em nível", tipo: "propriedade vocabular", regra: "Em nível de." },
      { linha: 9, trecho: "haviam", correcao: "havia", tipo: "concordância", regra: "Haver no sentido de existir é impessoal." },
    ],
    fugaAoTema: false,
    identificacaoIndevida: false,
    dominado: { oQue: "Definiu com precisão o conceito central.", trecho: "o concurso de pessoas ocorre" },
    pontoDeVirada: { problema: "Faltou o liame subjetivo (linhas 04-05).", porQueImporta: "É requisito imprescindível no padrão oficial.", comoFazer: "Liste os quatro requisitos na mesma frase." },
    antesDepois: { linhas: "04 a 05", antes: "São requisitos: pluralidade", depois: "São requisitos: pluralidade e liame subjetivo", oQueMudou: ["acrescentei o liame → completa os requisitos"] },
    desafio: { instrucao: "Reescreva as linhas 04 a 05 com os quatro requisitos.", criterioSucesso: "Os quatro requisitos aparecem." },
    outrosAjustes: ["ajuste 1", "ajuste 2"],
    evolucao: "",
    espelhoIdeal: ["e1"],
    respostaModelo: "modelo",
    mensagemFinal: "Bom caminho.",
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

  test("comandos depois da correção", () => {
    expect(interpretarComando("DETALHES")).toEqual({ tipo: "detalhes" });
    expect(interpretarComando("erros")).toEqual({ tipo: "erros" });
    expect(interpretarComando("Modelo")).toEqual({ tipo: "modelo" });
    expect(interpretarComando("reescrever")).toEqual({ tipo: "reescrever" });
    expect(interpretarComando("quais foram meus erros?")).toBeNull();
  });

  test("nota estimada pelo aluno", () => {
    expect(interpretarNotaEstimada("18", 25)).toBe(18);
    expect(interpretarNotaEstimada("acho que uns 17,5", 25)).toBe(17.5);
    expect(interpretarNotaEstimada("30", 25)).toBeNull();
    expect(interpretarNotaEstimada("entre 15 e 18", 25)).toBeNull();
    expect(interpretarNotaEstimada("ok", 25)).toBeNull();
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
    expect(p).toContain("Questão 1 (101)");          // sem área: só a questão comum do padrão oficial
    expect(p).not.toContain("Questão 2 (101)");
    expect(perfilPcdf.promptSistema("103")).toContain("Three Way Handshake"); // padrão da área do aluno
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

  test("nota fica dentro da faixa escolhida pela IA (rubrica verificável)", () => {
    const c = calcularNota(perfilPcdf, avaliacao({ criterios: {
      TX: { faixa: "A", nota: 7, justificativa: "" },     // acima do teto da faixa A → 5
      AR: { faixa: "B", nota: 4.8, justificativa: "" },   // nota de faixa A com faixa B → 4
      CA: { faixa: "C", nota: 1, justificativa: "" },     // abaixo do piso da faixa C → 2,5
      EC: { faixa: "Z", nota: 12, justificativa: "" },    // faixa inválida → só o máximo do critério
    } }), linhas(15));
    expect(c.criterios.map((x) => x.nota)).toEqual([5, 4, 2.5, 10]);
    expect(c.criterios.map((x) => x.faixa?.codigo ?? null)).toEqual(["A", "B", "C", null]);
    expect(c.dq).toBe(21.5);
  });

  test("AR sai da contagem do espelho: aprofundamento ausente não rebaixa (caso do teste de 13/10)", () => {
    const tudoAtendido = avaliacao({
      espelho: [
        { elemento: "voláteis x não voláteis", origem: "EXIGIDO", status: "ATENDIDO", comentario: "" },
        { elemento: "hash", origem: "EXIGIDO", status: "ATENDIDO", comentario: "" },
        { elemento: "bloqueador de escrita", origem: "APROFUNDAMENTO", status: "NAO_ATENDIDO", comentario: "" },
      ],
      criterios: { ...avaliacao().criterios, AR: { faixa: "B", nota: 4, justificativa: "faltou write-blocker" } },
    });
    const ar = calcularNota(perfilPcdf, tudoAtendido, linhas(14)).criterios[1]!;
    expect(ar.faixa?.codigo).toBe("A");
    expect(ar.faixaAjustada).toBe(true);
    expect(ar.nota).toBe(4.5);
  });

  test("item exigido ausente: AR cai para C e EC fica no máximo em C", () => {
    const umAusente = avaliacao({
      espelho: [
        { elemento: "a", origem: "EXIGIDO", status: "ATENDIDO", comentario: "" },
        { elemento: "b", origem: "EXIGIDO", status: "NAO_ATENDIDO", comentario: "" },
      ],
      criterios: { ...avaliacao().criterios, AR: { faixa: "A", nota: 5, justificativa: "" }, EC: { faixa: "A", nota: 9.5, justificativa: "" } },
    });
    const c = calcularNota(perfilPcdf, umAusente, linhas(14));
    expect(c.criterios[1]!.faixa?.codigo).toBe("C");
    expect(c.criterios[3]!.faixa?.codigo).toBe("C");
    expect(c.criterios[3]!.nota).toBe(6.5);
  });

  test("TX: sem item ausente, no mínimo faixa B; com item ausente, no máximo C", () => {
    const semAusente = avaliacao({ criterios: { ...avaliacao().criterios, TX: { faixa: "C", nota: 3, justificativa: "" } } });
    expect(calcularNota(perfilPcdf, semAusente, linhas(14)).criterios[0]!.faixa?.codigo).toBe("B");
    const comAusente = avaliacao({
      espelho: [{ elemento: "a", origem: "EXIGIDO", status: "NAO_ATENDIDO", comentario: "" }],
      criterios: { ...avaliacao().criterios, TX: { faixa: "A", nota: 5, justificativa: "" } },
    });
    expect(calcularNota(perfilPcdf, comAusente, linhas(14)).criterios[0]!.faixa?.codigo).toBe("C");
  });

  test("informação incorreta: AR no máximo C, com a gravidade julgada pela IA", () => {
    const comErro = avaliacao({
      espelho: [{ elemento: "a", origem: "EXIGIDO", status: "INCORRETO", comentario: "" }],
      criterios: { ...avaliacao().criterios, AR: { faixa: "D", nota: 1.5, justificativa: "" } },
    });
    expect(calcularNota(perfilPcdf, comErro, linhas(14)).criterios[1]!.faixa?.codigo).toBe("D");
    const leve = avaliacao({
      espelho: [{ elemento: "a", origem: "EXIGIDO", status: "INCORRETO", comentario: "" }],
      criterios: { ...avaliacao().criterios, AR: { faixa: "A", nota: 5, justificativa: "" } },
    });
    expect(calcularNota(perfilPcdf, leve, linhas(14)).criterios[1]!.faixa?.codigo).toBe("C");
  });

  test("rubrica do prompt sai dos mesmos números que o código confere", () => {
    const p = perfilPcdf.promptSistema(null);
    expect(p).toContain("Faixa A (9,00 a 10,00)");
    expect(p).toContain("Aprofundamento ausente nunca rebaixa de faixa");
  });

  test("texto digitado curto (estimado) não zera: só avisa", () => {
    const c = calcularNota(perfilPcdf, avaliacao(), linhas(7), true);
    expect(c.zero).toBeNull();
    expect(c.curtoEstimado).toBe(true);
    expect(c.nq).toBeGreaterThan(0);
  });

  test("texto depois da 15ª linha é desconsiderado: TL = 15 e erro da linha 16 não conta", () => {
    const a = avaliacao({ errosPortugues: [
      { linha: 3, trecho: "x", correcao: "y", tipo: "grafia", regra: "" },
      { linha: 16, trecho: "x", correcao: "y", tipo: "grafia", regra: "" },
    ] });
    const c = calcularNota(perfilPcdf, a, linhas(18));
    expect(c.tl).toBe(15);
    expect(c.ne).toBe(1);
    expect(c.linhasDescartadas).toBe(3);
  });

  test("texto digitado (linhas estimadas) não é cortado: TL limitado a 15 e aviso do excedente", () => {
    const a = avaliacao({ errosPortugues: [
      { linha: 18, trecho: "x", correcao: "y", tipo: "grafia", regra: "" },
    ] });
    const c = calcularNota(perfilPcdf, a, linhas(21), true);
    expect(c.tl).toBe(15);
    expect(c.linhasDescartadas).toBe(0);
    expect(c.excedenteEstimado).toBe(6);
    expect(c.ne).toBe(1); // erro da linha 18 conta: o texto inteiro foi avaliado
    const [m2] = mensagemDetalhes(perfilPcdf, a, c, { linhasEstimadas: true });
    expect(m2).toContain("ficaria com cerca de 21 linhas na folha");
    expect(m2).toContain("estimativa, não contagem");
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
    const erros = Array.from({ length: 30 }, (_, i) => ({ linha: (i % 10) + 1, trecho: "x", correcao: "y", tipo: "grafia", regra: "" }));
    const c = calcularNota(perfilPcdf, avaliacao({
      criterios: { TX: { faixa: "E", nota: 0.5, justificativa: "" }, AR: { faixa: "E", nota: 0, justificativa: "" }, CA: { faixa: "E", nota: 0, justificativa: "" }, EC: { faixa: "E", nota: 0, justificativa: "" } },
      espelho: [
        { elemento: "a", origem: "EXIGIDO", status: "NAO_ATENDIDO", comentario: "" },
        { elemento: "b", origem: "EXIGIDO", status: "NAO_ATENDIDO", comentario: "" },
      ],
      errosPortugues: erros,
    }), linhas(10));
    expect(c.nqCalculada).toBeLessThan(0);
    expect(c.nq).toBe(0);
    expect(c.zero).toBeNull();
  });
});

function correcaoAnterior(nota: number, tipos: string[], dias: number): CorrecaoSalva {
  return {
    id: dias, concurso: "pcdf", area: null, codigoQuestao: null, enunciado: "e", transcricao: [], calculo: null,
    nota, autoavaliacao: null, criadoEm: new Date(Date.UTC(2026, 9, 13 - dias, 15)),
    avaliacao: { pontoDeVirada: { problema: `foco ${dias}` }, errosPortugues: tipos.map((tipo) => ({ tipo })) },
  };
}

describe("devolutiva (divulgação progressiva)", () => {
  const meta = { linhasEstimadas: false, codigoQuestao: "G01", autoavaliacao: null, anteriores: [] as CorrecaoSalva[] };

  test("mensagem principal: nota + UM foco + antes → depois + desafio + menu, numa mensagem só", () => {
    const a = avaliacao();
    const msgs = mensagemPrincipal(perfilPcdf, a, calcularNota(perfilPcdf, a, linhas(14)), meta);
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m).toContain("*Nota estimada: 17,79 / 25,00*");
    expect(m).toContain("não é nota oficial");
    expect(m).toContain("EC 6,50 (C)");
    expect(m).toContain("🎯 *Seu ponto de virada*");
    expect(m).toContain("✍️ *Antes → depois* (linhas 04 a 05)");
    expect(m).toContain("🏋️ *Seu desafio");
    expect(m).toContain("*REESCREVER*");
    expect(m).toContain("*DETALHES*");
    // o detalhe técnico NÃO entra na mensagem principal
    expect(m).not.toContain("Memória de cálculo");
    expect(m).not.toContain("Resposta-modelo");
    expect(m).not.toContain("ajuste 1");
  });

  test("DETALHES: espelho, faixas, cálculo; aprofundamento ausente é sugestão, não falha", () => {
    const a = avaliacao();
    const m = mensagemDetalhes(perfilPcdf, a, calcularNota(perfilPcdf, a, linhas(14)), meta).join("\n");
    expect(m).toContain("NQ = DQ − (NE / TL) = 18,00 − (3 / 14) = 17,79");
    expect(m).toContain("✅ ATENDIDO");
    expect(m).toContain("Bloqueador de escrita — 💡 poderia agregar");
    expect(m).not.toContain("❌");
    expect(m).toContain("ajuste 1");
  });

  test("ERROS: agrupados por tipo, com a regra", () => {
    const m = mensagemErros(perfilPcdf, avaliacao(), meta).join("\n");
    expect(m).toContain("*Acentuação (1)*");
    expect(m).toContain("📌 Toda proparoxítona é acentuada.");
    expect(mensagemErros(perfilPcdf, avaliacao({ errosPortugues: [] }), meta)[0]).toContain("Nenhum erro efetivo");
  });

  test("MODELO: referência de nível, com o aviso de não oficial", () => {
    const m = mensagemModelo(perfilPcdf, avaliacao()).join("\n");
    expect(m).toContain("Resposta-modelo");
    expect(m).toContain("Não é nota oficial da banca");
  });

  test("questão zerada explica o motivo na mensagem principal", () => {
    const a = avaliacao();
    const [m] = mensagemPrincipal(perfilPcdf, a, calcularNota(perfilPcdf, a, linhas(8)), meta);
    expect(m).toContain("*Nota estimada: 0,00 / 25,00*");
    expect(m).toContain("8 linha(s), abaixo do mínimo de 10");
  });

  test("autoavaliação: calibrada, acima e abaixo", () => {
    expect(comentarioAutoavaliacao(17, 16.5)).toContain("Boa calibragem");
    expect(comentarioAutoavaliacao(22, 16)).toContain("item do comando");
    expect(comentarioAutoavaliacao(12, 18)).toContain("melhor do que você acha");
    const a = avaliacao();
    const [m] = mensagemPrincipal(perfilPcdf, a, calcularNota(perfilPcdf, a, linhas(14)), { ...meta, autoavaliacao: 22 });
    expect(m).toContain("Você estimou 22,00; a correção deu 17,79.");
  });
});

describe("histórico do aluno", () => {
  const anteriores = [correcaoAnterior(18.4, ["acentuação"], 1), correcaoAnterior(16.1, ["acentuação", "regência"], 3)];

  test("evolução em ordem cronológica, com a atual em destaque", () => {
    expect(linhaEvolucao(anteriores, 21.35)).toBe("16,10 → 18,40 → *21,35*");
    expect(linhaEvolucao([], 20)).toBeNull();
  });

  test("erro que aparece em 3 correções seguidas vira padrão recorrente", () => {
    expect(errosRecorrentes(anteriores, [{ tipo: "Acentuação" }, { tipo: "grafia" }])).toEqual([{ tipo: "acentuação", vezes: 3, de: 3 }]);
    expect(errosRecorrentes(anteriores.slice(0, 1), [{ tipo: "acentuação" }])).toEqual([]); // pouco histórico
  });

  test("histórico para a IA traz nota, foco anterior e erros por tipo", () => {
    const h = historicoParaIA(anteriores);
    expect(h).toContain("nota 18,40");
    expect(h).toContain("foco 1");
    expect(h).toContain("acentuação 1, regência 1");
    expect(historicoParaIA([])).toBe("");
  });

  test("mensagem principal mostra a evolução quando há histórico", () => {
    const a = avaliacao({ evolucao: "Agora você listou os requisitos." });
    const [m] = mensagemPrincipal(perfilPcdf, a, calcularNota(perfilPcdf, a, linhas(14)), { linhasEstimadas: false, codigoQuestao: null, autoavaliacao: null, anteriores });
    expect(m).toContain("📈 *Sua evolução:* 16,10 → 18,40 → *17,79*");
    expect(m).toContain("Agora você listou os requisitos.");
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
