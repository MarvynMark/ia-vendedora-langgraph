import { CallbackHandler } from "langfuse-langchain";
import { env } from "../config/env.ts";

const langfuseAtivo =
  !!env.LANGFUSE_SECRET_KEY && !!env.LANGFUSE_PUBLIC_KEY;

export interface LangfuseTraceOpts {
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Cria um CallbackHandler do Langfuse para rastrear uma execução.
 * Retorna `undefined` se as chaves não estiverem configuradas (modo opcional).
 */
export function criarLangfuseHandler(
  traceName: string,
  opts: LangfuseTraceOpts = {},
): CallbackHandler | undefined {
  if (!langfuseAtivo) return undefined;

  return new CallbackHandler({
    secretKey: env.LANGFUSE_SECRET_KEY,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    baseUrl: env.LANGFUSE_BASEURL,
    sessionId: opts.sessionId,
    userId: opts.userId,
    metadata: { ...opts.metadata, traceName },
    tags: opts.tags,
  });
}

/**
 * Encerra o handler ao final da trace (flush dos eventos).
 */
export async function finalizarLangfuseHandler(
  handler: CallbackHandler | undefined,
): Promise<void> {
  if (handler) {
    await handler.shutdownAsync();
  }
}
