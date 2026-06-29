import { Elysia } from "elysia";
import { verificarNoticias } from "../lib/monitor-noticias.ts";
import { logger } from "../lib/logger.ts";

export const monitorNoticiasRouter = new Elysia()
  // Executa a verificação sob demanda (respeitando a deduplicação).
  .get("/monitor/noticias/rodar", async () => {
    try {
      return await verificarNoticias();
    } catch (e) {
      logger.error("monitor-noticias", "Erro na rota /rodar:", e);
      return { erro: e instanceof Error ? e.message : String(e) };
    }
  })
  // Força o envio da notícia casada mais recente, para validar a entrega no grupo.
  .get("/monitor/noticias/testar", async () => {
    try {
      return await verificarNoticias({ forcar: true });
    } catch (e) {
      logger.error("monitor-noticias", "Erro na rota /testar:", e);
      return { erro: e instanceof Error ? e.message : String(e) };
    }
  });
