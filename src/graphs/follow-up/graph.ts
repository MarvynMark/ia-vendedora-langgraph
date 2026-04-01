import { StateGraph, END } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { FollowUpState, type FollowUpStateType } from "./state.ts";
import { gerarPromptFollowup, PROMPT_LEMBRETE } from "./prompts.ts";
import { env } from "../../config/env.ts";
import { buscarKanbanBoard, enviarMensagem, enviarTemplate, enviarArquivo, contarMensagensIncoming, verificarJanela24h, atualizarKanbanTask } from "../../services/chatwoot.ts";
import { fetchComTimeout } from "../../lib/fetch-with-timeout.ts";
import { VIDEO_PLATAFORMA_URL } from "../../tools/enviar-video.ts";
import { CONTEUDO_TEMPLATES } from "../../lib/templates.ts";
import { proximoHorarioComercial } from "../../lib/horario-comercial.ts";
import { buscarHistorico, salvarMensagem } from "../../db/memoria.ts";
import { criarToolsFollowup } from "../../tools/factory.ts";
import { obterCheckpointer } from "../../db/checkpointer.ts";
import { logger } from "../../lib/logger.ts";
import { criarLangfuseHandler, finalizarLangfuseHandler } from "../../lib/langfuse.ts";

// --- Nós do grafo ---

async function buscarFunil(state: FollowUpStateType) {
  logger.info("follow-up", "buscando funil para board:", state.boardId);
  try {
    const board = await buscarKanbanBoard(state.accountId, state.boardId) as {
      steps?: Array<{ id: number; name: string; cancelled?: boolean }>;
    };
    const steps = board.steps ?? [];
    const idEtapaPerdido = steps.find(s => s.cancelled)?.id ?? 0;

    return {
      funilSteps: steps,
      idEtapaPerdido,
    };
  } catch (e) {
    logger.error("follow-up", "Erro ao buscar funil:", e);
    return { funilSteps: [], idEtapaPerdido: 0 };
  }
}

async function classificar(state: FollowUpStateType) {
  const stepName = state.board_step?.name?.toLowerCase() ?? "";
  logger.info("follow-up", "classificando step:", stepName);

  let tipoFollowup: "followup" | "lembrete" | "boas_vindas" | "template_abertura" | "ignorar";

  if (stepName === "conexão" || stepName === "conexao") {
    tipoFollowup = "followup";
  } else if (stepName === "aguardando pagamento") {
    tipoFollowup = "lembrete";
  } else if (stepName === "ganho") {
    tipoFollowup = "boas_vindas";
  } else if (stepName === "primeira mensagem") {
    tipoFollowup = "template_abertura";
  } else {
    tipoFollowup = "ignorar";
  }

  logger.info("follow-up", "tipoFollowup:", tipoFollowup);
  return { tipoFollowup };
}

async function agenteFollowup(state: FollowUpStateType) {
  logger.info("follow-up", "executando agente follow-up...");

  const prompt = gerarPromptFollowup({
    funilSteps: state.funilSteps,
    board_step: state.board_step,
    title: state.title,
    description: state.description,
    dueDate: state.dueDate,
  });

  const tools = criarToolsFollowup({
    accountId: state.accountId,
    boardId: state.boardId,
    taskId: state.taskId,
    funilSteps: state.funilSteps,
    board_step: state.board_step,
  });

  const model = new ChatOpenAI({
    modelName: env.OPENAI_MODEL,
    openAIApiKey: env.OPENAI_API_KEY,
    temperature: 0.7,
  });

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt,
  });

  // Carregar histórico da conversa
  const historico = await buscarHistorico(state.telefone, 50);
  const msgsHistorico = historico.map((m) => {
    if (m.type === "human") return new HumanMessage(m.content);
    return new AIMessage(m.content);
  });

  const userMessage = "<lead qualificado aguardando follow-up>";

  const langfuseHandler = criarLangfuseHandler("follow-up", {
    sessionId: state.telefone,
    userId: state.telefone,
    metadata: { taskId: state.taskId, boardId: state.boardId, tipoFollowup: "followup" },
    tags: ["follow-up"],
  });

  try {
    const resultado = await agent.invoke(
      { messages: [...msgsHistorico, new HumanMessage(userMessage)] },
      langfuseHandler ? { callbacks: [langfuseHandler] } : undefined,
    );

    const msgs = resultado.messages ?? [];
    const last = msgs.filter((m: { _getType: () => string }) => m._getType() === "ai").pop();
    const resposta = last ? (last.content as string) : "";

    return { respostaAgente: resposta };
  } catch (e) {
    logger.error("follow-up", "Erro no agente follow-up:", e);
    return { respostaAgente: "" };
  } finally {
    await finalizarLangfuseHandler(langfuseHandler);
  }
}

