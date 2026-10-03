/**
 * Destila as intervenções humanas (saída do extrair-intervencoes.ts) em:
 *   - candidatos-rag.json   → roteiros de objeção para o RAG, a revisar antes de ingerir
 *   - relatorio-padroes.md  → o que o Gusthavo e o Pedro fazem que fecha venda (base pros ajustes no prompt)
 *
 * Uso: OPENAI_API_KEY=... bun run src/scripts/destilar-intervencoes.ts
 *
 * Map (modelo mini, lotes de intervenções): cada intervenção vira um registro estruturado —
 * objeção, frases do lead, técnica, resposta reutilizável anonimizada, se depende de algo que só
 * humano oferece (cupom, desconto, condição, promessa pessoal) e se o lead avançou.
 * Reduce (modelo principal, por objeção): roteiro candidato + padrões.
 *
 * Tudo fica em dados-locais/intervencoes/ (fora do git). Nada aqui escreve no banco nem no prompt.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import type { Intervencao } from "./extrair-intervencoes.ts";

const DIR = "dados-locais/intervencoes";
const LOTE_MAP = 8;
const CONCORRENCIA = 4;

export const OBJECOES = [
  "preco",              // "tá caro", "não tenho esse valor"
  "forma_pagamento",    // cartão sem limite, pix, boleto, parcelas
  "adiamento",          // "vou pensar", "depois", "mês que vem", "quando sair o edital"
  "tempo",              // "não tenho tempo", rotina, trabalho
  "confianca",          // "funciona mesmo?", "é golpe?", prova social
  "edital_concurso",    // sem edital, qual concurso, vagas
  "formacao_area",      // graduação aceita, área do cargo
  "material_curso",     // já tenho cursinho/material, diferença pra cursinho
  "terceiros",          // marido/esposa/pais precisam aprovar
  "concorrencia",       // outra mentoria/cursinho
  "duvida_produto",     // como funciona, acesso, duração, acompanhamento
  "engajamento",        // lead sumido/frio: humano reabre a conversa
  "sem_objecao",        // logística, boas-vindas, envio de link sem resistência
] as const;

export interface RegistroMap {
  conversa: number;
  fase: Intervencao["fase"];
  autores: string[];
  objecao: (typeof OBJECOES)[number];
  gatilhos_lead: string[];
  tecnica: string;
  resposta_reutilizavel: string;
  so_humano: boolean;
  motivo_so_humano?: string;
  lead_avancou: boolean;
}

function log(m: string) {
  console.log(`[destilar] ${m}`);
}

const mini = new ChatOpenAI({ modelName: env.OPENAI_MODEL_MINI, openAIApiKey: env.OPENAI_API_KEY, temperature: 0.2, timeout: 120_000 });
const principal = new ChatOpenAI({ modelName: env.OPENAI_MODEL, openAIApiKey: env.OPENAI_API_KEY, temperature: 0.3, timeout: 300_000 });

async function invocar(model: ChatOpenAI, prompt: string): Promise<string> {
  const res = await model.invoke(prompt);
  return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
}

/** Tira o JSON da resposta (o modelo às vezes embrulha em ```json). */
export function extrairJson<T>(texto: string): T {
  const limpo = texto.replace(/^[\s\S]*?```(?:json)?\s*/i, "").replace(/```[\s\S]*$/, "");
  const alvo = /^[\s[{]/.test(limpo) ? limpo : texto;
  const ini = alvo.search(/[[{]/);
  return JSON.parse(alvo.slice(ini).trim()) as T;
}

const REGRAS_ANONIMIZAR =
  "Anonimize: troque nomes de pessoas por [lead], tire telefone, e-mail, link, cupom, valores em R$ e número de parcelas. " +
  "Nomes do Walker/Perito Walker e da mentoria podem ficar.";

function promptMap(lote: Intervencao[]): string {
  const blocos = lote.map((it, i) =>
    `### INTERVENÇÃO ${i}\nfase: ${it.fase}\nCONTEXTO:\n${it.contexto.join("\n") || "(início)"}\nGATILHO (o que o lead disse):\n${it.gatilho.join("\n") || "(nenhuma fala imediatamente antes: o humano puxou a conversa)"}\nRESPOSTA DO HUMANO:\n${it.resposta.join("\n")}\nREAÇÃO DO LEAD:\n${it.reacao.join("\n") || "(sem reação registrada antes da venda)"}`,
  ).join("\n\n");
  return `Você analisa vendas da mentoria do Perito Walker (concursos de Perito Criminal). Abaixo há ${lote.length} trechos REAIS em que um vendedor humano (Gusthavo ou Pedro) entrou na conversa de alguém que DEPOIS COMPROU.

Para cada intervenção, devolva um objeto JSON com:
- "i": o número da intervenção
- "objecao": uma destas: ${OBJECOES.join(", ")}
- "gatilhos_lead": até 4 frases curtas como o lead falou (ou falaria) essa objeção, em português informal. Vazio se sem_objecao.
- "tecnica": em até 15 palavras, o que o humano fez (ex.: "pergunta qual parte do valor pesa e oferece parcelar no cartão de terceiro")
- "resposta_reutilizavel": a resposta do humano reescrita para ser reutilizável, até 400 caracteres, mantendo o argumento e o jeito de falar. ${REGRAS_ANONIMIZAR}
- "so_humano": true se o que destravou foi algo que só um humano pode oferecer: cupom, desconto, condição especial, preço diferente, bônus fora da oferta, ligação, promessa pessoal
- "motivo_so_humano": quando so_humano, o que era
- "lead_avancou": true se a reação do lead mostra que ele avançou (aceitou, pediu link, tirou dúvida e seguiu, pagou)

Não invente o que não está no trecho. Responda SÓ com um array JSON.

${blocos}`;
}

async function emParalelo<T, R>(itens: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let prox = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (prox < itens.length) {
      const i = prox++;
      out[i] = await fn(itens[i]!, i);
    }
  }));
  return out;
}

async function fazerMap(intervencoes: Intervencao[]): Promise<RegistroMap[]> {
  const caminho = `${DIR}/mapa.jsonl`;
  if (existsSync(caminho)) {
    log(`mapa.jsonl já existe — reaproveitando (apague para refazer)`);
    return readFileSync(caminho, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as RegistroMap);
  }
  const lotes: Intervencao[][] = [];
  for (let i = 0; i < intervencoes.length; i += LOTE_MAP) lotes.push(intervencoes.slice(i, i + LOTE_MAP));
  const resultados = await emParalelo(lotes, CONCORRENCIA, async (lote, n) => {
    if (n % 10 === 0) log(`map ${n}/${lotes.length}`);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const arr = extrairJson<Array<Omit<RegistroMap, "conversa" | "fase" | "autores"> & { i: number }>>(await invocar(mini, promptMap(lote)));
        return arr
          .filter((r) => lote[r.i] && (OBJECOES as readonly string[]).includes(r.objecao))
          .map(({ i, ...r }) => ({ conversa: lote[i]!.conversa, fase: lote[i]!.fase, autores: lote[i]!.autores, ...r }));
      } catch (e) {
        log(`lote ${n} falhou (tentativa ${tentativa + 1}): ${(e as Error).message.slice(0, 120)}`);
      }
    }
    return [];
  });
  const registros = resultados.flat();
  writeFileSync(caminho, registros.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return registros;
}

