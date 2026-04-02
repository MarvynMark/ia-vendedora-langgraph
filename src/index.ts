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
import { verificarFollowupsPendentes } from "./lib/verificar-followups.ts";
import { obterLogs } from "./lib/webhook-logger.ts";

const app = new Elysia()
  .use(cors())
  .use(healthRouter)
  .use(setupRouter)
  .use(webhookRouter)
  .use(followupRouter)
  .use(pagamentoRouter)
  .use(aplicacaoRouter)
  .get("/webhook/logs", ({ query }) => {
    const limite = Math.min(Number(query.limite ?? 50), 100);
    return obterLogs(limite);
  })
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

// Job: verificar follow-ups vencidos e agendar novos (a cada 5 minutos)
setInterval(async () => {
  try {
    await verificarFollowupsPendentes();
  } catch (e) {
    logger.error("followup-timer", "Erro no job de follow-ups:", e);
  }
}, 5 * 60_000);

async function shutdown() {
  logger.info("server", "Desligando...");
  await encerrarCheckpointer();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export type App = typeof app;
