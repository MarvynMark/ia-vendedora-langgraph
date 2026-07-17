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
import { pagamentoTmbRouter } from "./routes/pagamento-tmb.ts";
import { aplicacaoRouter } from "./routes/aplicacao-mentoria.ts";
import { dashboardRouter } from "./routes/dashboard.ts";
import { verificarTemplatesPendentes } from "./lib/verificar-templates.ts";
import { verificarFollowupsPendentes } from "./lib/verificar-followups.ts";
import { iniciarVarreduraFilaOrfa } from "./lib/varredura-fila.ts";
import { verificarNoticias } from "./lib/monitor-noticias.ts";
import { monitorNoticiasRouter } from "./routes/monitor-noticias.ts";
import { verificarEditais } from "./lib/monitor-edital.ts";
import { monitorEditalRouter } from "./routes/monitor-edital.ts";
import { obterLogs, obterLogsPagamento } from "./lib/webhook-logger.ts";

const app = new Elysia()
  .use(cors())
  .use(healthRouter)
  .use(setupRouter)
  .use(webhookRouter)
  .use(followupRouter)
  .use(pagamentoRouter)
  .use(pagamentoTmbRouter)
  .use(aplicacaoRouter)
  .use(dashboardRouter)
  .use(monitorNoticiasRouter)
  .use(monitorEditalRouter)
  .get("/webhook/logs", ({ query }) => {
    const limite = Math.min(Number(query.limite ?? 50), 100);
    return obterLogs(limite);
  })
  .get("/webhook/logs-pagamento", ({ query }) => {
    const limite = Math.min(Number(query.limite ?? 50), 50);
    return obterLogsPagamento(limite);
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

// Job: varredura de fila órfã — recupera atendimentos travados (deploy/crash deixou lock preso e
// a mensagem do lead órfã na fila). Reprocessa via grafo. Roda a cada 3 minutos.
iniciarVarreduraFilaOrfa();

// Job: monitorar sites de notícias e alertar sobre "perito criminal"
if (env.MONITOR_ATIVO) {
  logger.info("monitor-noticias", `Monitor de notícias ativo (intervalo ${env.MONITOR_INTERVALO_MS}ms, termos: "${env.MONITOR_TERMOS}")`);
  setInterval(async () => {
    try {
      await verificarNoticias();
    } catch (e) {
      logger.error("monitor-noticias", "Erro no job de notícias:", e);
    }
  }, env.MONITOR_INTERVALO_MS);
}

// Job: monitorar a API do Cebraspe e avisar o grupo quando o edital do concurso sair
if (env.MONITOR_EDITAL_ATIVO) {
  logger.info("monitor-edital", `Monitor de edital ativo (intervalo ${env.MONITOR_EDITAL_INTERVALO_MS}ms)`);
  setInterval(async () => {
    try {
      await verificarEditais();
    } catch (e) {
      logger.error("monitor-edital", "Erro no job de edital:", e);
    }
  }, env.MONITOR_EDITAL_INTERVALO_MS);
}

async function shutdown() {
  logger.info("server", "Desligando...");
  await encerrarCheckpointer();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export type App = typeof app;
