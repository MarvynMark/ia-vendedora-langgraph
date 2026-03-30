import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "./config/env.ts";
import { pool } from "./db/pool.ts";
import { encerrarCheckpointer } from "./db/checkpointer.ts";
import { logger } from "./lib/logger.ts";
import { healthRouter } from "./routes/health.ts";
import { setupRouter } from "./routes/setup.ts";
import { webhookRouter } from "./routes/webhook.ts";
import { followupRouter } from "./routes/followup.ts";
import { pagamentoRouter } from "./routes/pagamento.ts";
import { aplicacaoRouter } from "./routes/aplicacao-mentoria.ts";
import { verificarTemplatesPendentes } from "./lib/verificar-templates.ts";

const app = new Elysia()
  .use(cors())
  .use(healthRouter)
  .use(setupRouter)
  .use(webhookRouter)
  .use(followupRouter)
  .use(pagamentoRouter)
  .use(aplicacaoRouter)
  .listen(env.PORT);

logger.info("server", `Vestigium Agent rodando em http://localhost:${env.PORT}`);

// Job: verificar leads aguardando template (a cada 60 segundos)
setInterval(async () => {
  try {
    await verificarTemplatesPendentes();
  } catch (e) {
    logger.error("template-timer", "Erro no job de verificação:", e);
  }
}, 60_000);

async function shutdown() {
  logger.info("server", "Desligando...");
  await encerrarCheckpointer();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export type App = typeof app;