async function agenteLembrete(state: FollowUpStateType) {
  logger.info("follow-up", "executando agente lembrete...");

  const model = new ChatOpenAI({
    modelName: env.OPENAI_MODEL,
    openAIApiKey: env.OPENAI_API_KEY,
    temperature: 0.7,
  });

  // Carregar histórico
  const historico = await buscarHistorico(state.telefone, 50);
  const msgsHistorico = historico.map((m) => {
    if (m.type === "human") return new HumanMessage(m.content);
    return new AIMessage(m.content);
  });

  const langfuseHandler = criarLangfuseHandler("follow-up-lembrete", {
    sessionId: state.telefone,
    userId: state.telefone,
    metadata: { taskId: state.taskId, tipoFollowup: "lembrete" },
    tags: ["follow-up", "lembrete"],
  });

  try {
    const resultado = await model.invoke(
      [
        { role: "system", content: PROMPT_LEMBRETE },
        ...msgsHistorico.map(m => ({
          role: m._getType() === "human" ? "user" as const : "assistant" as const,
          content: m.content as string,
        })),
        { role: "user", content: "<lead qualificado aguardando follow-up>" },
      ],
      langfuseHandler ? { callbacks: [langfuseHandler] } : undefined,
    );

    return { respostaAgente: resultado.content as string };
  } catch (e) {
    logger.error("follow-up", "Erro no agente lembrete:", e);
    return { respostaAgente: "" };
  } finally {
    await finalizarLangfuseHandler(langfuseHandler);
  }
}

async function enviarVideoPlataforma(accountId: number, conversationId: number): Promise<void> {
  try {
    logger.info("follow-up", "Baixando vídeo para boas-vindas...");
    const res = await fetchComTimeout(VIDEO_PLATAFORMA_URL, { method: "GET", timeout: 60_000 });
    if (!res.ok) throw new Error(`Download falhou: ${res.status}`);

    const resContentType = res.headers.get("content-type") ?? "";
    if (resContentType.includes("text/html")) {
      throw new Error("URL retornou HTML — verifique se o link do Drive é público");
    }

    const buffer = await res.arrayBuffer();
    await enviarArquivo(accountId, conversationId, new Uint8Array(buffer), "apresentacao-plataforma.mp4", "video/mp4");
    logger.info("follow-up", "Vídeo enviado com sucesso na sequência de boas-vindas");
  } catch (e) {
    logger.error("follow-up", "Erro ao enviar vídeo nas boas-vindas:", e);
  }
}

