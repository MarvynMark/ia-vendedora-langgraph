import { StateGraph, END } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { MainAgentState, type MainAgentStateType } from "./state.ts";
import { gerarPromptAgentePrincipal } from "./prompt.ts";
import { env } from "../../config/env.ts";
import { enfileirarMensagem, buscarUltimaMensagem, coletarELimparMensagens } from "../../db/fila.ts";
import { tentarAdquirirLock, liberarLock } from "../../db/lock.ts";
import { buscarHistorico, salvarMensagem } from "../../db/memoria.ts";
import { buscarMensagemPorId, enviarMensagem, enviarArquivo, marcarComoLida, atualizarPresenca } from "../../services/chatwoot.ts";
import { gerarAudioTts } from "../../services/elevenlabs.ts";
import { formatarSsml as formatarSsmlFn, formatarTexto as formatarTextoFn, dividirMensagem } from "../../lib/response-formatter.ts";
import { criarToolsAgenteVestigium } from "../../tools/factory.ts";
import { obterCheckpointer } from "../../db/checkpointer.ts";
import { logger } from "../../lib/logger.ts";
import { criarLangfuseHandler, finalizarLangfuseHandler } from "../../lib/langfuse.ts";

// --- Nós do grafo ---

async function enfileirar(state: MainAgentStateType) {
  logger.info("main-agent", "enfileirar:", state.idMensagem);
  await enfileirarMensagem(
    state.idMensagem,
    state.telefone,
    state.mensagemProcessada,
    state.timestamp,
  );
  return {};
}

async function esperarDebounce(_state: MainAgentStateType) {
  logger.info("main-agent", "esperando debounce...");
  await new Promise((resolve) => setTimeout(resolve, env.DEBOUNCE_DELAY_MS));
  return {};
}

async function verificarStale(state: MainAgentStateType) {
  const ultima = await buscarUltimaMensagem(state.telefone);
  const stale = ultima ? ultima.idMensagem !== state.idMensagem : false;
  logger.info("main-agent", "verificarStale:", stale);
  return { stale };
}

function chaveLock(state: MainAgentStateType) {
  return `${state.idInbox}_${state.telefone}`;
}

async function tentarLockNo(state: MainAgentStateType) {
  const lockTentativas = (state.lockTentativas ?? 0) + 1;
  const adquirido = await tentarAdquirirLock(chaveLock(state));
  logger.info("main-agent", "tentarLock:", { adquirido, tentativa: lockTentativas });
  if (adquirido) {
    try { await marcarComoLida(state.idConta, state.idConversa); } catch (e) { logger.warn("main-agent", "marcarComoLida:", e); }
  }
  return { locked: !adquirido, lockTentativas };
}

async function esperarRetry(_state: MainAgentStateType) {
  logger.info("main-agent", "esperando retry do lock...");
  await new Promise((resolve) => setTimeout(resolve, env.LOCK_RETRY_DELAY_MS));
  return {};
}

async function buscarReferenciada(state: MainAgentStateType) {
  if (!state.idMensagemReferenciada) {
    return { mensagemReferenciada: null };
  }
  try {
    logger.info("main-agent", "buscando mensagem referenciada:", state.idMensagemReferenciada);
    const conteudo = await buscarMensagemPorId(
      state.idConta,
      state.idConversa,
      state.idMensagemReferenciada,
    );
    return { mensagemReferenciada: conteudo };
  } catch (e) {
    logger.error("main-agent", "buscarReferenciada erro:", e);
    return { mensagemReferenciada: null, erroFatal: true };
  }
}

export async function coletarMensagens(state: MainAgentStateType) {
  try {
    logger.info("main-agent", "coletando mensagens da fila para:", state.telefone);
    const mensagensAgregadas = await coletarELimparMensagens(state.telefone);
    logger.info("main-agent", "mensagens coletadas:", { length: mensagensAgregadas.length, preview: mensagensAgregadas.substring(0, 200) });
    return { mensagensAgregadas };
  } catch (e) {
    logger.error("main-agent", "coletarMensagens erro:", e);
    return { mensagensAgregadas: "", erroFatal: true };
  }
}

