import { Elysia } from "elysia";
import { z } from "zod";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import {
  buscarContatoPorQuery,
  buscarConversasDoContato,
  atualizarKanbanTask,
  buscarKanbanBoard,
  adicionarEtiquetas,
  enviarMensagem,
  reabrirConversa,
  criarConversa,
  enviarArquivo,
} from "../services/chatwoot.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { VIDEO_BOAS_VINDAS_URL } from "../tools/enviar-video.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";

const INBOX_ALUNOS_WALKER = 15;
const DELAY_BOAS_VINDAS_WALKER_MS = 15 * 60 * 1000; // 15 minutos
const DELAY_ENTRE_MSGS_MS = 15_000; // 15 segundos
// URL permanente MinIO — não usar pre-signed URLs (expiram em horas)
const VIDEO_BOAS_VINDAS_WALKER_URL = "https://minio.stkd.site/api/v1/buckets/arquivosclientes/objects/download?preview=true&prefix=Vestigium%2Fvideo-walker-boas-vindas-novo-aluno.mp4";

let grafoFollowup: Awaited<ReturnType<typeof criarGrafoFollowUp>> | null = null;
async function obterGrafoFollowup() {
  if (!grafoFollowup) grafoFollowup = await criarGrafoFollowUp();
  return grafoFollowup;
}

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
  is_reissue: z.number().optional(), // 0 = nova compra, 1 = parcela recorrente (não confiável: DMG envia 0 em cobranças recorrentes)
  subscription: z.object({
    charged_times: z.number().optional(), // > 1 = cobrança recorrente posterior à primeira
  }).optional(),
  invoice: z.object({
    cycle: z.number().optional(), // > 1 = cobrança de ciclo recorrente posterior
  }).optional(),
});

