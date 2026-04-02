import { CallbackHandler } from "langfuse-langchain";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

const langfuseAtivo =
  !!env.LANGFUSE_SECRET_KEY && !!env.LANGFUSE_PUBLIC_KEY;

logger.info("langfuse", `Langfuse ativo: ${langfuseAtivo} | baseUrl: ${env.LANGFUSE_BASEURL} | publicKey: ${env.LANGFUSE_PUBLIC_KEY?.substring(0, 10)}...`);

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
  if (!langfuseAtivo) {
    logger.debug("langfuse", `Handler NÃO criado (chaves ausentes) para trace: ${traceName}`);
    return undefined;
  }

  logger.debug("langfuse", `Criando handler para trace: ${traceName} | session: ${opts.sessionId}`);
  return new CallbackHandler({
    secretKey: env.LANGFUSE_SECRET_KEY,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    baseUrl: env.LANGFUSE_BASEURL,
    traceName,
    sessionId: opts.sessionId,
    userId: opts.userId,
    metadata: opts.metadata,
    tags: opts.tags,
    debug: true,
  });
}

/**
 * Encerra o handler ao final da trace (flush dos eventos).
 */
export async function finalizarLangfuseHandler(
  handler: CallbackHandler | undefined,
): Promise<void> {
  if (handler) {
    logger.debug("langfuse", "Finalizando handler (shutdownAsync)...");
    try {
      await handler.shutdownAsync();
      logger.debug("langfuse", "Handler finalizado com sucesso");
    } catch (e) {
      logger.error("langfuse", "Erro ao finalizar handler:", e);
    }
  }
}
