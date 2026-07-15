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
import { buscarMensagemPorId, enviarMensagem, enviarArquivo, marcarComoLida, atualizarPresenca, pausaComDigitando, calcularDelayDigitando, limparTextosMidia, blocoDuplicaMidia, blocoNarraEnvioMidia, blocoNarraAcaoInterna, blocoTemFraseProibida, blocoEhNomeDeTool } from "../../services/chatwoot.ts";
import { gerarAudioTts } from "../../services/elevenlabs.ts";
import { formatarSsml as formatarSsmlFn, formatarTexto as formatarTextoFn, dividirMensagem, dividirEmFrases } from "../../lib/response-formatter.ts";
import { criarToolsAgenteVestigium } from "../../tools/factory.ts";
import { enviarVideoPlataforma } from "../../tools/enviar-video.ts";
import { enviarImagemEntregaveis } from "../../tools/enviar-imagem-entregaveis.ts";
import { enviarAudioWalker } from "../../tools/enviar-audio-walker.ts";
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

// Guarda determinística de mídia: o LLM às vezes NARRA que enviou o vídeo (5B) ou a imagem de
// entregáveis (5C) sem chamar a tool correspondente — nesses casos a mídia nunca chega ao lead
// (comportamento observado na conversa 3433). Aqui detectamos a frase de confirmação SEM o tool
// call e enviamos a mídia deterministicamente, antes do texto de confirmação ir para o WhatsApp.
// O dedupe interno das tools (Set por conversa) evita envio duplicado.
async function garantirMidiaEntregue(
  output: string,
  toolsChamadas: Set<string>,
  idConta: string,
  idConversa: string,
) {
  const txt = output.toLowerCase();

  // Imagem de entregáveis (5C): "esses são (todos) os entregáveis" = IA acha que já mostrou a imagem
  const confirmouEntregaveis = /esses s[ãa]o (todos )?os entreg[áa]veis/.test(txt);
  if (confirmouEntregaveis && !toolsChamadas.has("Enviar_imagem_entregaveis")) {
    logger.warn("main-agent", "Guarda de mídia: IA confirmou entregáveis sem chamar a tool — enviando imagem deterministicamente");
    try {
      await enviarImagemEntregaveis(idConta, idConversa);
    } catch (e) {
      logger.error("main-agent", "garantirMidiaEntregue (imagem) erro:", e);
    }
  }

  // Vídeo da plataforma (5B): frases pós-envio ("acabei de te enviar o vídeo", "assim que assistir o vídeo")
  const confirmouVideo =
    /(acabei de te enviar|te enviei|assim que.{0,20}assistir).{0,40}v[ií]deo/.test(txt) ||
    /v[ií]deo.{0,40}assim que.{0,20}assistir/.test(txt);
  if (confirmouVideo && !toolsChamadas.has("Enviar_video_plataforma")) {
    logger.warn("main-agent", "Guarda de mídia: IA confirmou vídeo sem chamar a tool — enviando vídeo deterministicamente");
    try {
      await enviarVideoPlataforma(idConta, idConversa);
    } catch (e) {
      logger.error("main-agent", "garantirMidiaEntregue (vídeo) erro:", e);
    }
  }

  // Áudio 1 do Walker: a IA sempre escreve "vou te mandar um áudio" logo antes de enviá-lo.
  // Se narrou sem chamar a tool, o áudio nunca chegaria — enviamos deterministicamente.
  const confirmouAudio1 = /vou te (mandar|enviar|passar) (um )?[áa]udio/.test(txt);
  if (confirmouAudio1 && !toolsChamadas.has("Enviar_audio_walker_1")) {
    logger.warn("main-agent", "Guarda de mídia: IA anunciou áudio 1 sem chamar a tool — enviando áudio deterministicamente");
    try {
      await enviarAudioWalker(1, idConta, idConversa);
    } catch (e) {
      logger.error("main-agent", "garantirMidiaEntregue (áudio 1) erro:", e);
    }
  }

  // O LLM às vezes escreve o NOME da tool de mídia como texto ("Enviar_audio_walker_2") em vez de
  // chamá-la (conversa 4154), então a mídia nunca chega. Se o nome aparece e a tool não foi
  // chamada, dispara deterministicamente. O dedupe interno de cada tool evita envio duplicado.
  const midiasPorNome: Array<[RegExp, string, () => Promise<unknown>]> = [
    [/enviar_audio_walker_1/, "Enviar_audio_walker_1", () => enviarAudioWalker(1, idConta, idConversa)],
    [/enviar_audio_walker_2/, "Enviar_audio_walker_2", () => enviarAudioWalker(2, idConta, idConversa)],
    [/enviar_video_plataforma/, "Enviar_video_plataforma", () => enviarVideoPlataforma(idConta, idConversa)],
    [/enviar_imagem_entregaveis/, "Enviar_imagem_entregaveis", () => enviarImagemEntregaveis(idConta, idConversa)],
  ];
  for (const [re, nome, enviar] of midiasPorNome) {
    if (re.test(txt) && !toolsChamadas.has(nome)) {
      logger.warn("main-agent", `Guarda de mídia: nome da tool ${nome} vazou como texto sem chamada — enviando deterministicamente`);
      try {
        await enviar();
      } catch (e) {
        logger.error("main-agent", `garantirMidiaEntregue (${nome}) erro:`, e);
      }
    }
  }
}