export const pagamentoRouter = new Elysia()
  .post("/webhook/pagamento", async ({ body }) => {
    logger.info("pagamento", ">>> Webhook recebido", { temPayloadWrapper: !!(body as Record<string, unknown>)["payload"] });
    registrarWebhook("/webhook/pagamento", body, "recebido");

    // A DMGuru envolve os dados em um campo "payload" — extrair antes de validar
    const rawBody = body as Record<string, unknown>;
    const dadosParaValidar = (rawBody["payload"] && typeof rawBody["payload"] === "object")
      ? rawBody["payload"]
      : body;

    const parsed = dmGuruPayloadSchema.safeParse(dadosParaValidar);
    if (!parsed.success) {
      logger.warn("pagamento", "Payload inválido:", parsed.error.issues);
      return { status: "error", reason: "invalid_payload" };
    }

    // Só processar transações aprovadas
    if (parsed.data.status !== "approved") {
      logger.info("pagamento", "Ignorado: status não é approved:", parsed.data.status);
      return { status: "ignored", reason: "not_approved" };
    }

    // Só processar a 1ª cobrança — ignorar parcelas recorrentes posteriores.
    // is_reissue não é confiável (DMG envia 0 em parcelas recorrentes), então
    // checamos também charged_times e cycle: > 1 indica cobrança não-inicial.
    const chargedTimes = parsed.data.subscription?.charged_times;
    const invoiceCycle = parsed.data.invoice?.cycle;
    const ehCobrancaPosterior =
      parsed.data.is_reissue === 1 ||
      (typeof chargedTimes === "number" && chargedTimes > 1) ||
      (typeof invoiceCycle === "number" && invoiceCycle > 1);

    if (ehCobrancaPosterior) {
      logger.info("pagamento", "Ignorado: cobrança recorrente posterior à 1ª", {
        is_reissue: parsed.data.is_reissue,
        charged_times: chargedTimes,
        cycle: invoiceCycle,
      });
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
  let contato: { id: number; name: string; phone_number?: string; email?: string; custom_attributes?: Record<string, unknown> } | null = null;

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

  // Proteção contra duplicata antecipada (antes de qualquer ação)
  if ((task.description ?? "").includes("boas-vindas: enviado")) {
    logger.info("pagamento", "Boas-vindas já enviadas anteriormente — ignorando");
    return;
  }

  // Mover card para "Ganho" e setar due_date para agora (disparo imediato).
  // "boas-vindas: enviado" é incluído aqui para chegar ao Chatwoot antes do
  // evento kanban_task_overdue, evitando race condition com o followup.ts.
  try {
    await atualizarKanbanTask(accountId, task.id, {
      board_step_id: etapaGanho.id,
      due_date: new Date().toISOString(),
      description: [
        task.description ?? "",
        `💳 - Plano: ${dados.nomeOferta || dados.nomeProduto}`,
        "boas-vindas: enviado",
      ].filter(Boolean).join("\n"),
    });
    logger.info("pagamento", "Card movido para Ganho. TaskId:", task.id);
  } catch (e) {
    logger.error("pagamento", "Erro ao mover card para Ganho:", e);
    return;
  }

  // Notificar grupo de suporte sobre novo aluno
  try {
    await reabrirConversa(accountId, env.CHATWOOT_ALERT_CONVERSATION_ID);
  } catch (e) {
    logger.warn("pagamento", "Falha ao reabrir conversa do grupo (ignorado, tentando enviar mesmo assim):", e);
  }
  try {
    const telefoneFormatado = dados.telefone
      ? dados.telefone.replace(/^\+55/, "").replace(/(\d{2})(\d{4,5})(\d{4})/, "($1) $2-$3")
      : "(não informado)";
    const nomeProdutoNotificacao = dados.nomeOferta || dados.nomeProduto || "Mentoria Vestigium";
    const mensagemGrupo = `✅✅ NOVO ALUNO MENTORIA: ${dados.nome ?? contato.name}\nEmail: ${dados.email ?? "(não informado)"}\nTelefone: ${telefoneFormatado}\n${nomeProdutoNotificacao}`;
    await enviarMensagem(
      accountId,
      env.CHATWOOT_ALERT_CONVERSATION_ID,
      mensagemGrupo,
    );
    logger.info("pagamento", "Notificação de novo aluno enviada ao grupo de suporte");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar notificação ao grupo de suporte:", e);
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

  // Descrição final (já persista no Kanban acima) — usada no invoke do grafo
  const descricaoAtual = [
    task.description ?? "",
    `💳 - Plano: ${dados.nomeOferta || dados.nomeProduto}`,
    "boas-vindas: enviado",
  ].filter(Boolean).join("\n");

  // Disparar grafo de follow-up com tipo boas_vindas diretamente (não depender do webhook overdue)
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
      description: descricaoAtual,
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

  // Boas-vindas do Walker (inbox #ALUNOS WALKER) DESATIVADAS temporariamente.
  // Reativar removendo o comentário abaixo.
  // void agendarBoasVindasWalker(accountId, contato.id, dados.nome ?? contato.name, contato.custom_attributes ?? {});
  logger.info("pagamento", "Boas-vindas Walker DESATIVADAS (inbox #ALUNOS WALKER) — não enviando");
}

function detectarGenero(primeiroNome: string): "m" | "f" {
  // Nomes masculinos comuns que terminam em 'a' — exceções à regra geral
  const excecoesMasculinas = new Set(["luca", "elias", "tobias", "matias", "thomas", "barba", "sousa"]);
  const nome = primeiroNome.toLowerCase().trim();
  return (nome.endsWith("a") && !excecoesMasculinas.has(nome)) ? "f" : "m";
}

async function agendarBoasVindasWalker(
  accountId: number,
  contatoId: number,
  nomeAluno: string,
  customAttributes: Record<string, unknown> = {},
) {
  await new Promise(r => setTimeout(r, DELAY_BOAS_VINDAS_WALKER_MS));

  logger.info("pagamento", "Enviando boas-vindas do Walker pelo inbox #ALUNOS WALKER para:", nomeAluno);

  // Buscar ou criar conversa no inbox ALUNOS WALKER
  let conversationId: number;
  try {
    const conversa = await criarConversa(accountId, {
      inbox_id: INBOX_ALUNOS_WALKER,
      contact_id: contatoId,
    });
    conversationId = conversa.id;
    logger.info("pagamento", "Conversa criada no inbox ALUNOS WALKER:", conversationId);
  } catch (e) {
    logger.error("pagamento", "Erro ao criar conversa no inbox ALUNOS WALKER:", e);
    return;
  }

  const primeiroNome = nomeAluno.split(" ")[0] ?? nomeAluno;
  const genero = detectarGenero(primeiroNome);
  const isMedico = String(customAttributes.qual_formacao ?? "").toLowerCase().includes("medicina");
  const tratamento = isMedico ? (genero === "f" ? "Dra. " : "Dr. ") : "";
  const nomeFormatado = `${tratamento}${primeiroNome}`;
  const teloTela = genero === "f" ? "tê-la" : "tê-lo";

  // Mensagem 1
  try {
    await enviarMensagem(accountId, conversationId, `Olá, ${nomeFormatado}, tudo bem?\n\nProfessor Walker por aqui!`);
    logger.info("pagamento", "Walker boas-vindas msg 1 enviada");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar msg 1 Walker:", e);
  }

  await new Promise(r => setTimeout(r, DELAY_ENTRE_MSGS_MS));

  // Mensagem 2
  try {
    await enviarMensagem(accountId, conversationId, `Passando para desejar as boas-vindas na mentoria Vestigium!\n\nOlha, é um prazer enorme ${teloTela} aqui, rumo à sua aprovação de uma forma mais eficiente e também mais otimizada.`);
    logger.info("pagamento", "Walker boas-vindas msg 2 enviada");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar msg 2 Walker:", e);
  }

  await new Promise(r => setTimeout(r, DELAY_ENTRE_MSGS_MS));

  // Mensagem 3
  try {
    await enviarMensagem(accountId, conversationId, `Pra gente começar da melhor maneira possível, até porque a mentoria Vestigium é um acompanhamento bem de perto, vou enviar aqui agora um vídeo falando sobre três recados importantes nesse seu início na mentoria.\n\nEntão assista, aplique e, o que precisar, pode contar comigo, tá bom? 😊`);
    logger.info("pagamento", "Walker boas-vindas msg 3 enviada");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar msg 3 Walker:", e);
  }

  await new Promise(r => setTimeout(r, DELAY_ENTRE_MSGS_MS));

  // Mensagem 4 — vídeo do celular do Walker
  try {
    const res = await fetchComTimeout(VIDEO_BOAS_VINDAS_WALKER_URL, { method: "GET", timeout: 60_000 });
    if (!res.ok) throw new Error(`Download do vídeo falhou: ${res.status}`);
    const buffer = await res.arrayBuffer();
    await enviarArquivo(accountId, conversationId, new Uint8Array(buffer), "video-walker-boas-vindas.mp4", "video/mp4");
    logger.info("pagamento", "Walker boas-vindas vídeo enviado");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar vídeo Walker boas-vindas:", e);
    try {
      await enviarMensagem(accountId, conversationId, `Acesse diretamente por esse link:\n${VIDEO_BOAS_VINDAS_WALKER_URL}`);
    } catch {}
  }

  await new Promise(r => setTimeout(r, DELAY_ENTRE_MSGS_MS));

  // Mensagem 5 — vídeo de onboarding da plataforma
  try {
    const res = await fetchComTimeout(VIDEO_BOAS_VINDAS_URL, { method: "GET", timeout: 60_000 });
    if (!res.ok) throw new Error(`Download do vídeo de onboarding falhou: ${res.status}`);
    const buffer = await res.arrayBuffer();
    await enviarArquivo(accountId, conversationId, new Uint8Array(buffer), "onboarding-plataforma.mp4", "video/mp4");
    logger.info("pagamento", "Vídeo de onboarding da plataforma enviado");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar vídeo de onboarding da plataforma:", e);
    try {
      await enviarMensagem(accountId, conversationId, `Acesse diretamente por esse link:\n${VIDEO_BOAS_VINDAS_URL}`);
    } catch {}
  }
}
