// Espelho EXIGIDO da questão: montado a partir SÓ do enunciado, antes de ler qualquer resposta, e
// guardado por enunciado. Antes, a IA montava o espelho junto com a correção, já lendo a resposta:
// a mesma resposta ganhou 23,60 e 21,50 porque numa rodada o "cenário ligado e conectado" virou
// item exigido e na outra, aprofundamento — e o espelho se adaptava ao que o aluno escreveu.
import { createHash } from "node:crypto";
import { logger } from "../lib/logger.ts";
import { chamarJson } from "./openai.ts";
import { normalizar } from "./regras.ts";
import { buscarEspelhoSalvo, salvarEspelho } from "./sessao.ts";
import type { PerfilConcurso } from "./tipos.ts";

const PROMPT_ESPELHO = `Você monta o espelho técnico de uma questão discursiva de concurso a partir SOMENTE do enunciado, antes de ler qualquer resposta.

Liste os elementos EXIGIDOS: o que o comando pede expressamente.
- Granularidade (siga à risca, para que a mesma questão gere sempre o mesmo espelho):
  • um elemento por AÇÃO pedida sobre cada OBJETO: "diferencie X e Y, apresentando exemplos" → "diferença entre X e Y" + "exemplos de X e de Y"; "a finalidade de H e sua importância para I" → "finalidade de H" + "importância de H para I"; "procedimentos de preservação e aquisição" → "procedimentos de preservação" + "procedimentos de aquisição";
  • qualidades do MESMO objeto ficam juntas: "importância de C para a validade e a confiabilidade" → um elemento só.
- Cada elemento diz o que precisa aparecer na resposta, de forma concreta e verificável, no MESMO nível de especificidade do comando. Se o comando diz "procedimentos adequados de preservação", o elemento é "procedimentos de preservação" — técnicas específicas (isolar a rede, bloqueador de escrita, bolsa de Faraday…) entram apenas como EXEMPLOS aceitos no "atendidoSe", nunca como elementos próprios.
- Exceção: quando o comando NOMEIA um conjunto fechado e conhecido (os requisitos de X, as etapas de Y, as fases de Z), crie UM elemento para CADA componente que a doutrina ou a técnica consolidada considera indispensável, nomeando-o (ex.: "descreva as etapas da PCR" → desnaturação; anelamento dos iniciadores; extensão). É assim que a banca corrige: veja o exemplo de padrão oficial abaixo.
- NÃO inclua condutas, técnicas ou conhecimentos que o comando não pede, por mais relevantes que sejam: eles são aprofundamento, não exigência.
- Se o enunciado narra um caso, NÃO crie um elemento só de "aplicar ao caso": a aplicação ao caso é avaliada na elaboração crítica. Só crie elemento sobre o caso se o comando pedir algo expressamente sobre ele (ex.: "no caso descrito, indique…").
- NÃO inclua requisitos de forma (gênero textual, número de linhas, extensão, letra): o sistema confere isso separadamente.
- Em "comando", copie o trecho do enunciado que exige o elemento.
- Em "atendidoSe", escreva o critério mínimo e objetivo para o elemento contar como ATENDIDO, no nível de exigência da banca (o que basta, não o ideal). Ex.: "ATENDIDO se citar ao menos uma medida concreta de preservação (ex.: documentar o estado, isolar quando indicado, coletar voláteis); PARCIAL se só disser que é preciso preservar, sem medida concreta". Esse critério fixa a fronteira entre ATENDIDO e PARCIAL para todas as correções desta questão. Quando houver várias condutas tecnicamente adequadas, o critério aceita QUALQUER uma delas (lista aberta de exemplos), não uma conduta preferida.`;


const SCHEMA_ITENS_ESPELHO = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: { elemento: { type: "string" }, comando: { type: "string" }, atendidoSe: { type: "string" } },
        required: ["elemento", "comando", "atendidoSe"],
        additionalProperties: false,
      },
    },
  },
  required: ["itens"],
  additionalProperties: false,
};

export interface ItemEspelho {
  elemento: string;
  comando: string;
  atendidoSe: string;
}

/** Itens EXIGIDOS do espelho, montados só a partir do enunciado (sem ver a resposta). */
export async function montarEspelhoExigido(perfil: PerfilConcurso, enunciado: string): Promise<ItemEspelho[]> {
  const r = await chamarJson<{ itens: ItemEspelho[] }>(
    `${PROMPT_ESPELHO}\n\nConcurso: ${perfil.nome} (${perfil.banca}).\n\nEXEMPLO DE PADRÃO OFICIAL DA BANCA (granularidade de referência; não é a questão a corrigir):\n${perfil.exemploEspelhoOficial}`,
    [{ type: "text", text: `ENUNCIADO:\n${enunciado}` }],
    "espelho_exigido",
    SCHEMA_ITENS_ESPELHO,
  );
  return r.itens.filter((i) => i.elemento.trim());
}

/**
 * Espelho da questão por maioria: monta 3 em paralelo e fica com o de estrutura (nº de itens) mais
 * frequente. A montagem única variava (o mesmo enunciado saía com 6 ou 7 itens), e o espelho
 * escolhido fica salvo como a régua da questão — só acontece uma vez por enunciado.
 */
export async function montarEspelhoPorMaioria(perfil: PerfilConcurso, enunciado: string): Promise<ItemEspelho[]> {
  const tentativas = (await Promise.allSettled([1, 2, 3].map(() => montarEspelhoExigido(perfil, enunciado))))
    .flatMap((t) => (t.status === "fulfilled" && t.value.length ? [t.value] : []));
  if (!tentativas.length) throw new Error("[corretor] Nenhuma montagem de espelho deu certo");
  const contagem = new Map<number, number>();
  for (const t of tentativas) contagem.set(t.length, (contagem.get(t.length) ?? 0) + 1);
  const maisFrequente = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  return tentativas.find((t) => t.length === maisFrequente)!;
}

export function chaveEspelho(perfil: PerfilConcurso, enunciado: string): string {
  return createHash("sha256").update(`${perfil.codigo}|${normalizar(enunciado)}`).digest("hex");
}

/** Espelho salvo do enunciado, ou monta e salva. Sem banco, monta mesmo assim (só não reaproveita). */
export async function obterEspelhoExigido(perfil: PerfilConcurso, enunciado: string): Promise<ItemEspelho[]> {
  const chave = chaveEspelho(perfil, enunciado);
  try {
    const salvo = await buscarEspelhoSalvo(chave);
    if (salvo?.length && salvo.every((i) => i.atendidoSe)) return salvo as ItemEspelho[];
  } catch (e) {
    logger.warn("corretor", "Sem cache de espelho (banco indisponível); montando na hora", e);
  }
  const itens = await montarEspelhoPorMaioria(perfil, enunciado);
  try {
    await salvarEspelho(chave, perfil.codigo, enunciado, itens);  // ON CONFLICT: ver salvarEspelho
  } catch (e) {
    logger.warn("corretor", "Falha ao salvar espelho", e);
  }
  return itens;
}