async function executarAgente(state: MainAgentStateType) {
  logger.info("main-agent", "executando agente IA...");

  const tarefa = state.tarefa ?? {};
  const board = tarefa["board"] as { steps?: Array<{ id: number; name: string }> } | undefined;
  const etapas = board?.steps ?? [];
  const etapasDescricao = etapas.map(s => `${s.name}: ${s.id}`).join("\n") || "(não disponível)";

  const dataHoraAtual = new Date().toLocaleString("pt-BR", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: env.TZ,
  });

  const systemPrompt = gerarPromptAgentePrincipal({
    tarefa,
    etapasDescricao,
    dataHoraAtual,
    dadosFormulario: state.dadosFormulario,
    atributosContato: state.atributosContato,
  });

  const tools = criarToolsAgenteVestigium({
    idMensagem: state.idMensagem,
    idConta: state.idConta,
    idConversa: state.idConversa,
    idContato: state.idContato,
    idInbox: state.idInbox,
    telefone: state.telefone,
    nome: state.nome,
    mensagem: state.mensagensAgregadas || state.mensagemProcessada,
    tarefa,
  });

  const model = new ChatOpenAI({
    modelName: env.OPENAI_MODEL,
    openAIApiKey: env.OPENAI_API_KEY,
    temperature: 0.7,
  });

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt: systemPrompt,
  });

  // Carregar histórico da memória
  const historico = await buscarHistorico(state.telefone, 50);
  const mensagensHistorico = historico
    .map((m) => {
      if (m.type === "human") {
        return new HumanMessage(m.content);
      }
      return new AIMessage(m.content);
    })
    .filter((m) => {
      // Filtrar mensagens SISTEMA do histórico: o LLM não deve ver "Apresente-se" em conversas já iniciadas
      if (m._getType() !== "human") return true;
      const content = typeof m.content === "string" ? m.content : "";
      return !content.startsWith("[SISTEMA:");
    });

  // Montar user message
  let userMessage = state.mensagensAgregadas || state.mensagemProcessada;
  if (state.mensagemReferenciada) {
    userMessage = `<mensagem-referenciada>\n${state.mensagemReferenciada}\n</mensagem-referenciada>\n\n${userMessage}`;
  }

  const temHistoricoAI = mensagensHistorico.some(m => m._getType() === "ai");

  // Bloquear execução se for trigger SISTEMA e a conversa já foi iniciada
  // (cobre o caso de dois timers dispararem simultaneamente — o segundo é descartado após o primeiro salvar no histórico)
  const mensagemOriginal = state.mensagensAgregadas || state.mensagemProcessada;
  if (temHistoricoAI && mensagemOriginal.startsWith("[SISTEMA:")) {
    logger.info("main-agent", "Trigger SISTEMA ignorado: conversa já iniciada, pulando apresentação duplicada");
    return { outputAgente: "" };
  }

  // Injeção estrutural: se há histórico AI, avisar explicitamente que a conversa já está em andamento
  if (temHistoricoAI) {
    const lastAi = mensagensHistorico.filter(m => m._getType() === "ai").at(-1);
    const ultimaResposta = typeof lastAi?.content === "string"
      ? lastAi.content.substring(0, 100)
      : "";
    userMessage = `[CONTEXTO OBRIGATÓRIO DO SISTEMA: Você JÁ se apresentou para este lead. A conversa está em andamento. Sua última mensagem enviada foi: "${ultimaResposta}". NÃO envie a Mensagem 1 nem se reapresente. Responda DIRETAMENTE ao que o lead disse abaixo.]\n\n${userMessage}`;
  }

  const messages = [
    ...mensagensHistorico,
    new HumanMessage(userMessage),
  ];

  logger.info("main-agent", ">>> Chamando LLM", {
    historicoLen: mensagensHistorico.length,
    userMessage: userMessage.substring(0, 200),
    model: env.OPENAI_MODEL,
    toolCount: tools.length,
  });

  const langfuseHandler = criarLangfuseHandler("main-agent", {
    sessionId: state.telefone,
    userId: state.telefone,
    metadata: { idConversa: state.idConversa, idContato: state.idContato, nome: state.nome },
    tags: ["main-agent"],
  });

  try {
    const resultado = await agent.invoke(
      { messages },
      langfuseHandler ? { callbacks: [langfuseHandler] } : undefined,
    );
    const msgs = resultado.messages ?? [];
    // Concatenar conteúdo de TODAS as mensagens AI (não só a última)
    // Evita perder texto escrito antes de uma tool call (ex: lista de bônus na Etapa 6)
    const output = msgs
      .filter((m: { _getType: () => string }) => m._getType() === "ai")
      .map((m: { content: unknown }) => (typeof m.content === "string" ? m.content : ""))
      .filter(s => s.trim().length > 0)
      .join("\n\n");

    // Salvar user message no histórico (não salvar mensagens SISTEMA — elas confundem o LLM ao reaparecer)
    if (!mensagemOriginal.startsWith("[SISTEMA:")) {
      await salvarMensagem(state.telefone, {
        type: "human",
        content: userMessage,
        tool_calls: [],
        additional_kwargs: {},
        response_metadata: {},
        invalid_tool_calls: [],
      });
    }

    logger.info("main-agent", "output do agente:", output.substring(0, 100) + "...");

    return { outputAgente: output };
  } catch (e) {
    logger.error("main-agent", "Erro no agente:", e);
    return { outputAgente: "", erroFatal: true };
  } finally {
    await finalizarLangfuseHandler(langfuseHandler);
  }
}

