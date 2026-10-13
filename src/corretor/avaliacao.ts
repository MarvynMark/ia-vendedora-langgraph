// Avaliação da resposta: o "professor" classifica o espelho fixo, escolhe as faixas da rubrica,
// lista os erros e monta a devolutiva pedagógica (ponto de virada, antes → depois, desafio).
// A nota é do código (calcularNota); aqui não há conta.
//
// Usa ChatOpenAI + structured output, como o resto do app, para cair no Langfuse.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import { criarLangfuseHandler, finalizarLangfuseHandler } from "../lib/langfuse.ts";
import type { ItemEspelho } from "./espelho.ts";
import { corrigirRegrasDeLingua } from "./lingua.ts";
import { type CalculoNota, calcularNota, numerarLinhas } from "./regras.ts";
import type { AvaliacaoIA, PerfilConcurso, StatusEspelho } from "./tipos.ts";

// Como ensinar vale para qualquer concurso; o perfil diz o que cobrar.
const PEDAGOGIA = readFileSync(new URL("./pedagogia.md", import.meta.url), "utf-8").trim();

const STATUS = ["ATENDIDO", "PARCIAL", "NAO_ATENDIDO", "INCORRETO"] as const;

function schemaAvaliacao(perfil: PerfilConcurso) {
  const criterios = Object.fromEntries(perfil.criterios.map((c) => [
    c.sigla,
    z.object({
      faixa: z.enum(c.faixas.map((f) => f.codigo) as [string, ...string[]])
        .describe(`Faixa da rubrica de ${c.nome} cujo descritor corresponde à resposta.`),
      nota: z.number().describe(`Nota de ${c.nome} DENTRO da faixa escolhida, com até duas casas decimais.`),
      justificativa: z.string().describe("Qual descritor da faixa se aplica e o trecho do aluno que comprova. Se não for a faixa máxima, o item EXIGIDO que impediu."),
    }),
  ]));
  return z.object({
    oQueAQuestaoExigia: z.string().describe("O comando explicado em linguagem simples: verbos, subitens e recortes."),
    espelhoExigido: z.array(z.object({
      item: z.number().int().describe("Número do item no ESPELHO EXIGIDO recebido."),
      status: z.enum(STATUS),
      comentario: z.string().describe("O que o aluno efetivamente escreveu sobre esse item (curto, citando o texto e a linha)."),
    })).describe("Uma classificação para CADA item do espelho exigido, na mesma ordem."),
    aprofundamentos: z.array(z.object({
      elemento: z.string().describe("Conhecimento complementar, não pedido pelo comando."),
      status: z.enum(STATUS),
      comentario: z.string(),
    })).describe("No máximo 3. Valorizam a resposta; a ausência não desconta. INCORRETO se o aluno afirmou algo errado."),
    criterios: z.object(criterios),
    errosPortugues: z.array(z.object({
      linha: z.number().int().describe("Número da linha da transcrição onde está o erro."),
      trecho: z.string(),
      correcao: z.string(),
      tipo: z.string().describe("acentuação, grafia, pontuação, concordância, regência, morfossintaxe, propriedade vocabular ou translineação"),
      regra: z.string().describe("A regra em UMA frase, para o aluno aplicar sozinho na próxima vez."),
    })).describe("Cada erro efetivo uma única vez. Vazio se não houver."),
    fugaAoTema: z.boolean(),
    identificacaoIndevida: z.boolean().describe("Nome, assinatura ou marca que identifique o candidato no texto."),
    dominado: z.object({
      oQue: z.string().describe("UMA coisa que a resposta fez bem, dita como estratégia a repetir."),
      trecho: z.string().describe("O trecho do aluno que mostra isso (cópia exata, curta)."),
    }),
    pontoDeVirada: z.object({
      problema: z.string().describe("A ÚNICA mudança que mais renderia nota, citando a linha."),
      porQueImporta: z.string().describe("UMA frase: o efeito concreto na nota e no olhar da banca."),
      comoFazer: z.string().describe("A ação, em no máximo 2 frases curtas, executável na próxima resposta."),
    }),
    antesDepois: z.object({
      linhas: z.string().describe('Linhas do trecho, ex.: "04 a 06".'),
      antes: z.string().describe("Cópia exata do trecho do aluno ligado ao ponto de virada (2 a 4 linhas)."),
      depois: z.string().describe("O mesmo trecho com a MENOR mudança que resolve o ponto de virada, no estilo do aluno."),
      oQueMudou: z.array(z.string()).describe("2 ou 3 itens: mudança → efeito."),
    }),
    desafio: z.object({
      instrucao: z.string().describe("Tarefa curta de reescrita (2 a 5 linhas) que pratica UMA habilidade só — a do ponto de virada —, sem entregar a resposta. Nada de pedir duas coisas."),
      criterioSucesso: z.string().describe("Como verificar objetivamente se o aluno conseguiu."),
    }),
    outrosAjustes: z.array(z.string()).describe("No máximo 2 ajustes secundários, depois do ponto de virada."),
    evolucao: z.string().describe("Comparação com o HISTÓRICO: o que melhorou (com evidência) e o que persiste. Vazio se não houver histórico."),
    espelhoIdeal: z.array(z.string()).describe("O que apareceria numa resposta nota máxima, na ordem do comando."),
    respostaModelo: z.string().describe("Resposta de alto nível, em texto corrido, cabendo nas linhas do edital."),
    mensagemFinal: z.string().describe("UMA frase de fechamento do Professor Vestigium, sem repetir o ponto de virada: direta, sem bajulação."),
  });
}