export interface CandidatoRag {
  objecao: string;
  titulo: string;
  gatilhos: string;
  conteudo: string;
  tecnicas: string[];
  exemplos_reais: string[];
  casos: number;
  taxa_avanco: number;
  conversas: number[];
}

function promptReduceObjecao(objecao: string, regs: RegistroMap[]): string {
  const linhas = regs.map((r, i) =>
    `${i}. [${r.fase}${r.lead_avancou ? ", lead avançou" : ""}] gatilhos: ${r.gatilhos_lead.join(" | ")}\n   técnica: ${r.tecnica}\n   resposta: ${r.resposta_reutilizavel}`,
  ).join("\n");
  return `Você é estrategista de vendas da mentoria do Perito Walker (concursos de Perito Criminal). Abaixo estão ${regs.length} respostas REAIS de vendedores humanos à objeção "${objecao}", em conversas que terminaram em VENDA. Respostas que dependiam de cupom/desconto/condição especial já foram tiradas.

Agrupe em 1 a 3 VARIAÇÕES da objeção (só separe quando o lead diz coisas realmente diferentes ou a resposta que funciona é diferente). Para cada variação devolva:
- "titulo": nome curto da variação (ex.: "Preço: acha caro sem comparar")
- "gatilhos": 4 a 8 frases como o lead fala, separadas por " / " (é daqui que sai o embedding da busca)
- "conteudo": o roteiro que o Walker deve seguir, escrito como instrução para ele, com 1 a 3 mensagens curtas de exemplo entre aspas, no jeito de falar dos vendedores. Regras: sem travessão (—), no máximo 3 mensagens, sem preço, sem cupom, sem desconto, sem link, sem prometer o que não está na oferta, sem escassez inventada. Diga também o que NÃO fazer se as respostas mostrarem isso.
- "tecnicas": as técnicas que mais aparecem nas respostas que fizeram o lead avançar
- "exemplos_reais": 1 ou 2 respostas reais (copie da lista, já anonimizadas) que melhor representam a variação
- "indices": os números das respostas da lista que pertencem a essa variação

Não invente argumento que não aparece nas respostas. Responda SÓ com um array JSON.

RESPOSTAS:
${linhas}`;
}

