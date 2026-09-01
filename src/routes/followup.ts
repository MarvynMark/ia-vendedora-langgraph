import { Elysia } from "elysia";
import { z } from "zod";
import type { ChatwootFollowUpPayload } from "../types/chatwoot.ts";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import { atualizarKanbanTask } from "../services/chatwoot.ts";
import { proximoHorarioComercial } from "../lib/horario-comercial.ts";
import { delayInicialMs } from "../lib/delays-followup.ts";
import { primeiroNomeSaudacao } from "../lib/nome.ts";
import { logger } from "../lib/logger.ts";
import { env } from "../config/env.ts";

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
  const etapasRastreadas = ["novo lead", "conexão", "conexao", "aguardando pagamento", "primeira mensagem"];
  if (!etapasRastreadas.some(e => newStepName.includes(e))) {
    return { status: "ignored", reason: "step_not_tracked" };
  }

  // Delay do 1º toque ao entrar na etapa (ver src/lib/delays-followup.ts). Em "Aguardando
  // Pagamento" a descrição decide: com "link enviado" é lembrete (20min), sem é pós-preço (1h).
  const proximaData = proximoHorarioComercial(
    new Date(),
    delayInicialMs(newStepName, payload.task.description ?? ""),
  );

  // Ao mover para etapa que inicia nova sequência, zerar o contador de follow-ups
  // para evitar que o contador da etapa anterior faça o agente pular mensagens
  const dadosAtualizacao: Parameters<typeof atualizarKanbanTask>[2] = { due_date: proximaData.toISOString() };
  const etapasComContador = ["conexão", "conexao", "aguardando pagamento"];
  const descricaoAtual = payload.task.description ?? "";
  if (etapasComContador.some(e => newStepName.includes(e)) && /🔁\s*-\s*Follow-ups:\s*[1-9]/i.test(descricaoAtual)) {
    dadosAtualizacao.description = descricaoAtual.replace(/🔁\s*-\s*Follow-ups:\s*\d+/i, "🔁 - Follow-ups: 0");
    logger.info("follow-up", `Contador de follow-ups zerado ao mover para etapa "${newStepName}"`);
  }

  try {
    await atualizarKanbanTask(
      payload.account_id,
      payload.task.id,
      dadosAtualizacao,
    );
    logger.info("follow-up", "task_updated: due_date setada para", proximaData.toISOString());
  } catch (e) {
    logger.error("follow-up", "Erro ao atualizar due_date:", e);
  }

  return { status: "ok", action: "due_date_set" };
}