async function verificarNovasMsgs(state: MainAgentStateType) {
  try {
    const ultima = await buscarUltimaMensagem(state.telefone);
    const novas = ultima !== null;
    logger.info("main-agent", "verificarNovasMsgs:", novas);
    return { novasMensagens: novas };
  } catch (e) {
    logger.error("main-agent", "verificarNovasMsgs erro:", e);
    return { novasMensagens: false, erroFatal: true };
  }
}

async function formatarSsmlNo(state: MainAgentStateType) {
  try {
    logger.info("main-agent", "formatando SSML...");
    const ssml = await formatarSsmlFn(state.outputAgente);
    return { ssml };
  } catch (e) {
    logger.error("main-agent", "formatarSsmlNo erro:", e);
    return { ssml: "", erroFatal: true };
  }
}

async function gerarAudio(state: MainAgentStateType) {
  logger.info("main-agent", "gerando áudio TTS...");
  // Show "recording" indicator only during actual audio generation (matches n8n timing)
  try {
    await atualizarPresenca(state.idConta, state.idConversa, "recording");
  } catch (e) {
    logger.error("main-agent", "atualizarPresenca erro:", e);
  }
  try {
    const audioBuffer = await gerarAudioTts(state.ssml);
    return { audioBuffer };
  } catch (e) {
    logger.error("main-agent", "Erro ao gerar áudio, fallback para texto:", e);
    return { audioBuffer: null };
  }
}

async function enviarTextoComHistorico(state: MainAgentStateType) {
  // Salvar histórico ANTES de enviar — evita que resposta do lead durante o envio
  // (que pode levar 30s+ com múltiplos blocos) cause reinício da conversa por falta de contexto
  await salvarMensagem(state.telefone, {
    type: "ai", content: state.outputAgente,
    tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [],
  });
  const formatado = await formatarTextoFn(state.outputAgente);
  const blocos = dividirMensagem(formatado);
  for (let i = 0; i < blocos.length; i++) {
    if (i > 0) {
      await atualizarPresenca(state.idConta, state.idConversa, true);
      await new Promise(r => setTimeout(r, 5000));
      await atualizarPresenca(state.idConta, state.idConversa, false);
    }
    await enviarMensagem(state.idConta, state.idConversa, blocos[i]!);
  }
}

