import { logger } from "./logger.ts";

export async function comRetry<T>(fn: () => Promise<T>, tentativas = 3, delay = 1000): Promise<T> {
  for (let i = 0; i < tentativas; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tentativas - 1) throw e;
      logger.warn("retry", `Tentativa ${i + 1}/${tentativas} falhou, aguardando ${delay}ms...`, e);
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error("unreachable");
}