async function fazerReduce(registros: RegistroMap[]): Promise<CandidatoRag[]> {
  const usaveis = registros.filter((r) => r.objecao !== "sem_objecao" && !r.so_humano);
  const porObjecao = new Map<string, RegistroMap[]>();
  for (const r of usaveis) porObjecao.set(r.objecao, [...(porObjecao.get(r.objecao) ?? []), r]);

  const candidatos: CandidatoRag[] = [];
  for (const [objecao, regs] of [...porObjecao.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (regs.length < 2) continue; // caso único não vira roteiro
    // Prioriza as respostas que fizeram o lead avançar; corta pra caber no contexto.
    const amostra = [...regs].sort((a, b) => Number(b.lead_avancou) - Number(a.lead_avancou)).slice(0, 120);
    log(`reduce: ${objecao} (${regs.length} casos, ${amostra.length} na amostra)`);
    try {
      const vars = extrairJson<Array<Omit<CandidatoRag, "objecao" | "casos" | "taxa_avanco" | "conversas"> & { indices: number[] }>>(
        await invocar(principal, promptReduceObjecao(objecao, amostra)),
      );
      for (const v of vars) {
        const doGrupo = (v.indices ?? []).map((i) => amostra[i]).filter((r): r is RegistroMap => !!r);
        candidatos.push({
          objecao,
          titulo: v.titulo,
          gatilhos: v.gatilhos,
          conteudo: v.conteudo,
          tecnicas: v.tecnicas ?? [],
          exemplos_reais: v.exemplos_reais ?? [],
          casos: doGrupo.length,
          taxa_avanco: doGrupo.length ? Math.round((doGrupo.filter((r) => r.lead_avancou).length / doGrupo.length) * 100) : 0,
          conversas: [...new Set(doGrupo.map((r) => r.conversa))],
        });
      }
    } catch (e) {
      log(`reduce ${objecao} falhou: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return candidatos;
}

async function fazerRelatorio(registros: RegistroMap[], intervencoes: Intervencao[]): Promise<string> {
  const contar = (f: (r: RegistroMap) => string) =>
    Object.entries(registros.reduce<Record<string, number>>((acc, r) => ((acc[f(r)] = (acc[f(r)] ?? 0) + 1), acc), {}))
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ");
  const soHumano = registros.filter((r) => r.so_humano).map((r) => `- [${r.objecao}] ${r.motivo_so_humano ?? r.tecnica}`).slice(0, 80).join("\n");
  const amostra = registros
    .filter((r) => r.objecao !== "sem_objecao")
    .sort((a, b) => Number(b.lead_avancou) - Number(a.lead_avancou))
    .slice(0, 250)
    .map((r) => `[${r.objecao}/${r.fase}/${r.autores.join("+")}${r.lead_avancou ? "/avançou" : ""}] ${r.tecnica} :: ${r.resposta_reutilizavel}`)
    .join("\n");

  const corpo = await invocar(principal, `Você é estrategista de vendas. Abaixo estão intervenções REAIS dos vendedores humanos (Gusthavo e Pedro) em conversas da mentoria do Perito Walker que viraram VENDA. Hoje uma IA conduz a conversa e quase toda venda precisa de um humano para fechar. Quero saber o que os humanos fazem que a IA deveria passar a fazer.

Escreva um relatório em markdown, português do Brasil, com estas seções:
## O que os humanos fazem diferente (padrões que se repetem, com frequência aproximada)
## Frases e movimentos que destravam (citações curtas das respostas, anonimizadas)
## Momento da intervenção (antes do preço, depois do preço, no fechamento: o que muda)
## O que é só humano (cupom, desconto, condição, ligação) e o que a IA pode copiar sem isso
## Recomendações para o roteiro da IA (5 a 10 itens concretos e testáveis)

Não invente nada que não esteja nos dados. Sem travessão.

Números: ${intervencoes.length} intervenções, ${registros.length} analisadas. Por objeção: ${contar((r) => r.objecao)}. Por fase: ${contar((r) => r.fase)}. Por autor: ${contar((r) => r.autores.join("+"))}. Lead avançou: ${registros.filter((r) => r.lead_avancou).length}.

SÓ HUMANO (amostra):
${soHumano}

INTERVENÇÕES (amostra, as que fizeram o lead avançar primeiro):
${amostra}`);
  return `# Padrões das intervenções humanas que viraram venda\n\n> Gerado por src/scripts/destilar-intervencoes.ts em ${new Date().toISOString().slice(0, 10)}.\n\n${corpo}\n`;
}

async function main() {
  const intervencoes = readFileSync(`${DIR}/intervencoes.jsonl`, "utf-8").trim().split("\n").map((l) => JSON.parse(l) as Intervencao);
  log(`${intervencoes.length} intervenções`);
  const registros = await fazerMap(intervencoes);
  log(`map: ${registros.length} registros (${registros.filter((r) => r.objecao !== "sem_objecao").length} com objeção, ${registros.filter((r) => r.so_humano).length} só humano)`);
  const candidatos = await fazerReduce(registros);
  writeFileSync(`${DIR}/candidatos-rag.json`, JSON.stringify(candidatos, null, 2));
  log(`${candidatos.length} candidatos ao RAG`);
  writeFileSync(`${DIR}/relatorio-padroes.md`, await fazerRelatorio(registros, intervencoes));
  log(`relatório salvo em ${DIR}/relatorio-padroes.md`);
}

if (import.meta.main) await main();
