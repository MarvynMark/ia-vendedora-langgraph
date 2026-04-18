import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

const modelo = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  openAIApiKey: env.OPENAI_API_KEY,
});

export async function gerarEmbedding(texto: string): Promise<number[]> {
  try {
    const [embedding] = await modelo.embedDocuments([texto]);
    return embedding!;
  } catch (e) {
    logger.error("embeddings", "Erro ao gerar embedding:", e);
    throw e;
  }
}
