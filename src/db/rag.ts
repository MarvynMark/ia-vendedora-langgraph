import { pool } from "./pool.ts";
import { logger } from "../lib/logger.ts";

export interface RagDocumento {
  id: number;
  tipo: string;
  titulo: string | null;
  conteudo: string;
  metadata: Record<string, unknown>;
  similarity?: number;
}

interface NovoRagDocumento {
  tipo: string;
  titulo?: string;
  conteudo: string;
  metadata?: Record<string, unknown>;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function inserirDocumento(doc: NovoRagDocumento): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO rag_documentos (tipo, titulo, conteudo, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        doc.tipo,
        doc.titulo ?? null,
        doc.conteudo,
        JSON.stringify(doc.metadata ?? {}),
        JSON.stringify(doc.embedding),
      ],
    );
  } finally {
    client.release();
  }
}

export async function limparDocumentosPorTipo(tipo: string): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query("DELETE FROM rag_documentos WHERE tipo = $1", [tipo]);
    logger.info("rag", `Removidos ${res.rowCount} documentos do tipo "${tipo}"`);
  } finally {
    client.release();
  }
}

export async function buscarDocumentosSimilares(
  embedding: number[],
  tipo: string,
  limite: number = 3,
): Promise<RagDocumento[]> {
  const client = await pool.connect();
  try {
    const res = await client.query<{
      id: number;
      tipo: string;
      titulo: string | null;
      conteudo: string;
      metadata: Record<string, unknown>;
      embedding: number[];
    }>(
      `SELECT id, tipo, titulo, conteudo, metadata, embedding
       FROM rag_documentos
       WHERE tipo = $1`,
      [tipo],
    );

    if (res.rows.length === 0) return [];

    const comSimilarity = res.rows.map((row) => {
      const emb = Array.isArray(row.embedding) ? row.embedding : (JSON.parse(row.embedding as unknown as string) as number[]);
      return {
        id: row.id,
        tipo: row.tipo,
        titulo: row.titulo,
        conteudo: row.conteudo,
        metadata: row.metadata,
        similarity: cosineSimilarity(embedding, emb),
      };
    });

    comSimilarity.sort((a, b) => b.similarity - a.similarity);
    return comSimilarity.slice(0, limite);
  } finally {
    client.release();
  }
}

export async function contarDocumentos(tipo?: string): Promise<number> {
  const client = await pool.connect();
  try {
    const res = tipo
      ? await client.query<{ count: string }>("SELECT COUNT(*) FROM rag_documentos WHERE tipo = $1", [tipo])
      : await client.query<{ count: string }>("SELECT COUNT(*) FROM rag_documentos");
    return parseInt(res.rows[0]?.count ?? "0");
  } finally {
    client.release();
  }
}