export async function enviarAudioNo(state: MainAgentStateType) {
  if (state.audioBuffer) {
    logger.info("main-agent", "enviando áudio...");
    try {
      // Salvar histórico ANTES de enviar o áudio pelo mesmo motivo que o texto
      await salvarMensagem(state.telefone, {
        type: "ai",
        content: state.outputAgente,
        tool_calls: [],
        additional_kwargs: {},
        response_metadata: {},
        invalid_tool_calls: [],
      });
      await enviarArquivo(
        state.idConta,
        state.idConversa,
        state.audioBuffer,
        "resposta.mp3",
        "audio/mpeg",
        { isRecordedAudio: true, transcribedText: state.outputAgente },
      );
      return {};
    } catch (e) {
      logger.error("main-agent", "Erro ao enviar áudio, fallback para texto:", e);
    }
  }

  // Fallback: enviar como texto
  await enviarTextoComHistorico(state);
  return {};
}

async function formatarTextoNo(state: MainAgentStateType) {
  try {
    logger.info("main-agent", "formatando texto...");
    try {
      await atualizarPresenca(state.idConta, state.idConversa, true);
    } catch (e) {
      logger.error("main-agent", "atualizarPresenca erro:", e);
    }
    const respostaFormatada = await formatarTextoFn(state.outputAgente);
    return { respostaFormatada };
  } catch (e) {
    logger.error("main-agent", "formatarTextoNo erro:", e);
    return { respostaFormatada: "", erroFatal: true };
  }
}

async function enviarTextoNo(state: MainAgentStateType) {
  try {
    logger.info("main-agent", "enviando texto...");
    await enviarTextoComHistorico(state);
    return {};
  } catch (e) {
    logger.error("main-agent", "enviarTextoNo erro:", e);
    return { erroFatal: true };
  }
}

async function enviarErroFallback(state: MainAgentStateType) {
  try {
    await enviarMensagem(state.idConta, state.idConversa,
      "Desculpe, estou com dificuldades técnicas. Um atendente entrará em contato em breve.");
  } catch (e) {
    logger.error("main-agent", "Erro ao enviar fallback:", e);
  }
  return {};
}

async function liberarLockNo(state: MainAgentStateType) {
  logger.info("main-agent", "liberando lock para:", chaveLock(state));
  try { await atualizarPresenca(state.idConta, state.idConversa, false); } catch (e) { logger.warn("main-agent", "atualizarPresenca:", e); }
  await liberarLock(chaveLock(state));
  return {};
}

// --- Construção do grafo ---

export function rotaStale(state: MainAgentStateType): string {
  const dest = state.stale ? "end" : "tentar_lock";
  logger.info("main-agent", `rotaStale → ${dest}`, { stale: state.stale, idMensagem: state.idMensagem });
  return dest;
}

export function rotaLock(state: MainAgentStateType): string {
  let dest: string;
  if (!state.locked) dest = "buscar_referenciada";
  else if (state.lockTentativas >= env.LOCK_MAX_RETRIES) dest = "end";
  else dest = "esperar_retry";
  logger.info("main-agent", `rotaLock → ${dest}`, { locked: state.locked, tentativas: state.lockTentativas });
  return dest;
}