async function agenteBoasVindas(state: FollowUpStateType) {
  logger.info("follow-up", "iniciando sequência de boas-vindas...");

  const nome = state.title ?? "aluno(a)";
  const accountId = state.accountId;
  const conversationId = state.conversationId;

  // Etapa 1 — Imediato
  const msg1 = `🚀 ${nome}, parabéns por entrar para a Mentoria Vestigium!\nSua matrícula já foi liberada e agora começa o seu processo rumo à aprovação.`;
  try {
    await enviarMensagem(accountId, conversationId, msg1);
    logger.info("follow-up", "boas-vindas etapa 1 enviada");
  } catch (e) {
    logger.error("follow-up", "Erro ao enviar etapa 1 das boas-vindas:", e);
  }

  // Etapas 2–6 em background com delays
  void (async () => {
    // Etapa 2 — +30s: texto + vídeo
    await new Promise(r => setTimeout(r, 30_000));
    try {
      const msg2 = `📌 PASSO 1 — Assista isso antes de tudo\nGravei um vídeo rápido te mostrando:\n• Como acessar a plataforma\n• Onde clicar\n• Como começar suas aulas da forma certa\n\nAssiste agora pra já começar com clareza 🚀`;
      await enviarMensagem(accountId, conversationId, msg2);
      await enviarVideoPlataforma(accountId, conversationId);
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 2 das boas-vindas:", e);
    }

    // Etapa 3 — +1 min
    await new Promise(r => setTimeout(r, 30_000));
    try {
      const msg3 = `📌 PASSO 2 — Criar seu acesso à plataforma\nAcesse aqui:\nhttps://aluno.mentoriavestigium.com.br/dash\n\nClique em "Criar conta gratuitamente", use o e-mail da compra e defina sua senha.\nSeu acesso já estará liberado ✅`;
      await enviarMensagem(accountId, conversationId, msg3);
      logger.info("follow-up", "boas-vindas etapa 3 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 3 das boas-vindas:", e);
    }

    // Etapa 4 — +2 min
    await new Promise(r => setTimeout(r, 60_000));
    try {
      const msg4 = `📌 PASSO 3 — Laudo Inicial (ESSENCIAL)\nAgora preciso que você preencha o seu Laudo Inicial:\nhttps://forms.gle/KwtrpzKPyuy6sFyT6\n\nÉ com base nele que vamos montar todo o seu plano de estudos dentro da mentoria.`;
      await enviarMensagem(accountId, conversationId, msg4);
      logger.info("follow-up", "boas-vindas etapa 4 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 4 das boas-vindas:", e);
    }

    // Etapa 5 — +3 min
    await new Promise(r => setTimeout(r, 60_000));
    try {
      const msg5 = `📌 PASSO 4 — Comunidade oficial\nEntre aqui para receber todos os avisos importantes da mentoria:\n👉 https://chat.whatsapp.com/HS9NlWNw1RuInyZbPDr1FC\n\nIsso aqui é essencial pra você não ficar perdido(a) 👀`;
      await enviarMensagem(accountId, conversationId, msg5);
      logger.info("follow-up", "boas-vindas etapa 5 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 5 das boas-vindas:", e);
    }

    // Etapa 6 — +4 min
    await new Promise(r => setTimeout(r, 60_000));
    try {
      const msg6 = `📌 PASSO 5 — Grupo de disciplina (recomendado)\n👉 https://t.me/+MqIIJEYWzucxZTlh\n\nAqui você vai postar:\n• Sua meta diária batida\n• Tempo em redes sociais\n\nPor gentileza, já salva nosso número de atendimento no suporte.\nSuporte 01: (62) 9 8167-2618`;
      await enviarMensagem(accountId, conversationId, msg6);
      logger.info("follow-up", "boas-vindas etapa 6 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 6 das boas-vindas:", e);
    }
  })();

  // Retorna imediatamente — as etapas 2–6 rodam em background
  return { respostaAgente: "" };
}

const SEQUENCIA_TEMPLATES = [
  { nome: "ta_ai",              proximoDelayMs: 4 * 60 * 60 * 1000 },  // +4h
  { nome: "corrido_followup",   proximoDelayMs: 24 * 60 * 60 * 1000 }, // +24h
  { nome: "olhinho_followup",   proximoDelayMs: 24 * 60 * 60 * 1000 }, // +24h
  { nome: "encerramento_02",    proximoDelayMs: 0 },                    // encerra
];

function lerContadorTemplates(description: string): number {
  const match = description.match(/followup-templates:\s*(\d+)/i);
  return match ? parseInt(match[1]!) : 0;
}

function atualizarContadorTemplates(description: string, novoValor: number): string {
  const linha = `followup-templates: ${novoValor}`;
  if (/followup-templates:\s*\d+/i.test(description)) {
    return description.replace(/followup-templates:\s*\d+/i, linha);
  }
  return description ? `${description}\n${linha}` : linha;
}

