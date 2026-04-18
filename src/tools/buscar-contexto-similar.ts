import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { gerarEmbedding } from "../services/embeddings.ts";
import { buscarDocumentosSimilares } from "../db/rag.ts";
import { logger } from "../lib/logger.ts";

export function criarToolBuscarContextoSimilar() {
  return tool(
    async ({ situacao, tipo }) => {
      try {
        logger.info("tool:rag", `Buscando contexto similar — tipo: ${tipo}, situacao: ${situacao.substring(0, 80)}`);

        const embedding = await gerarEmbedding(situacao);
        const resultados = await buscarDocumentosSimilares(embedding, tipo, 3);

        if (resultados.length === 0) {
          return "Nenhum caso similar encontrado na base de conhecimento.";
        }

        const textos = resultados.map((r, i) => {
          const sim = r.similarity !== undefined ? ` (similaridade: ${(r.similarity * 100).toFixed(0)}%)` : "";
          return `### Caso ${i + 1}${r.titulo ? ` — ${r.titulo}` : ""}${sim}\n${r.conteudo}`;
        });

        return textos.join("\n\n---\n\n");
      } catch (e) {
        logger.error("tool:rag", "Erro na busca RAG:", e);
        return "Erro ao buscar contexto similar. Continue com o roteiro padrão.";
      }
    },
    {
      name: "Buscar_contexto_similar",
      description:
        "Busca casos reais de vendas fechadas ou padrões de objeção da base de conhecimento para orientar a abordagem atual. Use quando o lead levantar uma objeção específica ou quando precisar adaptar o pitch para um perfil incomum.",
      schema: z.object({
        situacao: z
          .string()
          .describe(
            "Descreva em 1-2 frases o momento atual da conversa ou a objeção que o lead levantou. Ex: 'Lead disse que não tem dinheiro agora mas quer estudar para PCDF'",
          ),
        tipo: z
          .enum(["conversa_ganha", "objecao"])
          .describe(
            "conversa_ganha: busca padrões de fechamento em perfis similares. objecao: busca como objeções similares foram tratadas.",
          ),
      }),
    },
  );
}
