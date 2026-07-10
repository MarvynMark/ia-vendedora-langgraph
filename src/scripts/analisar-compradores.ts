/**
 * Análise destilada das conversas de compradores.
 *
 * Lê as conversas ganhas já indexadas em rag_documentos (tipo 'conversa_ganha'),
 * usa um LLM (map-reduce, para cobrir todas sem estourar o contexto) para extrair os
 * PADRÕES de fechamento e salva um guia curado em:
 *   src/graphs/main-agent/aprendizados-compradores.md
 *
 * Esse .md é injetado no system prompt do agente (ver prompt.ts).
 *
 * Uso:
 *   bun run src/scripts/analisar-compradores.ts
 *
 * Pré-requisito: rodar antes a ingestão (bun run ingest) para popular rag_documentos.
 */

import { writeFileSync } from "fs";
import { ChatOpenAI } from "@langchain/openai";
import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";

const LOTE = 25; // conversas por chamada de análise (map)

function log(m: string) {
  console.log(`[analisar] ${m}`);
}

const model = new ChatOpenAI({
  modelName: env.OPENAI_MODEL,
  openAIApiKey: env.OPENAI_API_KEY,
  temperature: 0.3,
});

async function invocar(prompt: string): Promise<string> {
  const res = await model.invoke(prompt);
  return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
}

async function main() {
  const r = await pool.query<{ conteudo: string }>(
    `SELECT conteudo FROM rag_documentos
     WHERE tipo = 'conversa_ganha'
     ORDER BY (metadata->>'num_mensagens')::int DESC NULLS LAST`,
  );
  const docs = r.rows;
  log(`${docs.length} conversas de compradores para analisar`);
  if (docs.length === 0) {
    log("Nada para analisar — rode a ingestão primeiro (bun run ingest).");
    await pool.end();
    return;
  }

  // MAP — extrai padrões em lotes
  const parciais: string[] = [];
  for (let i = 0; i < docs.length; i += LOTE) {
    const lote = docs.slice(i, i + LOTE);
    const texto = lote.map((d) => d.conteudo).join("\n\n=====\n\n");
    log(`  analisando lote ${Math.floor(i / LOTE) + 1}/${Math.ceil(docs.length / LOTE)} (${lote.length} conversas)...`);
    const parcial = await invocar(
      `Você é um analista de vendas. Abaixo estão ${lote.length} conversas REAIS de pessoas que COMPRARAM a mentoria do Perito Walker (concursos de Perito Criminal).\n\n` +
        `Extraia os PADRÕES que levaram ao fechamento, de forma objetiva e transferível. Foque em ESTRATÉGIA, não no tom ou estilo do vendedor (o vendedor mudou). Identifique:\n` +
        `- Perfil dos compradores (formação, momento de vida, dor principal)\n` +
        `- Argumentos e gatilhos que fecharam a venda\n` +
        `- Objeções que apareceram e como foram contornadas\n` +
        `- Sinais de compra e timing (o que o lead disse pouco antes de fechar)\n\n` +
        `Responda em tópicos curtos, só os padrões que você realmente observou nas conversas. Não invente.\n\n` +
        `CONVERSAS:\n${texto}`,
    );
    parciais.push(parcial);
  }

  // REDUCE — sintetiza num guia único
  log("Sintetizando o guia final...");
  const guia = await invocar(
    `Você é um estrategista de vendas. Abaixo estão análises parciais de conversas de COMPRADORES da mentoria do Perito Walker. ` +
      `Sintetize tudo num guia ÚNICO, curto e acionável, que será dado ao próprio vendedor (o Walker) como contexto do que funciona nos fechamentos reais.\n\n` +
      `Estruture exatamente nestas seções:\n` +
      `## QUEM COMPRA (perfil)\n## O QUE FECHA A VENDA (argumentos e gatilhos que funcionam)\n## OBJEÇÕES E COMO CONTORNAR (as mais comuns e a resposta que funcionou)\n## SINAIS DE COMPRA E TIMING\n\n` +
      `Regras: seja direto e prático, tópicos curtos, sem enrolação. Português do Brasil. Não invente nada que não esteja nas análises. Foque em estratégia, não em tom.\n\n` +
      `ANÁLISES PARCIAIS:\n${parciais.join("\n\n---\n\n")}`,
  );

  const header =
    `# Aprendizados de fechamentos reais (compradores da mentoria)\n\n` +
    `> Gerado automaticamente a partir de ${docs.length} conversas de compradores (etiqueta "mentoria" no Chatwoot).\n` +
    `> Foca em ESTRATÉGIA (o que funciona nos fechamentos), não no tom, que é o do Walker.\n\n`;

  const caminho = new URL("../graphs/main-agent/aprendizados-compradores.md", import.meta.url);
  writeFileSync(caminho, header + guia + "\n", "utf-8");
  log(`✅ Guia salvo em src/graphs/main-agent/aprendizados-compradores.md (${guia.length} chars)`);
  await pool.end();
}

main();
