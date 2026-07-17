import { Elysia } from "elysia";
import { z } from "zod";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import {
  buscarContatoPorQuery,
  buscarConversasDoContato,
  atualizarKanbanTask,
  buscarKanbanBoard,
  adicionarEtiquetas,
  removerEtiquetas,
  enviarMensagem,
  reabrirConversa,
  criarConversa,
  criarKanbanTask,
  enviarArquivo,
} from "../services/chatwoot.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { VIDEO_BOAS_VINDAS_URL } from "../tools/enviar-video.ts";
import { primeiroNomeSaudacao } from "../lib/nome.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";
import { tentarAdquirirLock, liberarLock } from "../db/lock.ts";
import { montarChaveIdempotenciaPagamento } from "../lib/idempotencia-pagamento.ts";

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
  // DMG envia [] quando não é assinatura — aceitar array ou objeto
  subscription: z.union([
    z.object({ charged_times: z.number().optional() }),
    z.array(z.unknown()),
  ]).optional(),
  invoice: z.union([
    z.object({ cycle: z.number().optional() }),
    z.array(z.unknown()),
  ]).optional(),
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
    const chargedTimes = Array.isArray(parsed.data.subscription) ? undefined : parsed.data.subscription?.charged_times;
    const invoiceCycle = Array.isArray(parsed.data.invoice) ? undefined : parsed.data.invoice?.cycle;
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

export interface PagamentoAprovadoDados {
  nome?: string;
  email?: string;
  telefone?: string;
  nomeProduto: string;
  nomeOferta: string;
}

// Lógica de processamento agnóstica de plataforma de pagamento (DMGuru, TMB, ...):
// localiza o contato/card no Chatwoot, move para "Ganho", notifica o grupo e
// dispara as boas-vindas. Reusada por todos os webhooks de pagamento.
export async function processarPagamentoAprovado(dados: PagamentoAprovadoDados) {
  // Idempotência: plataformas de pagamento reenviam o mesmo evento de aprovação
  // (às vezes 2x em poucos segundos). Sem lock, duas execuções concorrentes passam
  // pela checagem "boas-vindas: enviado" antes de qualquer uma gravar o marcador
  // (TOCTOU) e o grupo + o aluno recebem a notificação e as boas-vindas em dobro.
  // tentarAdquirirLock é um UPSERT atômico: só a 1ª execução prossegue; a 2ª aborta.
  // A chave namespaced ("pagamento:") evita colisão com o lock do agente principal,
  // que usa o telefone puro como session_id. O marcador "boas-vindas: enviado" no
  // card segue como backstop para duplicatas sequenciais (após o lock ser liberado).
  const chaveIdempotencia = montarChaveIdempotenciaPagamento(dados);
  if (!(await tentarAdquirirLock(chaveIdempotencia))) {
    logger.info("pagamento", "Webhook de pagamento duplicado ignorado (lock ativo)", { chave: chaveIdempotencia });
    return;
  }
  try {
    await processarPagamentoAprovadoInterno(dados);
  } finally {
    await liberarLock(chaveIdempotencia).catch((e) =>
      logger.warn("pagamento", "Falha ao liberar lock de idempotência", { chave: chaveIdempotencia, erro: String(e) }),
    );
  }
}

