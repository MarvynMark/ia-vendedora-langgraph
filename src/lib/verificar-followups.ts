import { env } from "../config/env.ts";
import { listarKanbanTasks, atualizarKanbanTask, buscarConversa } from "../services/chatwoot.ts";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import { proximoHorarioComercial } from "./horario-comercial.ts";
import { logger } from "./logger.ts";

// Etapas rastreadas: Primeira mensagem (7), Conexao (10), Aguardando Pagamento (8), Nutrir (12)
const STEPS_RASTREADOS = [
  { id: 7,  name: "Primeira mensagem",    delayMs: 2  * 60 * 60 * 1000,       tipoFollowup: "followup"  as const },
  { id: 10, name: "Conexao",              delayMs: 24 * 60 * 60 * 1000,       tipoFollowup: "followup"  as const },
  { id: 8,  name: "Aguardando Pagamento", delayMs: 24 * 60 * 60 * 1000,       tipoFollowup: "lembrete"  as const },
  { id: 12, name: "Nutrir",               delayMs: 3  * 24 * 60 * 60 * 1000,  tipoFollowup: "nutrir"    as const },
];

let grafoFollowup: Awaited<ReturnType<typeof criarGrafoFollowUp>> | null = null;
async function obterGrafoFollowup() {
  if (!grafoFollowup) grafoFollowup = await criarGrafoFollowUp();
  return grafoFollowup;
}

export async function verificarFollowupsPendentes() {
  if (env.MODO_TESTE) {
    logger.debug("followup-timer", "Modo teste — verificação de follow-ups bloqueada");
    return;
  }

  const accountId = env.CHATWOOT_ACCOUNT_ID;
  const boardId = env.KANBAN_BOARD_ID;

  for (const step of STEPS_RASTREADOS) {
    let tasks;
    try {
      tasks = await listarKanbanTasks(accountId, boardId, step.id);
    } catch (e) {
      logger.error("followup-timer", `Erro ao listar tasks do step ${step.name}:`, e);
      continue;
    }

    for (const task of tasks) {
      try {
        // Sem due_date: agendar pela primeira vez
        if (!task.due_date) {
          const proximaData = proximoHorarioComercial(new Date(), step.delayMs);
          await atualizarKanbanTask(accountId, task.id, { due_date: proximaData.toISOString() });
          logger.info("followup-timer", `due_date agendada para task ${task.id} (${task.title}) → ${proximaData.toISOString()}`);
          continue;
        }

        // Vencida: disparar follow-up
        if (task.date_status !== "overdue") continue;

        const conversa = task.conversations?.[0];
        if (!conversa) {
          logger.warn("followup-timer", `Task ${task.id} sem conversa associada — ignorando`);
          continue;
        }

        // Busca telefone na conversa completa
        let telefone = "";
        try {
          const conversaCompleta = await buscarConversa(accountId, conversa.id) as {
            meta?: { sender?: { phone_number?: string } };
            contact?: { phone_number?: string; additional_attributes?: { social_profiles?: { instagram?: string } } };
          };
          telefone =
            conversaCompleta.meta?.sender?.phone_number ??
            conversaCompleta.contact?.phone_number ??
            conversaCompleta.contact?.additional_attributes?.social_profiles?.instagram ??
            "";
        } catch (e) {
          logger.warn("followup-timer", `Erro ao buscar conversa ${conversa.id} para telefone:`, e);
        }

        if (!telefone) {
          logger.warn("followup-timer", `Task ${task.id} sem telefone — ignorando`);
          continue;
        }

        logger.info("followup-timer", `Disparando follow-up para task ${task.id} (${task.title}) — ${telefone}`);

        const stepInfo = { id: step.id, name: step.name };

        void (async () => {
          try {
            const g = await obterGrafoFollowup();
            await g.invoke({
              messages: [],
              accountId: Number(accountId),
              boardId,
              taskId: task.id,
              board_step: stepInfo,
              title: task.title,
              description: task.description ?? "",
              dueDate: task.due_date ?? "",
              telefone,
              conversationId: conversa.id,
              inboxId: conversa.inbox.id,
              displayId: conversa.display_id,
              funilSteps: [],
              idEtapaPerdido: 0,
              tipoFollowup: step.tipoFollowup,
              respostaAgente: "",
            }, { configurable: { thread_id: `followup_${telefone}` } });
          } catch (e) {
            logger.error("followup-timer", `Erro no follow-up da task ${task.id}:`, e);
          }
        })();

      } catch (e) {
        logger.error("followup-timer", `Erro ao processar task ${task.id}:`, e);
      }
    }
  }
}