async function executarAgente(state: MainAgentStateType) {
  logger.info("main-agent", "executando agente IA...");

  // Zera o registro de textos de mídia deste turno (as tools de áudio o preenchem ao enviar o
  // mensagem_antes, e o envio do output filtra blocos que dupliquem esse texto)
  limparTextosMidia(state.idConversa);

  const tarefa = state.tarefa ?? {};
  const board = tarefa["board"] as { steps?: Array<{ id: number; name: string }> } | undefined;
  const etapas = board?.steps ?? [];
  const etapasDescricao = etapas.map(s => `${s.name}: ${s.id}`).join("\n") || "(não disponível)";

  const dataHoraAtual = new Date().toLocaleString("pt-BR", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: env.TZ,
  });

  // Carregar histórico antes de montar o system prompt para poder injetar contexto de continuação
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

  const temHistoricoAI = mensagensHistorico.some(m => m._getType() === "ai");

  let systemPrompt = gerarPromptAgentePrincipal({
    tarefa,
    etapasDescricao,
    dataHoraAtual,
    dadosFormulario: state.dadosFormulario,
    atributosContato: state.atributosContato,
    nomeLead: state.nome,
  });

  // Injetar no system prompt quando a conversa já está em andamento
  // (mais autoritativo que injeção no userMessage — o LLM prioriza system prompt)
  if (temHistoricoAI) {
    systemPrompt = systemPrompt + `\n\n⚠️ INSTRUÇÃO CRÍTICA: Esta conversa JÁ está em andamento. Você JÁ se apresentou e provavelmente já avançou no roteiro (reação inicial, áudios, vídeo, imagem). NÃO repita NENHUMA etapa que já fez: não reapresente, não refaça a reação da Mensagem 2, não reofereça nem prometa "reenviar" um áudio/vídeo/imagem que já mandou (cada mídia vai UMA vez só na conversa). Apenas responda ao que o lead acabou de escrever, continuando do ponto atual. Se o lead questionar se é automático/bot ou disser algo como "deixa pra lá", responda com naturalidade e brevidade e NÃO reinicie o roteiro.`;
  }

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

  // Montar user message
  let userMessage = state.mensagensAgregadas || state.mensagemProcessada;
  if (state.mensagemReferenciada) {
    userMessage = `<mensagem-referenciada>\n${state.mensagemReferenciada}\n</mensagem-referenciada>\n\n${userMessage}`;
  }

  // Bloquear execução se for trigger SISTEMA e a conversa já foi iniciada
  // (cobre o caso de dois timers dispararem simultaneamente — o segundo é descartado após o primeiro salvar no histórico)
  const mensagemOriginal = state.mensagensAgregadas || state.mensagemProcessada;
  if (temHistoricoAI && mensagemOriginal.startsWith("[SISTEMA:")) {
    logger.info("main-agent", "Trigger SISTEMA ignorado: conversa já iniciada, pulando apresentação duplicada");
    return { outputAgente: "" };
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
    // Pegar apenas mensagens NOVAS (geradas pelo agente), ignorando o histórico passado como input
    // Sem isso, respostas anteriores do AI são re-concatenadas no output, causando snowball
    const newMsgs = msgs.slice(messages.length);
    const output = newMsgs
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

    // Coletar quais tools o agente chamou neste turno (para a guarda de mídia determinística)
    const toolsChamadas = new Set<string>();
    for (const m of newMsgs) {
      const tcs = (m as unknown as { tool_calls?: Array<{ name?: string }> }).tool_calls;
      if (Array.isArray(tcs)) {
        for (const tc of tcs) {
          if (tc?.name) toolsChamadas.add(tc.name);
        }
      }
    }
    await garantirMidiaEntregue(output, toolsChamadas, state.idConta, state.idConversa);

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
  // Cada frase vira uma mensagem separada (bolhas distintas). Remove frases que o LLM repetiu
  // do texto já enviado como apresentação de áudio/vídeo (mensagem_antes).
  const frases = dividirMensagem(formatado)
    .flatMap((bloco) => dividirEmFrases(bloco))
    .filter((f) => !blocoDuplicaMidia(state.idConversa, f) && !blocoNarraEnvioMidia(state.idConversa, f) && !blocoNarraAcaoInterna(f) && !blocoTemFraseProibida(f) && !blocoEhNomeDeTool(f));
  for (const frase of frases) {
    // "Digitando" com delay proporcional ao tamanho ANTES de cada mensagem, simulando digitação
    await pausaComDigitando(state.idConta, state.idConversa, calcularDelayDigitando(frase));
    await enviarMensagem(state.idConta, state.idConversa, frase);
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