export interface EntradaAvaliacao {
  perfil: PerfilConcurso;
  area: string | null;
  enunciado: string;
  exigidos: ItemEspelho[];
  linhas: string[];            // as que entram na correção (manuscrito já cortado no máximo do edital)
  linhasDescartadas: number;
  digitada: boolean;
  linhasEstimadas: boolean;
  historico: string;           // historicoParaIA(); vazio na primeira correção
  telefone: string;
}

async function avaliarUmaVez(e: EntradaAvaliacao): Promise<AvaliacaoIA> {
  const modelo = new ChatOpenAI({
    modelName: env.CORRETOR_MODELO,
    openAIApiKey: env.OPENAI_API_KEY,
    timeout: 240_000,
  }).withStructuredOutput(schemaAvaliacao(e.perfil), { name: "correcao_discursiva" });

  const origem = e.digitada
    ? `Resposta DIGITADA pelo aluno no WhatsApp${e.linhasEstimadas ? " — as linhas abaixo são uma ESTIMATIVA do sistema, não a folha do aluno: avalie o texto INTEIRO, não conte translineação e NÃO comente nem desconte nada pela quantidade de linhas (o sistema trata disso)" : " — linhas quebradas pelo próprio aluno"}.`
    : "Resposta MANUSCRITA, transcrita da foto/PDF e conferida pelo aluno.";
  const entrada = [
    `COMANDO DA QUESTÃO:\n${e.enunciado}`,
    origem,
    `ESPELHO EXIGIDO (fixo, montado a partir do enunciado — classifique cada item pelo critério dele; não acrescente nem remova itens exigidos):\n${e.exigidos.map((x, i) => `${i + 1}. ${x.elemento} [comando: "${x.comando}"]${x.atendidoSe ? `\n   Critério: ${x.atendidoSe}` : ""}`).join("\n")}`,
    e.historico ? `HISTÓRICO DO ALUNO NESTE CONCURSO (mais recente primeiro):\n${e.historico}` : "HISTÓRICO DO ALUNO: esta é a primeira correção dele.",
    `RESPOSTA DO ALUNO (${e.linhas.length} linha(s) consideradas${e.linhasDescartadas ? `; ${e.linhasDescartadas} linha(s) após a ${e.perfil.linhasMax}ª foram desconsideradas e não aparecem aqui` : ""}):\n${numerarLinhas(e.linhas)}`,
  ].join("\n\n");

  const handler = criarLangfuseHandler("corretor-redacao", {
    sessionId: e.telefone,
    tags: ["corretor", e.perfil.codigo],
    metadata: { area: e.area, digitada: e.digitada },
  });
  try {
    const r = await modelo.invoke(
      [
        { role: "system", content: `${e.perfil.promptSistema(e.area)}\n\n---\n\n${PEDAGOGIA}` },
        { role: "user", content: entrada },
      ],
      handler ? { callbacks: [handler] } : undefined,
    );
    type Bruta = Omit<AvaliacaoIA, "espelho"> & {
      espelhoExigido: Array<{ item: number; status: StatusEspelho; comentario: string }>;
      aprofundamentos: Array<{ elemento: string; status: StatusEspelho; comentario: string }>;
    };
    const { espelhoExigido, aprofundamentos, ...resto } = r as unknown as Bruta;
    // Item exigido que a IA não classificou não pode sumir do espelho (nem da contagem da faixa).
    const espelho: AvaliacaoIA["espelho"] = e.exigidos.map((x, i) => {
      const c = espelhoExigido.find((y) => y.item === i + 1);
      return c
        ? { elemento: x.elemento, origem: "EXIGIDO" as const, status: c.status, comentario: c.comentario }
        : { elemento: x.elemento, origem: "EXIGIDO" as const, status: "NAO_ATENDIDO" as const, comentario: "(não classificado pela correção)" };
    });
    for (const a of aprofundamentos.slice(0, 3)) espelho.push({ ...a, origem: "APROFUNDAMENTO" });
    return {
      ...resto,
      errosPortugues: corrigirRegrasDeLingua(resto.errosPortugues),
      outrosAjustes: resto.outrosAjustes.slice(0, 2),
      espelho,
    };
  } finally {
    await finalizarLangfuseHandler(handler);
  }
}

/**
 * Avalia e calcula a nota. Com CORRETOR_VOTOS > 1, roda as avaliações em paralelo e entrega a de
 * nota mediana: um item de fronteira (atendido × parcial) mudava a nota em ~3 pontos entre rodadas
 * da mesma resposta. Custa N vezes, mas o tempo é o de uma.
 */
export async function avaliarResposta(
  e: EntradaAvaliacao,
  todasAsLinhas: string[],
): Promise<{ avaliacao: AvaliacaoIA; calculo: CalculoNota }> {
  const votos = Math.max(1, Math.min(5, env.CORRETOR_VOTOS));
  const resultados = (await Promise.allSettled(Array.from({ length: votos }, () => avaliarUmaVez(e))))
    .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!resultados.length) throw new Error("[corretor] Nenhuma avaliação deu certo");
  const comNota = resultados
    .map((avaliacao) => ({ avaliacao, calculo: calcularNota(e.perfil, avaliacao, todasAsLinhas, e.linhasEstimadas) }))
    .sort((a, b) => a.calculo.nq - b.calculo.nq);
  return comNota[Math.floor((comNota.length - 1) / 2)]!;
}
