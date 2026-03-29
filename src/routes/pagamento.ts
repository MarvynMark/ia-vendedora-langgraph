import { Elysia } from "elysia";
import { z } from "zod";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import {
  buscarContatoPorQuery,
  buscarConversasDoContato,
  atualizarKanbanTask,
  buscarKanbanBoard,
} from "../services/chatwoot.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

// Payload da Digital Manager Guru
// Referência: https://developers.digitalmanager.guru/reference/webhooks
const dmGuruPayloadSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.string().or(z.number()).optional(),
    status: z.string().optional(),
    customer: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone_number: z.string().optional(),
    }).optional(),
    subscriber: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone_number: z.string().optional(),
    }).optional(),
    product: z.object({
      name: z.string().optional(),
    }).optional(),
    plan: z.object({
      name: z.string().optional(),
    }).optional(),
  }),
});

const EVENTOS_APROVADOS = [
  "purchase.approved",
  "purchase.complete",
  "purchase.completed",
  "subscription.activated",
];

let grafoFollowup: Awaited<ReturnType<typeof criarGrafoFollowUp>> | null = null;
async function obterGrafoFollowup() {
  if (!grafoFollowup) grafoFollowup = await criarGrafoFollowUp();
  return grafoFollowup;
}

export const pagamentoRouter = new Elysia()
  .post("/webhook/pagamento", async ({ body }) => {
    logger.info("pagamento", ">>> Webhook recebido", { event: (body as Record<string, unknown>).event });

    const parsed = dmGuruPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("pagamento", "Payload inválido:", parsed.error.issues);
      return { status: "error", reason: "invalid_payload" };
    }

    const { event, data } = parsed.data;

    if (!EVENTOS_APROVADOS.includes(event)) {
      logger.info("pagamento", "Ignorado: evento não é de aprovação:", event);
      return { status: "ignored", reason: "event_not_approved" };
    }

    // Suporta tanto "customer" quanto "subscriber" (DM Guru usa os dois em contextos diferentes)
    const comprador = data.customer ?? data.subscriber;
    const nomeProduto = data.product?.name ?? data.plan?.name ?? "";

    if (!comprador) {
      logger.error("pagamento", "Nenhum dado de comprador encontrado");
      return { status: "error", reason: "no_customer_data" };
    }

    logger.info("pagamento", "Compra aprovada:", {
      nome: comprador.name,
      email: comprador.email,
      telefone: comprador.phone_number,
      produto: nomeProduto,
    });

    // Processar em background
    const processamento = processarPagamentoAprovado({
      nome: comprador.name,
      email: comprador.email,
      telefone: comprador.phone_number,
      nomeProduto,
    });

    void processamento;
    return { status: "accepted" };
  });

async function processarPagamentoAprovado(dados: {
  nome?: string;
  email?: string;
  telefone?: string;
  nomeProduto: string;
}) {
  const accountId = Number(env.CHATWOOT_ACCOUNT_ID);

  // Tentar localizar o contato no Chatwoot por telefone, depois email, depois nome
  let contato: { id: number; name: string; phone_number?: string; email?: string } | null = null;

  const tentativas = [
    dados.telefone,
    dados.email,
    dados.nome,
  ].filter(Boolean) as string[];

  for (const query of tentativas) {
    try {
      contato = await buscarContatoPorQuery(accountId, query);
      if (contato) {
        logger.info("pagamento", "Contato encontrado via query:", query, "→ id:", contato.id);
        break;
      }
    } catch (e) {
      logger.warn("pagamento", "Falha ao buscar contato com query:", query, e);
    }
  }

  if (!contato) {
    logger.error("pagamento", "Contato não encontrado no Chatwoot para:", dados);
    return;
  }

  // Buscar conversas do contato para encontrar o Kanban task
  let conversas: Array<{ id: number; inbox_id: number; kanban_task?: Record<string, unknown> }> = [];
  try {
    conversas = await buscarConversasDoContato(accountId, contato.id);
  } catch (e) {
    logger.error("pagamento", "Erro ao buscar conversas do contato:", e);
    return;
  }

  // Pegar a conversa mais recente que tenha kanban_task
  const conversaComTask = conversas.find(c => c.kanban_task && Object.keys(c.kanban_task).length > 0);
  if (!conversaComTask?.kanban_task) {
    logger.error("pagamento", "Nenhuma conversa com kanban_task encontrada para contato:", contato.id);
    return;
  }

  const task = conversaComTask.kanban_task as {
    id: number;
    board_id: number;
    board_step?: { id: number; name: string };
    title?: string;
    description?: string;
    due_date?: string;
  };

  logger.info("pagamento", "Kanban task encontrada:", { taskId: task.id, boardId: task.board_id });

  // Buscar etapas do funil para encontrar o ID da etapa "Ganho"
  let funilSteps: Array<{ id: number; name: string }> = [];
  try {
    const board = await buscarKanbanBoard(accountId, task.board_id) as {
      steps?: Array<{ id: number; name: string; cancelled?: boolean }>;
    };
    funilSteps = board.steps ?? [];
  } catch (e) {
    logger.error("pagamento", "Erro ao buscar funil:", e);
    return;
  }

  const etapaGanho = funilSteps.find(s => s.name.toLowerCase() === "ganho");
  if (!etapaGanho) {
    logger.error("pagamento", "Etapa 'Ganho' não encontrada no funil. Etapas disponíveis:", funilSteps.map(s => s.name));
    return;
  }

  // Mover card para "Ganho" e setar due_date para agora (disparo imediato)
  try {
    await atualizarKanbanTask(accountId, task.id, {
      board_step_id: etapaGanho.id,
      due_date: new Date().toISOString(),
      description: `${task.description ?? ""}\nProduto adquirido: ${dados.nomeProduto}`.trim(),
    });
    logger.info("pagamento", "Card movido para Ganho. TaskId:", task.id);
  } catch (e) {
    logger.error("pagamento", "Erro ao mover card para Ganho:", e);
    return;
  }

  // Disparar grafo de follow-up com tipo pos_consulta (boas-vindas)
  const telefone = dados.telefone ?? contato.phone_number ?? contato.email ?? String(contato.id);

  try {
    const g = await obterGrafoFollowup();
    await g.invoke({
      messages: [],
      accountId,
      boardId: task.board_id,
      taskId: task.id,
      board_step: etapaGanho,
      title: task.title ?? contato.name,
      description: task.description ?? "",
      dueDate: new Date().toISOString(),
      telefone,
      conversationId: conversaComTask.id,
      inboxId: conversaComTask.inbox_id,
      displayId: conversaComTask.id,
      funilSteps,
      idEtapaPerdido: 0,
      tipoFollowup: "pos_consulta" as const,
      respostaAgente: "",
    }, { configurable: { thread_id: `followup_${telefone}` } });

    logger.info("pagamento", "Boas-vindas enviadas para:", telefone);
  } catch (e) {
    logger.error("pagamento", "Erro ao disparar grafo de boas-vindas:", e);
  }
}
