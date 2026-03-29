import { Elysia } from "elysia";
import { z } from "zod";
import type { ChatwootFollowUpPayload } from "../types/chatwoot.ts";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import { atualizarKanbanTask } from "../services/chatwoot.ts";
import { logger } from "../lib/logger.ts";

const followupPayloadSchema = z.object({
  event: z.enum(["kanban_task_overdue", "kanban_task_updated"]),
  account_id: z.number(),
  board_id: z.number(),
  task: z.object({
    id: z.number(),
    title: z.string(),
    board_step: z.object({
      id: z.number(),
      name: z.string(),
    }),
    conversations: z.array(z.object({
      id: z.number(),
      inbox_id: z.number(),
      display_id: z.number(),
      contact: z.object({
        phone_number: z.string().optional(),
        name: z.string(),
      }),
    })),
  }),
});

let grafoFollowup: Awaited<ReturnType<typeof criarGrafoFollowUp>> | null = null;
async function obterGrafoFollowup() {
  if (!grafoFollowup) grafoFollowup = await criarGrafoFollowUp();
  return grafoFollowup;
}

export const followupRouter = new Elysia()
  .post("/webhook/followup", async ({ body }) => {
    const parsed = followupPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return { status: "error", reason: "invalid_payload" };
    }
    const payload = body as ChatwootFollowUpPayload;

    // kanban_task_updated: auto-set due_date
    if (payload.event === "kanban_task_updated") {
      return await processarTaskUpdated(payload);
    }

    // kanban_task_overdue: disparar follow-up
    if (payload.event === "kanban_task_overdue") {
      return await processarTaskOverdue(payload);
    }

    return { status: "ignored", reason: "unknown_event" };
  });

async function processarTaskUpdated(payload: ChatwootFollowUpPayload) {
  const changes = payload.changed_attributes;
  if (!changes?.board_step_id && !changes?.board_step) {
    return { status: "ignored", reason: "no_step_change" };
  }

  // Prefer changed_attributes format, fall back to task's current board_step
  const newStepName = (
    (changes as Record<string, unknown>)?.board_step as { current_value?: { name?: string } } | undefined
  )?.current_value?.name?.toLowerCase()
    ?? payload.task.board_step.name.toLowerCase();

  // Filtrar: apenas etapas que disparam ação automática
  const etapasRastreadas = ["conexão", "conexao", "aguardando pagamento"];
  if (!etapasRastreadas.some(e => newStepName.includes(e))) {
    return { status: "ignored", reason: "step_not_tracked" };
  }

  // Setar due_date para amanhã (agora + 1 dia) para disparar overdue
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);

  try {
    await atualizarKanbanTask(
      payload.account_id,
      payload.task.id,
      { due_date: amanha.toISOString() },
    );
    logger.info("follow-up", "task_updated: due_date setada para", amanha.toISOString());
  } catch (e) {
    logger.error("follow-up", "Erro ao atualizar due_date:", e);
  }

  return { status: "ok", action: "due_date_set" };
}

async function processarTaskOverdue(payload: ChatwootFollowUpPayload) {
  const task = payload.task;
  const conversa = task.conversations?.[0];

  if (!conversa) {
    logger.error("follow-up", "Nenhuma conversa encontrada na tarefa");
    return { status: "error", reason: "no_conversation" };
  }

  const telefone = conversa.contact?.phone_number ?? conversa.contact?.additional_attributes?.social_profiles?.instagram ?? "";
  if (!telefone) {
    logger.error("follow-up", "Nenhum telefone encontrado");
    return { status: "error", reason: "no_phone" };
  }

  logger.info("follow-up", "Processando overdue para:", telefone);

  const processamento = (async () => {
    try {
      const g = await obterGrafoFollowup();

      await g.invoke({
        messages: [],
        accountId: payload.account_id,
        boardId: payload.board_id,
        taskId: task.id,
        board_step: task.board_step,
        title: task.title,
        description: task.description ?? "",
        dueDate: task.due_date ?? "",
        telefone,
        conversationId: conversa.id,
        inboxId: conversa.inbox_id,
        displayId: conversa.display_id,
        funilSteps: [],
        idEtapaPerdido: 0,
        tipoFollowup: "followup" as const,
        respostaAgente: "",
      }, { configurable: { thread_id: `followup_${telefone}` } });
    } catch (e) {
      logger.error("follow-up", "Erro no processamento:", e);
    }
  })();

  void processamento;

  return { status: "accepted" };
}
