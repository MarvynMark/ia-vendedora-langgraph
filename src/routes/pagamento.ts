import { Elysia } from "elysia";
import { z } from "zod";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import {
  buscarContatoPorQuery,
  buscarConversasDoContato,
  atualizarKanbanTask,
  buscarKanbanBoard,
  adicionarEtiquetas,
} from "../services/chatwoot.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";

// Payload real da Digital Manager Guru — o corpo HTTP é diretamente os campos (sem wrapper "payload")
const dmGuruPayloadSchema = z.object({
  contact: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone_local_code: z.string().optional(),
    phone_number: z.string().optional(),
  }).optional(),
  product: z.object({
    name: z.string().optional(),
    offer: z.object({
      name: z.string().optional(),
    }).optional(),
  }).optional(),
  status: z.string().optional(),
  webhook_type: z.string().optional(),
  is_reissue: z.number().optional(), // 0 = nova compra, 1 = parcela recorrente
});

let grafoFollowup: Awaited<ReturnType<typeof criarGrafoFollowUp>> | null = null;
async function obterGrafoFollowup() {
  if (!grafoFollowup) grafoFollowup = await criarGrafoFollowUp();
  return grafoFollowup;
}

export const pagamentoRouter = new Elysia()
  .post("/webhook/pagamento", async ({ body }) => {
    logger.info("pagamento", ">>> Webhook recebido");
    registrarWebhook("/webhook/pagamento", body, "recebido");

    const parsed = dmGuruPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("pagamento", "Payload inválido:", parsed.error.issues);
      return { status: "error", reason: "invalid_payload" };
    }

    // Só processar transações aprovadas
    if (parsed.data.status !== "approved") {
      logger.info("pagamento", "Ignorado: status não é approved:", parsed.data.status);
      return { status: "ignored", reason: "not_approved" };
    }

    // Só processar nova compra — ignorar parcelas recorrentes
    if (parsed.data.is_reissue === 1) {
      logger.info("pagamento", "Ignorado: cobrança recorrente (is_reissue=1)");
      return { status: "ignored", reason: "recurring_installment" };
    }

    const contato = parsed.data.contact;
    if (!contato) {
      logger.error("pagamento", "Nenhum dado de contato encontrado");
      return { status: "error", reason: "no_contact_data" };
    }

    // Montar telefone E.164: phone_local_code + phone_number
    const phoneLocal = contato.phone_local_code ?? "55";
    const phoneNum = (contato.phone_number ?? "").replace(/\D/g, "");
    const telefoneE164 = phoneNum ? `+${phoneLocal}${phoneNum}` : undefined;

    const nomeProduto = parsed.data.product?.name ?? "";
    const nomeOferta = parsed.data.product?.offer?.name ?? ""; // ex: "Mentoria Vestigium - Perito Criminal - 6 meses"

    logger.info("pagamento", "Compra aprovada:", {
      nome: contato.name,
      email: contato.email,
      telefone: telefoneE164,
      produto: nomeProduto,
      oferta: nomeOferta,
    });

    // Processar em background
    const processamento = processarPagamentoAprovado({
      nome: contato.name,
      email: contato.email,
      telefone: telefoneE164,
      nomeProduto,
      nomeOferta,
    });

    void processamento;
    return { status: "accepted" };
  });

async function processarPagamentoAprovado(dados: {
  nome?: string;
  email?: string;
  telefone?: string;
  nomeProduto: string;
  nomeOferta: string;
}) {
  const accountId = Number(env.CHATWOOT_ACCOUNT_ID);

  // Localizar contato no Chatwoot — prioriza telefone (múltiplos formatos) e email.
  // Nome é propositalmente excluído: pode estar diferente entre DMG e Chatwoot.
  let contato: { id: number; name: string; phone_number?: string; email?: string } | null = null;

  // Gerar variantes do telefone para aumentar chance de match
  const variantesTelefone: string[] = [];
  if (dados.telefone) {
    const semPlus = dados.telefone.replace(/^\+/, "");          // 5562996171551
    const semPais = semPlus.replace(/^55/, "");                  // 62996171551
    variantesTelefone.push(dados.telefone, semPlus, semPais);
  }

  const tentativas = [...new Set([...variantesTelefone, dados.email].filter(Boolean))] as string[];

  for (const query of tentativas) {
    try {
      contato = await buscarContatoPorQuery(accountId, query);
      if (contato) {
        logger.info("pagamento", "Contato encontrado via query", { query, id: contato.id });
        break;
      }
    } catch (e) {
      logger.warn("pagamento", "Falha ao buscar contato com query", { query, erro: String(e) });
    }
  }

  if (!contato) {
    logger.error("pagamento", "Contato não encontrado no Chatwoot", { tentativas, nome: dados.nome, email: dados.email, telefone: dados.telefone });
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
      description: [
        task.description ?? "",
        `💳 - Plano: ${dados.nomeOferta || dados.nomeProduto}`,
      ].filter(Boolean).join("\n"),
    });
    logger.info("pagamento", "Card movido para Ganho. TaskId:", task.id);
  } catch (e) {
    logger.error("pagamento", "Erro ao mover card para Ganho:", e);
    return;
  }

  // Adicionar etiqueta "mentoria" se produto for Mentoria Vestigium
  if (dados.nomeProduto.toLowerCase().includes("mentoria")) {
    try {
      await adicionarEtiquetas(accountId, conversaComTask.id, ["mentoria"]);
      logger.info("pagamento", "Etiqueta 'mentoria' adicionada à conversa:", conversaComTask.id);
    } catch (e) {
      logger.warn("pagamento", "Erro ao adicionar etiqueta mentoria:", e);
    }
  }

  // Disparar grafo de follow-up com tipo boas_vindas
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
      tipoFollowup: "boas_vindas" as const,
      respostaAgente: "",
    }, { configurable: { thread_id: `followup_${telefone}` } });

    logger.info("pagamento", "Boas-vindas enviadas para:", telefone);
  } catch (e) {
    logger.error("pagamento", "Erro ao disparar grafo de boas-vindas:", e);
  }
}