async function processarPagamentoAprovadoInterno(dados: PagamentoAprovadoDados) {
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
    // Remover o 9º dígito caso DMG envie formato novo (66984208276) mas Chatwoot tenha formato antigo (6684208276)
    const semNono = semPais.replace(/^(\d{2})9(\d{7,8})$/, "$1$2");
    if (semNono !== semPais) variantesTelefone.push(`+55${semNono}`, `55${semNono}`, semNono);
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
  let conversaComTask = conversas.find(c => c.kanban_task && Object.keys(c.kanban_task).length > 0);

  // Fallback: contato encontrado mas sem card no Kanban — criar conversa na API Comercial e card automaticamente
  if (!conversaComTask?.kanban_task) {
    logger.warn("pagamento", "Sem kanban_task para contato — criando conversa e card automaticamente:", contato.id);
    try {
      const board = await buscarKanbanBoard(accountId, 1) as {
        steps?: Array<{ id: number; name: string }>;
      };
      const ganhoStep = (board.steps ?? []).find(s => s.name.toLowerCase() === "ganho");
      if (!ganhoStep) {
        logger.error("pagamento", "Etapa 'Ganho' não encontrada no fallback");
        return;
      }
      const novaConversa = await criarConversa(accountId, {
        inbox_id: Number(env.CHATWOOT_INBOX_ID),
        contact_id: contato.id,
      });
      const novaTask = await criarKanbanTask(accountId, {
        board_id: 1,
        board_step_id: ganhoStep.id,
        title: contato.name,
        conversation_id: novaConversa.id,
      });
      logger.info("pagamento", "Conversa e card criados no fallback:", { conversaId: novaConversa.id, taskId: novaTask.id });
      conversaComTask = {
        id: novaConversa.id,
        inbox_id: Number(env.CHATWOOT_INBOX_ID),
        kanban_task: {
          id: novaTask.id,
          board_id: 1,
          title: contato.name,
          description: undefined,
        },
      };
    } catch (e) {
      logger.error("pagamento", "Erro ao criar conversa/card no fallback:", e);
      return;
    }
  }

  if (!conversaComTask?.kanban_task) {
    logger.error("pagamento", "Kanban task indisponível mesmo após fallback — abortando");
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

  // Notificar grupo de suporte sobre novo aluno.
  // Ordem importa: enviar primeiro (Baileys enfileira a msg), depois reabrir
  // (Baileys entrega as msgs pendentes ao reabrir). Inverter a ordem causa falha.
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
  try {
    await reabrirConversa(accountId, env.CHATWOOT_ALERT_CONVERSATION_ID);
  } catch (e) {
    logger.warn("pagamento", "Falha ao reabrir conversa do grupo:", e);
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

  // Desliga o main agent nesta conversa: com o pagamento confirmado, quem conduz o onboarding é a
  // sequência determinística de boas-vindas (abaixo) + o time. Sem isso, o agente continuaria
  // respondendo o lead (ex.: pedindo pra descrever o comprovante) e colidiria com as boas-vindas,
  // gerando mensagens fora de ordem. O webhook do agente ignora conversas sem "agente-on".
  try {
    await removerEtiquetas(accountId, conversaComTask.id, ["agente-on"]);
    logger.info("pagamento", "Etiqueta 'agente-on' removida (main agent desligado pós-pagamento):", conversaComTask.id);
  } catch (e) {
    logger.warn("pagamento", "Erro ao remover etiqueta agente-on:", e);
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

  // Boas-vindas do Walker (inbox #ALUNOS WALKER, número pessoal do Walker), 15 min após o pagamento.
  void agendarBoasVindasWalker(accountId, contato.id, dados.nome ?? contato.name, contato.custom_attributes ?? {});
  logger.info("pagamento", "Boas-vindas Walker agendada (inbox #ALUNOS WALKER)");
}

function detectarGenero(primeiroNome: string): "m" | "f" {
  const nome = primeiroNome.toLowerCase().trim();
  // Nomes femininos que NÃO terminam em 'a' (senão cairiam como masculino por engano)
  const femininas = new Set([
    "beatriz", "raquel", "ester", "esther", "isabel", "isabelle", "miriam", "míriam", "ruth", "rachel",
    "íris", "iris", "inês", "ines", "mercedes", "lourdes", "solange", "denise", "elaine", "simone", "ivone",
    "viviane", "luciane", "eliane", "cristiane", "adriane", "ariane", "fabiane", "juliane", "tatiane",
    "rosane", "roseane", "silvane", "susane", "josiane", "gabriele", "michele", "daniele", "caroline",
    "alice", "dulce", "meire", "eloíse", "heloíse", "sarah", "abigail", "jael", "sol",
    // terminados em y/i (femininos comuns no BR)
    "marjory", "kelly", "nataly", "sthefany", "emily", "hanny", "mary", "gaby", "any", "dany", "fanny",
    "jenny", "sthefani", "kamili", "emilli", "jheni", "evelyn", "jaqueline", "jacqueline", "nicole",
    "helen", "hellen", "karen", "karin", "liz", "mel", "flor",
  ]);
  // Nomes masculinos que terminam em 'a' — exceções à regra geral
  const masculinas = new Set(["luca", "elias", "tobias", "matias", "thomas", "barba", "sousa", "josua", "noa"]);
  if (femininas.has(nome)) return "f";
  if (masculinas.has(nome)) return "m";
  return nome.endsWith("a") ? "f" : "m";
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

  // Nome blindado: nunca usa telefone/wa_id como nome (helper primeiroNomeSaudacao).
  const primeiroNome = primeiroNomeSaudacao(nomeAluno);
  const genero = detectarGenero(primeiroNome);
  const isMedico = String(customAttributes.qual_formacao ?? "").toLowerCase().includes("medicina");
  // Dr./Dra. só para médicos E só quando há nome válido.
  const tratamento = (isMedico && primeiroNome) ? (genero === "f" ? "Dra. " : "Dr. ") : "";
  const nomeFormatado = primeiroNome ? `${tratamento}${primeiroNome}` : "";
  // Com nome: "Oi Maria!" / "Oi Dr. João!"; sem nome válido: "Oi!"
  const saudacao = nomeFormatado ? `Oi ${nomeFormatado}!` : "Oi!";

  // Mensagem 1
  try {
    await enviarMensagem(accountId, conversationId, `${saudacao} É o Walker de novo, agora te falando do meu número pessoal. É por aqui que vou te acompanhar mais de perto agora que você tá oficialmente na mentoria.`);
    logger.info("pagamento", "Walker boas-vindas msg 1 enviada");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar msg 1 Walker:", e);
  }

  await new Promise(r => setTimeout(r, DELAY_ENTRE_MSGS_MS));

  // Mensagem 2
  try {
    await enviarMensagem(accountId, conversationId, `Quero te dar as boas-vindas de verdade à Vestigium. Fico muito feliz de ter você comigo nessa caminhada rumo à sua aprovação. 🚀`);
    logger.info("pagamento", "Walker boas-vindas msg 2 enviada");
  } catch (e) {
    logger.error("pagamento", "Erro ao enviar msg 2 Walker:", e);
  }

  await new Promise(r => setTimeout(r, DELAY_ENTRE_MSGS_MS));

  // Mensagem 3
  try {
    await enviarMensagem(accountId, conversationId, `Pra gente começar com o pé direito, gravei um vídeo rápido com 3 recados importantes desse seu início na mentoria. Assiste com calma e, o que precisar, é só me chamar por aqui, combinado?`);
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