export function rotaNovasMsgs(state: MainAgentStateType): string {
  let dest: string;
  if (state.erroFatal) dest = "enviar_erro_fallback";
  else if (state.novasMensagens) dest = "liberar_lock";
  else {
    const output = state.outputAgente ?? "";
    if (!output || output.startsWith("Agent stopped") || output.trim() === "") {
      dest = "liberar_lock";
    } else {
      dest = state.mensagemDeAudio ? "formatar_ssml" : "formatar_texto";
    }
  }
  logger.info("main-agent", `rotaNovasMsgs → ${dest}`, {
    erroFatal: state.erroFatal,
    novasMensagens: state.novasMensagens,
    mensagemDeAudio: state.mensagemDeAudio,
    outputLen: (state.outputAgente ?? "").length,
  });
  return dest;
}

function rotaErroOuProximo(proximo: string) {
  return (state: MainAgentStateType) => state.erroFatal ? "liberar_lock" : proximo;
}

export async function criarGrafoAgenteClinica() {
  const checkpointer = await obterCheckpointer();
  const grafo = new StateGraph(MainAgentState)
    .addNode("enfileirar", enfileirar)
    .addNode("esperar_debounce", esperarDebounce)
    .addNode("verificar_stale", verificarStale)
    .addNode("tentar_lock", tentarLockNo)
    .addNode("esperar_retry", esperarRetry)
    .addNode("buscar_referenciada", buscarReferenciada)
    .addNode("coletar_mensagens", coletarMensagens)
    .addNode("executar_agente", executarAgente)
    .addNode("verificar_novas_msgs", verificarNovasMsgs)
    .addNode("formatar_ssml", formatarSsmlNo)
    .addNode("gerar_audio", gerarAudio)
    .addNode("enviar_audio", enviarAudioNo)
    .addNode("formatar_texto", formatarTextoNo)
    .addNode("enviar_texto", enviarTextoNo)
    .addNode("enviar_erro_fallback", enviarErroFallback)
    .addNode("liberar_lock", liberarLockNo)

    // Arestas
    .addEdge("__start__", "enfileirar")
    .addEdge("enfileirar", "esperar_debounce")
    .addEdge("esperar_debounce", "verificar_stale")
    .addConditionalEdges("verificar_stale", rotaStale, {
      end: "__end__",
      tentar_lock: "tentar_lock",
    })
    .addConditionalEdges("tentar_lock", rotaLock, {
      buscar_referenciada: "buscar_referenciada",
      esperar_retry: "esperar_retry",
      end: "__end__",
    })
    .addEdge("esperar_retry", "tentar_lock")
    .addConditionalEdges("buscar_referenciada", rotaErroOuProximo("coletar_mensagens"), {
      coletar_mensagens: "coletar_mensagens",
      liberar_lock: "liberar_lock",
    })
    .addConditionalEdges("coletar_mensagens", rotaErroOuProximo("executar_agente"), {
      executar_agente: "executar_agente",
      liberar_lock: "liberar_lock",
    })
    .addConditionalEdges("executar_agente", rotaErroOuProximo("verificar_novas_msgs"), {
      verificar_novas_msgs: "verificar_novas_msgs",
      liberar_lock: "liberar_lock",
    })
    .addConditionalEdges("verificar_novas_msgs", rotaNovasMsgs, {
      enviar_erro_fallback: "enviar_erro_fallback",
      formatar_ssml: "formatar_ssml",
      formatar_texto: "formatar_texto",
      liberar_lock: "liberar_lock",
    })
    .addConditionalEdges("formatar_ssml", rotaErroOuProximo("gerar_audio"), {
      gerar_audio: "gerar_audio",
      liberar_lock: "liberar_lock",
    })
    .addEdge("gerar_audio", "enviar_audio")
    .addEdge("enviar_audio", "liberar_lock")
    .addConditionalEdges("formatar_texto", rotaErroOuProximo("enviar_texto"), {
      enviar_texto: "enviar_texto",
      liberar_lock: "liberar_lock",
    })
    .addEdge("enviar_texto", "liberar_lock")
    .addEdge("enviar_erro_fallback", "liberar_lock")
    .addEdge("liberar_lock", END);

  return grafo.compile({ checkpointer });
}
