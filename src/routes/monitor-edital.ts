import { Elysia } from "elysia";
import { verificarEditais } from "../lib/monitor-edital.ts";
import { logger } from "../lib/logger.ts";

export const monitorEditalRouter = new Elysia()
  // Executa a verificação sob demanda (respeitando a deduplicação por arquivo).
  .get("/monitor/edital/rodar", async () => {
    try {
      return await verificarEditais();
    } catch (e) {
      logger.error("monitor-edital", "Erro na rota /rodar:", e);
      return { erro: e instanceof Error ? e.message : String(e) };
    }
  })
  // Envia uma mensagem de teste ao grupo para validar a entrega (não grava dedup).
  .get("/monitor/edital/testar", async () => {
    try {
      return await verificarEditais({ forcar: true });
    } catch (e) {
      logger.error("monitor-edital", "Erro na rota /testar:", e);
      return { erro: e instanceof Error ? e.message : String(e) };
    }
  });