async function agenteTemplateAbertura(state: FollowUpStateType) {
  logger.info("follow-up", "executando template de abertura...");

  // Verificar se o lead já respondeu — se sim, para a sequência
  try {
    const totalIncoming = await contarMensagensIncoming(state.accountId, state.conversationId);
    if (totalIncoming > 0) {
      logger.info("follow-up", "Lead já respondeu — encerrando sequência de templates");
      return { respostaAgente: "" };
    }
  } catch (e) {
    logger.warn("follow-up", "Erro ao verificar mensagens incoming:", e);
  }

  const contador = lerContadorTemplates(state.description ?? "");
  const item = SEQUENCIA_TEMPLATES[contador];

  if (!item) {
    logger.info("follow-up", "Sequência de templates esgotada");
    return { respostaAgente: "" };
  }

  logger.info("follow-up", `Enviando mensagem ${item.nome} (${contador + 1}/${SEQUENCIA_TEMPLATES.length})`);

  // Verifica janela de 24h: se o lead está ativo, envia mensagem normal (sem template)
  const dentroJanela = await verificarJanela24h(state.accountId, state.conversationId);

  try {
    if (dentroJanela) {
      const conteudo = CONTEUDO_TEMPLATES[item.nome];
      if (conteudo) {
        logger.info("follow-up", `Janela 24h ativa — enviando mensagem normal ao invés de template: ${item.nome}`);
        await enviarMensagem(state.accountId, state.conversationId, conteudo);
      } else {
        logger.warn("follow-up", `Conteúdo não encontrado para ${item.nome}, usando template mesmo dentro da janela`);
        await enviarTemplate(state.accountId, state.conversationId, item.nome);
      }
    } else {
      logger.info("follow-up", `Fora da janela 24h — enviando template: ${item.nome}`);
      await enviarTemplate(state.accountId, state.conversationId, item.nome);
    }
  } catch (e) {
    logger.error("follow-up", `Erro ao enviar mensagem/template ${item.nome}:`, e);
    return { respostaAgente: "" };
  }

  const novoContador = contador + 1;
  const descricaoAtualizada = atualizarContadorTemplates(state.description ?? "", novoContador);
  const isUltimo = novoContador >= SEQUENCIA_TEMPLATES.length;

  if (isUltimo) {
    // Último template: mover para "Perdido"
    logger.info("follow-up", "Último template enviado — movendo para Perdido");
    await atualizarKanbanTask(state.accountId, state.taskId, {
      board_step_id: state.idEtapaPerdido || undefined,
      description: descricaoAtualizada,
      due_date: undefined,
    });
  } else {
    const proximaData = proximoHorarioComercial(new Date(), item.proximoDelayMs);
    await atualizarKanbanTask(state.accountId, state.taskId, {
      description: descricaoAtualizada,
      due_date: proximaData.toISOString(),
    });
    logger.info("follow-up", `Próximo template agendado para: ${proximaData.toISOString()}`);
  }

  return { respostaAgente: "" };
}

async function enviarMensagemNo(state: FollowUpStateType) {
  if (!state.respostaAgente) {
    logger.info("follow-up", "sem resposta para enviar");
    return {};
  }

  // Verifica janela de 24h — fora da janela, não envia mensagem normal (evita erro 131049)
  const dentroJanela = await verificarJanela24h(state.accountId, state.conversationId);
  if (!dentroJanela) {
    logger.warn("follow-up", `Conversa ${state.conversationId} fora da janela de 24h — mensagem não enviada para evitar 131049`);
    return {};
  }

  logger.info("follow-up", "enviando mensagem para conversa:", state.conversationId);
  await enviarMensagem(state.accountId, state.conversationId, state.respostaAgente);

  // Salvar no histórico para manter memória da conversa
  await salvarMensagem(state.telefone, {
    type: "ai",
    content: state.respostaAgente,
    tool_calls: [],
    additional_kwargs: {},
    response_metadata: {},
    invalid_tool_calls: [],
  });

  return {};
}

// --- Construção do grafo ---

export function rotaClassificacao(state: FollowUpStateType): string {
  switch (state.tipoFollowup) {
    case "followup": return "agente_followup";
    case "lembrete": return "agente_lembrete";
    case "boas_vindas": return "agente_boas_vindas";
    case "template_abertura": return "agente_template_abertura";
    case "ignorar": return "ignorar";
    default: return "ignorar";
  }
}

export async function criarGrafoFollowUp() {
  const checkpointer = await obterCheckpointer();
  const grafo = new StateGraph(FollowUpState)
    .addNode("buscar_funil", buscarFunil)
    .addNode("classificar", classificar)
    .addNode("agente_followup", agenteFollowup)
    .addNode("agente_lembrete", agenteLembrete)
    .addNode("agente_boas_vindas", agenteBoasVindas)
    .addNode("agente_template_abertura", agenteTemplateAbertura)
    .addNode("enviar_mensagem", enviarMensagemNo)

    // Arestas
    .addEdge("__start__", "buscar_funil")
    .addEdge("buscar_funil", "classificar")
    .addConditionalEdges("classificar", rotaClassificacao, {
      agente_followup: "agente_followup",
      agente_lembrete: "agente_lembrete",
      agente_boas_vindas: "agente_boas_vindas",
      agente_template_abertura: "agente_template_abertura",
      ignorar: "__end__",
    })
    .addEdge("agente_followup", "enviar_mensagem")
    .addEdge("agente_lembrete", "enviar_mensagem")
    .addEdge("agente_boas_vindas", "enviar_mensagem")
    .addEdge("agente_template_abertura", "__end__")
    .addEdge("enviar_mensagem", END);

  return grafo.compile({ checkpointer });
}
