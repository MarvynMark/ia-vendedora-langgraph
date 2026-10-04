/**
 * Ingere no RAG os roteiros destilados das intervenções humanas (roteiros-intervencao.ts).
 *
 * Uso: bun run src/scripts/ingerir-intervencoes.ts
 *
 * Idempotente: apaga só os documentos com metadata.origem = "intervencao_humana" e reinsere. Os
 * roteiros do prompt (roteiro_prompt) e os casos reais ficam intactos. Como nos roteiros do prompt,
 * o embedding sai dos GATILHOS (as frases como o lead fala), porque a busca compara com "o lead
 * disse X", não com o roteiro.
 */

import { pool } from "../db/pool.ts";
import { inserirDocumento } from "../db/rag.ts";
import { gerarEmbedding } from "../services/embeddings.ts";
import { ROTEIROS_INTERVENCAO } from "./roteiros-intervencao.ts";

const ORIGEM = "intervencao_humana";

async function main() {
  const del = await pool.query(`DELETE FROM rag_documentos WHERE metadata->>'origem' = $1`, [ORIGEM]);
  console.log(`Removidos ${del.rowCount} roteiros de intervenção antigos.`);

  for (const r of ROTEIROS_INTERVENCAO) {
    const embedding = await gerarEmbedding(`${r.titulo}\n${r.gatilhos}`);
    await inserirDocumento({
      tipo: "objecao",
      titulo: r.titulo,
      conteudo: r.conteudo,
      metadata: { origem: ORIGEM, objecao: r.objecao, gatilhos: r.gatilhos },
      embedding,
    });
    console.log(`  + ${r.titulo}`);
  }
  console.log(`\n${ROTEIROS_INTERVENCAO.length} roteiros ingeridos.`);
  await pool.end();
}

main();