async function processarTaskOverdue(payload: ChatwootFollowUpPayload) {
  if (env.MODO_TESTE) {
    logger.info("follow-up", "Modo teste ativo — follow-up overdue bloqueado");
    return { status: "ignored", reason: "modo_teste" };
  }
  const task = payload.task;
  // Filtra para usar apenas a conversa do inbox comercial — evita enviar follow-up
  // pelo número errado quando o contato tem conversas em múltiplos inboxes (ex: #ALUNOS WALKER)
  const conversa = task.conversations?.find(c => c.inbox_id === env.CHATWOOT_INBOX_ID)
    ?? task.conversations?.[0];

  if (!conversa) {
    logger.error("follow-up", "Nenhuma conversa encontrada na tarefa");
    return { status: "error", reason: "no_conversation" };
  }

  if (conversa.inbox_id !== env.CHATWOOT_INBOX_ID) {
    logger.warn("follow-up", `Conversa ${conversa.id} não pertence ao inbox comercial (inbox ${conversa.inbox_id}) — follow-up ignorado`);
    return { status: "ignored", reason: "inbox_nao_comercial" };
  }

  const telefone = conversa.contact?.phone_number ?? conversa.contact?.additional_attributes?.social_profiles?.instagram ?? "";
  if (!telefone) {
    logger.error("follow-up", "Nenhum telefone encontrado");
    return { status: "error", reason: "no_phone" };
  }

  // Determina tipo de follow-up pelo nome da etapa atual
  const stepName = task.board_step.name.toLowerCase();
  type TipoFollowup = "template_inicial" | "template_abertura" | "followup" | "lembrete" | "boas_vindas" | "nutrir" | "ignorar";
  let tipoFollowup: TipoFollowup;
  if (stepName.includes("novo lead")) {
    tipoFollowup = "template_inicial";
  } else if (stepName.includes("primeira mensagem")) {
    tipoFollowup = "template_abertura";
  } else if (stepName === "conexão" || stepName === "conexao") {
    tipoFollowup = "followup";
  } else if (stepName.includes("aguardando pagamento")) {
    // Duas subpopulações: COM "link enviado" → lembrete ("o link ainda tá ativo"); SEM → pós-preço
    // (viu o preço e sumiu, link nunca mandado). Mesma regra de classificar()/verificar-followups.ts.
    // Antes forçava "lembrete" para todos e o lead sem link recebia o "link fantasma" do diagnóstico.
    tipoFollowup = /link\s*enviado/i.test(task.description ?? "") ? "lembrete" : "followup";
  } else if (stepName === "ganho") {
    // Proteção: se boas-vindas já foram enviadas pelo pagamento.ts, ignorar
    if ((task.description ?? "").includes("boas-vindas: enviado")) {
      logger.info("follow-up", "Boas-vindas já enviadas via pagamento.ts — ignorando overdue para Ganho");
      return { status: "ignored", reason: "boas_vindas_ja_enviadas" };
    }
    tipoFollowup = "boas_vindas";
  } else if (stepName === "nutrir" || stepName === "perdido") {
    tipoFollowup = "nutrir";
  } else {
    tipoFollowup = "ignorar";
  }

  // Proteção contra overdue com board_step desatualizado: se o Chatwoot enfileirou
  // o evento quando o card ainda estava em etapa anterior à conversão, a descrição
  // já terá "boas-vindas: enviado" mesmo que o step no payload seja "conexão" etc.
  if (
    (task.description ?? "").includes("boas-vindas: enviado") &&
    tipoFollowup !== "boas_vindas" &&
    tipoFollowup !== "nutrir"
  ) {
    logger.warn("follow-up", `Overdue ignorado — lead já converteu mas step no payload é "${task.board_step.name}"`);
    return { status: "ignored", reason: "lead_convertido_step_desatualizado" };
  }

  // O nome usado na saudação: prefere o nome REAL do contato (WhatsApp) ao título da tarefa
  // do Kanban, que para leads criados sem nome vira o genérico "Conversa" → "Oi Conversa, ...".
  // Só cai no task.title se o contato não tiver um primeiro nome válido.
  const nomeContato = conversa.contact?.name ?? "";
  const nomeSaudacao = primeiroNomeSaudacao(nomeContato) ? nomeContato : task.title;

  logger.info("follow-up", `Processando overdue para: ${telefone} — step: ${task.board_step.name} — tipo: ${tipoFollowup}`);

  const processamento = (async () => {
    try {
      const g = await obterGrafoFollowup();

      await g.invoke({
        messages: [],
        accountId: payload.account_id,
        boardId: payload.board_id,
        taskId: task.id,
        board_step: task.board_step,
        title: nomeSaudacao,
        description: task.description ?? "",
        dueDate: task.due_date ?? "",
        telefone,
        // API do Chatwoot usa display_id, não o id interno (com fallback por segurança)
        conversationId: conversa.display_id ?? conversa.id,
        inboxId: conversa.inbox_id,
        displayId: conversa.display_id ?? conversa.id,
        funilSteps: [],
        idEtapaPerdido: 0,
        tipoFollowup,
        respostaAgente: "",
      }, { configurable: { thread_id: `followup_${telefone}` } });
    } catch (e) {
      logger.error("follow-up", "Erro no processamento:", e);
    }
  })();

  void processamento;

  return { status: "accepted" };
}
