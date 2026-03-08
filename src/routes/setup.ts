import { Elysia } from "elysia";
import { criarTabelas } from "../db/setup.ts";
import { obterCheckpointer } from "../db/checkpointer.ts";
import { logger } from "../lib/logger.ts";

export const setupRouter = new Elysia()
  .post("/setup", async () => {
    try {
      await criarTabelas();
      await obterCheckpointer();
      return { status: "ok", message: "Tabelas criadas com sucesso" };
    } catch (e) {
      logger.error("setup", "Erro:", e);
      return { status: "error", message: String(e) };
    }
  });
