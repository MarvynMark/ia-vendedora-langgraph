import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";
import { enviarTemplate, contarMensagensIncoming, buscarConversa, atualizarKanbanTask } from "../services/chatwoot.ts";
import { logger } from "./logger.ts";

export async function verificarTemplatesPendentes() {
  const delayMs = env.TEMPLATE_DELAY_MS;

  // Busca conversas sem template enviado que já passaram do delay
  const result = await pool.query<{ id: number; conversation_id: number; account_id: number }>(
    `SELECT id, conversation_id, account_id
     FROM leads_template_pendente
     WHERE template_enviado = FALSE
       AND criado_em <= NOW() - ($1 || ' milliseconds')::INTERVAL
     LIMIT 20`,
    [delayMs],
  );

  if (result.rows.length === 0) return;

  logger.info("template-timer", `Verificando ${result.rows.length} lead(s) pendente(s)...`);

  for (const row of result.rows) {
    try {
      // Verifica se o lead já enviou alguma mensagem
      const totalIncoming = await contarMensagensIncoming(row.account_id, row.conversation_id);

      if (totalIncoming > 0) {
        // Lead já entrou em contato — marca como enviado sem precisar do template
        await pool.query(
          "UPDATE leads_template_pendente SET template_enviado = TRUE WHERE id = $1",
          [row.id],
        );
        logger.info("template-timer", `Lead já enviou mensagem — pulando template. conversa: ${row.conversation_id}`);
        continue;
      }

      // Nenhuma mensagem — envia o template
      await enviarTemplate(row.account_id, row.conversation_id, "abertura_esta_estudando");
      await pool.query(
        "UPDATE leads_template_pendente SET template_enviado = TRUE WHERE id = $1",
        [row.id],
      );
      logger.info("template-timer", `Template enviado para conversa: ${row.conversation_id}`);

      // Mover card para "Primeira mensagem" para iniciar sequência de follow-up
      try {
        const conversa = await buscarConversa(row.account_id, row.conversation_id) as {
          kanban_task?: {
            id: number;
            board?: { steps?: Array<{ id: number; name: string }> };
          };
        };
        const task = conversa.kanban_task;
        if (task?.id) {
          const steps = task.board?.steps ?? [];
          const stepPrimeiraMensagem = steps.find(s =>
            s.name.toLowerCase().includes("primeira mensagem")
          );
          if (stepPrimeiraMensagem) {
            await atualizarKanbanTask(row.account_id, task.id, {
              board_step_id: stepPrimeiraMensagem.id,
            });
            logger.info("template-timer", `Card movido para "Primeira mensagem" — conversa: ${row.conversation_id}`);
          }
        }
      } catch (e) {
        logger.warn("template-timer", "Erro ao mover card para Primeira mensagem:", e);
      }
    } catch (e) {
      logger.error("template-timer", `Erro ao processar conversa ${row.conversation_id}:`, e);
    }
  }
}
