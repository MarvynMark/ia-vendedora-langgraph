import { StateGraph, END } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { FollowUpState, type FollowUpStateType } from "./state.ts";
import { env } from "../../config/env.ts";
import { buscarKanbanBoard, enviarMensagem, enviarTemplate, enviarArquivo, contarMensagensIncoming, verificarJanela24h, msRestantesJanela24h, verificarLeadRespondeuUltimo, ultimaMensagemAgente, atualizarKanbanTask } from "../../services/chatwoot.ts";
import { fetchComTimeout } from "../../lib/fetch-with-timeout.ts";
import { VIDEO_BOAS_VINDAS_URL } from "../../tools/enviar-video.ts";
import { CONTEUDO_TEMPLATES } from "../../lib/templates.ts";
import { primeiroNomeSaudacao, substituirNome } from "../../lib/nome.ts";
import { proximoHorarioComercial, agendarMaximizandoJanela } from "../../lib/horario-comercial.ts";

// Espaçamento mínimo anti-spam entre toques grátis ao "espremer" a cadência pra dentro
// da janela de 24h (economiza envios pagos à Meta sem parecer spam).
const MIN_GAP_JANELA_MS = 60 * 60 * 1000; // 1h
import { buscarHistorico, salvarMensagem } from "../../db/memoria.ts";
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
    // Busca por etapa marcada como "cancelled" (Perdido no Chatwoot), com fallback por nome
    const idEtapaPerdido =
      steps.find(s => s.cancelled)?.id ??
      steps.find(s => s.name.toLowerCase().includes("perdido"))?.id ??
      0;
    // Etapa de nutrição de longo prazo — destino do encerramento (em vez de Perdido)
    const idEtapaNutrir =
      steps.find(s => s.name.toLowerCase().includes("nutrir"))?.id ?? 0;

    return {
      funilSteps: steps,
      idEtapaPerdido,
      idEtapaNutrir,
    };
  } catch (e) {
    logger.error("follow-up", "Erro ao buscar funil:", e);
    return { funilSteps: [], idEtapaPerdido: 0, idEtapaNutrir: 0 };
  }
}

// Encerra a sequência de recuperação e move o lead para a esteira de NUTRIÇÃO de longo prazo
// (não "Perdido", que o cron nem rastreia). Zera o contador para o agenteNutrir começar do
// primeiro toque (reengajamento) e agenda o primeiro nurturing em 7 dias. Se a etapa "Nutrir"
// não existir no board, cai para Perdido como antes.
async function encerrarParaNutrir(state: FollowUpStateType): Promise<void> {
  const destino = state.idEtapaNutrir || state.idEtapaPerdido || undefined;
  await atualizarKanbanTask(state.accountId, state.taskId, {
    board_step_id: destino,
    description: atualizarContadorNutrir(state.description ?? "", 0),
    due_date: proximoHorarioComercial(new Date(), 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  logger.info("follow-up", `Encerrado → Nutrir (step ${destino}), contador zerado, próximo nurturing em 7d`);
}

async function classificar(state: FollowUpStateType) {
  // Se tipoFollowup já foi definido pelo chamador (verificar-followups.ts), usa direto
  if (state.tipoFollowup && state.tipoFollowup !== "ignorar") {
    logger.info("follow-up", "tipoFollowup pré-definido:", state.tipoFollowup);
    return { tipoFollowup: state.tipoFollowup };
  }

  const stepName = state.board_step?.name?.toLowerCase() ?? "";
  logger.info("follow-up", "classificando pelo step:", stepName);

  let tipoFollowup: "followup" | "lembrete" | "boas_vindas" | "template_abertura" | "nutrir" | "ignorar";

  if (stepName === "conexão" || stepName === "conexao") {
    tipoFollowup = "followup";
  } else if (stepName === "aguardando pagamento") {
    tipoFollowup = "lembrete";
  } else if (stepName === "ganho") {
    tipoFollowup = "boas_vindas";
  } else if (stepName === "primeira mensagem") {
    tipoFollowup = "template_abertura";
  } else if (stepName === "nutrir" || stepName === "perdido") {
    tipoFollowup = "nutrir";
  } else {
    tipoFollowup = "ignorar";
  }

  logger.info("follow-up", "tipoFollowup:", tipoFollowup);
  return { tipoFollowup };
}

// Sequência de recuperação para leads em Conexão (já conversaram mas pararam de responder)
const SEQUENCIA_RECUPERACAO_CONEXAO = [
  "conexao_followup_1",
  "conexao_followup_2",
  "conexao_followup_3",
] as const;

// Toque 1 dispara no delay INICIAL da etapa (3h). Depois: toque 2 "espremido" pra dentro
// da janela grátis (ideal 24h + clamp da janela); toque 3 no Dia 2 (pago); encerramento Dia 4.
const DELAYS_CONEXAO_MS = [24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 48 * 60 * 60 * 1000] as const;

// Fallback pago (fora da janela 24h), por posição do contador — ângulo de dúvida/reabertura.
const TEMPLATE_FALLBACK_CONEXAO = ["conexao_duvida", "conexao_duvida", "conexao_duvida"] as const;

// Sequência pós-preço: acionada quando lead viu o pitch e sumiu (description contém "status: proposta_apresentada")
const SEQUENCIA_POS_PRECO = [
  "pos_preco_followup_1",
  "pos_preco_followup_2",
  "pos_preco_followup_3",
  "pos_preco_urgencia",
] as const;

// Pós-preço: t1→t2 3h (dentro), t2→t3 espremido (24h+clamp), t3→t4 Dia 2 (pago), t4→enc Dia 3.
const DELAYS_POS_PRECO_MS = [3 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;
const TEMPLATE_FALLBACK_POS_PRECO = ["pos_preco_duvida", "pos_preco_duvida", "pos_preco_duvida", "pos_preco_urgencia"] as const;

async function agenteFollowup(state: FollowUpStateType) {
  logger.info("follow-up", "executando follow-up Conexão...");

  // Se a última mensagem da conversa foi do lead (ele respondeu após o agente), apenas reagenda
  try {
    const leadRespondeuUltimo = await verificarLeadRespondeuUltimo(state.accountId, state.conversationId);
    if (leadRespondeuUltimo) {
      logger.info("follow-up", "Lead respondeu por último — reagendando follow-up Conexão");
      const proxima = proximoHorarioComercial(new Date(), 24 * 60 * 60 * 1000);
      await atualizarKanbanTask(state.accountId, state.taskId, { due_date: proxima.toISOString() });
      return { respostaAgente: "" };
    }
  } catch (e) {
    logger.warn("follow-up", "Erro ao verificar última mensagem:", e);
  }

  const msRestantes = await msRestantesJanela24h(state.accountId, state.conversationId);
  const dentroJanela = msRestantes > 0;
  const contador = lerContadorNutrir(state.description ?? "");
  const primeiroNome = primeiroNomeSaudacao(state.title);
  const isPosPreco = /status:\s*proposta_apresentada/i.test(state.description ?? "");

  // Seleciona sequência, fallbacks e delays conforme contexto
  const sequencia = isPosPreco ? SEQUENCIA_POS_PRECO : SEQUENCIA_RECUPERACAO_CONEXAO;
  const fallbacks = isPosPreco ? TEMPLATE_FALLBACK_POS_PRECO : TEMPLATE_FALLBACK_CONEXAO;
  const delays = isPosPreco ? DELAYS_POS_PRECO_MS : DELAYS_CONEXAO_MS;
  const nomeEncerramento = isPosPreco ? "pos_preco_encerramento" : "conexao_encerramento";

  logger.info("follow-up", `Modo: ${isPosPreco ? "pós-preço" : "conexão"}, contador: ${contador}`);

  // Após N mensagens sem resposta: encerramento → Perdido
  if (contador >= sequencia.length) {
    logger.info("follow-up", `${contador} follow-ups sem resposta — encerrando`);
    const conteudoEnc = substituirNome(CONTEUDO_TEMPLATES[nomeEncerramento] ?? "", state.title);
    try {
      if (dentroJanela) {
        await enviarMensagem(state.accountId, state.conversationId, conteudoEnc);
        if (state.telefone) {
          await salvarMensagem(state.telefone, { type: "ai", content: conteudoEnc, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
        }
      } else {
        await enviarTemplate(state.accountId, state.conversationId, "encerramento_02", CONTEUDO_TEMPLATES["encerramento_02"]);
      }
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar encerramento:", e);
    }
    await encerrarParaNutrir(state);
    return { respostaAgente: "" };
  }

  const nomeMsg = sequencia[contador]!;
  const conteudo = substituirNome(CONTEUDO_TEMPLATES[nomeMsg] ?? "", state.title);
  const templateFallback = fallbacks[contador] ?? "encerramento_02";
  const textoEnviar = dentroJanela ? conteudo : (CONTEUDO_TEMPLATES[templateFallback] ?? "");

  // Trava anti-duplicata: não reenvia se for idêntico ao último que o agente mandou.
  const ultimaAgente = await ultimaMensagemAgente(state.accountId, state.conversationId);
  const ehDuplicata = textoEnviar.trim() !== "" && ultimaAgente.trim() === textoEnviar.trim();

  logger.info("follow-up", `Enviando ${nomeMsg} (${contador + 1}/${sequencia.length}) — janela: ${dentroJanela}${ehDuplicata ? " — PULADO (idêntico ao último)" : ""}`);

  try {
    if (ehDuplicata) {
      // idêntico ao último envio — não reenvia
    } else if (dentroJanela) {
      await enviarMensagem(state.accountId, state.conversationId, conteudo);
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: conteudo, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else {
      await enviarTemplate(state.accountId, state.conversationId, templateFallback, textoEnviar);
    }
  } catch (e) {
    logger.error("follow-up", `Erro ao enviar ${nomeMsg}:`, e);
    return { respostaAgente: "" };
  }

  const novoContador = contador + 1;
  const descricaoAtualizada = atualizarContadorNutrir(state.description ?? "", novoContador);
  const delayProximo = delays[contador] ?? 24 * 60 * 60 * 1000;
  const proxima = agendarMaximizandoJanela(new Date(), delayProximo, msRestantes, { minGapMs: MIN_GAP_JANELA_MS });
  await atualizarKanbanTask(state.accountId, state.taskId, {
    description: descricaoAtualizada,
    due_date: proxima.toISOString(),
  });
  logger.info("follow-up", `Follow-up ${novoContador}/${sequencia.length} enviado — próximo: ${proxima.toISOString()} (janela restante: ${Math.round(msRestantes / 60000)}min)`);

  return { respostaAgente: "" };
}

const SEQUENCIA_LEMBRETE = ["lembrete_1", "lembrete_2", "lembrete_3", "lembrete_urgencia"] as const;
// Toque 1 dispara no delay INICIAL da etapa (30min). Depois: t1→t2 3h (dentro), t2→t3
// "espremido" pra dentro da janela (24h+clamp), t3→t4 Dia 2 (pago), t4→encerramento Dia 3.
const DELAYS_LEMBRETE_MS = [3 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;
// Fallback pago (fora da janela 24h), por posição do contador — reforço de acesso / urgência.
const TEMPLATE_FALLBACK_LEMBRETE = ["lembrete_acesso", "lembrete_acesso", "lembrete_acesso", "lembrete_urgencia_meta"] as const;

async function agenteLembrete(state: FollowUpStateType) {
  logger.info("follow-up", "executando lembrete pré-configurado...");

  const msRestantes = await msRestantesJanela24h(state.accountId, state.conversationId);
  const dentroJanela = msRestantes > 0;
  const contador = lerContadorNutrir(state.description ?? "");
  const primeiroNome = primeiroNomeSaudacao(state.title);

  // Após 4 lembretes sem resposta: encerramento → Perdido
  if (contador >= SEQUENCIA_LEMBRETE.length) {
    logger.info("follow-up", `${contador} lembretes sem resposta — encerrando`);
    const conteudoEnc = substituirNome(CONTEUDO_TEMPLATES["lembrete_encerramento"] ?? "", state.title);
    try {
      if (dentroJanela) {
        await enviarMensagem(state.accountId, state.conversationId, conteudoEnc);
        if (state.telefone) {
          await salvarMensagem(state.telefone, { type: "ai", content: conteudoEnc, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
        }
      } else {
        await enviarTemplate(state.accountId, state.conversationId, "encerramento_02", CONTEUDO_TEMPLATES["encerramento_02"]);
      }
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar encerramento lembrete:", e);
    }
    await encerrarParaNutrir(state);
    return { respostaAgente: "" };
  }

  const nomeMsg = SEQUENCIA_LEMBRETE[contador]!;
  const conteudo = substituirNome(CONTEUDO_TEMPLATES[nomeMsg] ?? "", state.title);
  const templateFallback = TEMPLATE_FALLBACK_LEMBRETE[contador] ?? "encerramento_02";
  const textoEnviar = dentroJanela ? conteudo : (CONTEUDO_TEMPLATES[templateFallback] ?? "");

  // Trava anti-duplicata: se o texto for idêntico ao último que o agente mandou, não reenvia
  // (evita repetir o mesmo template de fallback em toques consecutivos). Contador avança normal.
  const ultimaAgente = await ultimaMensagemAgente(state.accountId, state.conversationId);
  const ehDuplicata = textoEnviar.trim() !== "" && ultimaAgente.trim() === textoEnviar.trim();

  logger.info("follow-up", `Enviando ${nomeMsg} (${contador + 1}/${SEQUENCIA_LEMBRETE.length}) — janela: ${dentroJanela}${ehDuplicata ? " — PULADO (idêntico ao último)" : ""}`);

  try {
    if (ehDuplicata) {
      // idêntico ao último envio — não reenvia
    } else if (dentroJanela) {
      await enviarMensagem(state.accountId, state.conversationId, conteudo);
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: conteudo, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else {
      await enviarTemplate(state.accountId, state.conversationId, templateFallback, textoEnviar);
    }
  } catch (e) {
    logger.error("follow-up", `Erro ao enviar ${nomeMsg}:`, e);
    return { respostaAgente: "" };
  }

  const novoContador = contador + 1;
  const descricaoAtualizada = atualizarContadorNutrir(state.description ?? "", novoContador);
  const delayProximo = DELAYS_LEMBRETE_MS[contador] ?? 24 * 60 * 60 * 1000;
  const proxima = agendarMaximizandoJanela(new Date(), delayProximo, msRestantes, { minGapMs: MIN_GAP_JANELA_MS });
  await atualizarKanbanTask(state.accountId, state.taskId, {
    description: descricaoAtualizada,
    due_date: proxima.toISOString(),
  });
  logger.info("follow-up", `Lembrete ${novoContador}/${SEQUENCIA_LEMBRETE.length} enviado — próximo: ${proxima.toISOString()} (janela restante: ${Math.round(msRestantes / 60000)}min)`);

  return { respostaAgente: "" };
}

async function enviarVideoPlataforma(accountId: number, conversationId: number): Promise<void> {
  try {
    logger.info("follow-up", "Baixando vídeo para boas-vindas...");
    const res = await fetchComTimeout(VIDEO_BOAS_VINDAS_URL, { method: "GET", timeout: 60_000 });
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

  // Só o primeiro nome deixa a saudação mais natural (evita "Renan Martins Paludo").
  // Alinhado aos demais agentes do grafo, que já usam o primeiro nome.
  const primeiroNome = primeiroNomeSaudacao(state.title, "aluno(a)");
  const accountId = state.accountId;
  const conversationId = state.conversationId;

  // Etapa 1 — Imediato
  const msg1 = `🚀 ${primeiroNome}, parabéns por entrar para a Mentoria Vestigium!\nSua matrícula já foi liberada e agora começa o seu processo rumo à aprovação.`;
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
      const msg2 = `Gravei um vídeo rápido te mostrando como acessar a plataforma e por onde começar. Assiste agora pra já entrar com clareza 🚀`;
      await enviarMensagem(accountId, conversationId, msg2);
      await enviarVideoPlataforma(accountId, conversationId);
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 2 das boas-vindas:", e);
    }

    // Etapa 3 — +1 min
    await new Promise(r => setTimeout(r, 30_000));
    try {
      const msg3 = `Agora cria seu acesso à plataforma:\nhttps://aluno.mentoriavestigium.com.br/dash\n\nClica em "Criar conta gratuitamente", usa o e-mail da compra e define sua senha. Seu acesso já está liberado ✅`;
      await enviarMensagem(accountId, conversationId, msg3);
      logger.info("follow-up", "boas-vindas etapa 3 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 3 das boas-vindas:", e);
    }

    // Etapa 4 — +2 min
    await new Promise(r => setTimeout(r, 60_000));
    try {
      const msg4 = `Preciso que você preencha o Laudo Inicial — é essencial pra montar seu plano de estudos dentro da mentoria:\nhttps://forms.gle/KwtrpzKPyuy6sFyT6`;
      await enviarMensagem(accountId, conversationId, msg4);
      logger.info("follow-up", "boas-vindas etapa 4 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 4 das boas-vindas:", e);
    }

    // Etapa 5 — +3 min
    await new Promise(r => setTimeout(r, 60_000));
    try {
      const msg5 = `Entra aqui no grupo oficial da mentoria pra receber todos os avisos importantes:\n👉 https://chat.whatsapp.com/HS9NlWNw1RuInyZbPDr1FC`;
      await enviarMensagem(accountId, conversationId, msg5);
      logger.info("follow-up", "boas-vindas etapa 5 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 5 das boas-vindas:", e);
    }

    // Etapa 6 — +4 min
    await new Promise(r => setTimeout(r, 60_000));
    try {
      const msg6 = `Esse aqui é o grupo de disciplina — recomendo entrar também:\n👉 https://t.me/+MqIIJEYWzucxZTlh\n\nJá salva nosso número de suporte:\n(62) 9 8167-2618`;
      await enviarMensagem(accountId, conversationId, msg6);
      logger.info("follow-up", "boas-vindas etapa 6 enviada");
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar etapa 6 das boas-vindas:", e);
    }
  })();

  // Retorna imediatamente — as etapas 2–6 rodam em background
  return { respostaAgente: "" };
}

// Sequência de recuperação para leads em "Primeira mensagem" (template inicial já enviado).
// 2 toques com ângulo novo: reforço → urgência.
// NOTA: a prova social (fup2_prova_social) ficou FORA por ora — a versão persuasiva dela usa
// mídia (imagem/vídeo) no template, que o Chatwoot 4.15.1 não repassa à Meta (bug #13159).
// Texto pronto em templates.ts pra reativar quando houver caminho de mídia (Cloud API direta).
const SEQUENCIA_RECUPERACAO_PM = ["fup1_reforco", "fup3_urgencia"] as const;

// Delays para agendar A PRÓXIMA ação após enviar a mensagem N (índice = contador atual).
// Dentro da janela 24h (lead chegou a responder): toques mais próximos, encerramento depois.
const DELAYS_DENTRO_JANELA_MS = [2 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;
// Fora da janela (lead frio, quase sempre): reforço → urgência em ~2 dias, encerramento no Dia 3 seguinte.
const DELAYS_FORA_JANELA_MS = [2 * 24 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000] as const;
// Follow-ups sempre dentro do horário comercial (9h-18h SP), inclusive dentro da janela de 24h.
const HORA_MAX_FOLLOWUP_JANELA = 18;

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
  logger.info("follow-up", "executando sequência Primeira mensagem...");
  const primeiroNome = primeiroNomeSaudacao(state.title);

  // Verificar se o lead já respondeu — se sim, para a sequência
  try {
    const totalIncoming = await contarMensagensIncoming(state.accountId, state.conversationId);
    if (totalIncoming > 0) {
      logger.info("follow-up", "Lead já respondeu — encerrando sequência Primeira mensagem");
      return { respostaAgente: "" };
    }
  } catch (e) {
    logger.warn("follow-up", "Erro ao verificar mensagens incoming:", e);
  }

  const msRestantes = await msRestantesJanela24h(state.accountId, state.conversationId);
  const dentroJanela = msRestantes > 0;
  const contador = lerContadorTemplates(state.description ?? "");

  // Contador >= 3: todas as mensagens enviadas → enviar encerramento e mover para Nutrir
  if (contador >= SEQUENCIA_RECUPERACAO_PM.length) {
    logger.info("follow-up", "Sequência Primeira mensagem esgotada — enviando encerramento");
    const conteudoEnc = CONTEUDO_TEMPLATES["encerramento_02"];
    try {
      if (dentroJanela && conteudoEnc) {
        await enviarMensagem(state.accountId, state.conversationId, conteudoEnc);
        if (state.telefone) {
          await salvarMensagem(state.telefone, { type: "ai", content: conteudoEnc, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
        }
      } else {
        await enviarTemplate(state.accountId, state.conversationId, "encerramento_02", conteudoEnc);
      }
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar encerramento Primeira mensagem:", e);
    }
    await encerrarParaNutrir(state);
    return { respostaAgente: "" };
  }

  const nomeMsg = SEQUENCIA_RECUPERACAO_PM[contador]!;
  logger.info("follow-up", `Enviando ${nomeMsg} (${contador + 1}/${SEQUENCIA_RECUPERACAO_PM.length}) — janela: ${dentroJanela}`);

  // Dentro da janela: mensagem normal (não cobra template). Fora: template aprovado.
  const conteudo = substituirNome(CONTEUDO_TEMPLATES[nomeMsg] ?? "", state.title);
  try {
    if (dentroJanela && conteudo) {
      logger.info("follow-up", `Janela 24h ativa — mensagem normal: ${nomeMsg}`);
      await enviarMensagem(state.accountId, state.conversationId, conteudo);
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: conteudo, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else {
      logger.info("follow-up", `Fora da janela — template: ${nomeMsg}`);
      await enviarTemplate(state.accountId, state.conversationId, nomeMsg, conteudo, { "1": primeiroNome });
    }
  } catch (e) {
    logger.error("follow-up", `Erro ao enviar ${nomeMsg}:`, e);
    return { respostaAgente: "" };
  }

  const novoContador = contador + 1;
  const descricaoAtualizada = atualizarContadorTemplates(state.description ?? "", novoContador);

  // Calcular próxima data com timing diferente por status da janela
  const delays = dentroJanela ? DELAYS_DENTRO_JANELA_MS : DELAYS_FORA_JANELA_MS;
  const delayMs = delays[contador] ?? (dentroJanela ? 2 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  // Encerramento (após a última msg da sequência): usa horário padrão 18h. Msgs do mesmo dia: max 20h
  const isEncerramentoAgendado = dentroJanela && contador === SEQUENCIA_RECUPERACAO_PM.length - 1;
  const horaMax = (!isEncerramentoAgendado && dentroJanela) ? HORA_MAX_FOLLOWUP_JANELA : 18;
  // Espreme o próximo toque pra dentro da janela grátis quando possível (economiza template pago).
  const proximaData = agendarMaximizandoJanela(new Date(), delayMs, msRestantes, { minGapMs: MIN_GAP_JANELA_MS, horaFechamento: horaMax });

  await atualizarKanbanTask(state.accountId, state.taskId, {
    description: descricaoAtualizada,
    due_date: proximaData.toISOString(),
  });
  logger.info("follow-up", `Próxima mensagem Primeira mensagem agendada para: ${proximaData.toISOString()} (janela: ${dentroJanela})`);

  return { respostaAgente: "" };
}

function lerContadorNutrir(description: string): number {
  const match = description.match(/🔁\s*-\s*Follow-ups:\s*(\d+)/i) ?? description.match(/follow-ups?\s*enviados?:\s*(\d+)/i);
  return match ? parseInt(match[1]!) : 0;
}

function atualizarContadorNutrir(description: string, novoValor: number): string {
  if (/🔁\s*-\s*Follow-ups:\s*\d+/i.test(description)) {
    return description.replace(/🔁\s*-\s*Follow-ups:\s*\d+/i, `🔁 - Follow-ups: ${novoValor}`);
  }
  if (/follow-ups?\s*enviados?:\s*\d+/i.test(description)) {
    return description.replace(/follow-ups?\s*enviados?:\s*\d+/i, `🔁 - Follow-ups: ${novoValor}`);
  }
  return description ? `${description}\n🔁 - Follow-ups: ${novoValor}` : `🔁 - Follow-ups: ${novoValor}`;
}

const SEQUENCIA_NUTRIR = [
  {
    abordagem: "reengajamento",
    prompt: `Você é o Professor Perito Walker, falando em 1ª pessoa (eu, meu método, minha mentoria). Este lead estava em negociação mas não seguiu em frente. Envie uma mensagem de reengajamento suave — sem pitch, sem pressão. Apenas retome o contato de forma humana e curiosa. Máximo 2 linhas. Não mencione produto nenhum agora.`,
    proximoDelayDias: 7,
  },
  {
    abordagem: "oferta_imlc",
    prompt: `Você é o Professor Perito Walker, falando em 1ª pessoa (eu, meu método, minha mentoria). Este lead não comprou a mentoria. Faça um mini-pitch do meu curso IMLC (Medicina Legal e Criminalística) como porta de entrada. Fale que é o conteúdo que está nos bônus da mentoria, vendido separado por R$397 ou 12x de R$41,06. Encerre perguntando se quer o link. Máximo 3 linhas. Link: https://hotm.io/IMLC`,
    proximoDelayDias: 7,
  },
  {
    abordagem: "oferta_clube",
    prompt: `Você é o Professor Perito Walker, falando em 1ª pessoa (eu, meu método, minha mentoria). Este lead não comprou a mentoria nem o IMLC. Faça um mini-pitch do Clube da Aprovação: planejamento de estudos + plataforma com minhas aulas gravadas por R$97/mês. Diga que dá pra testar por um mês e cancelar quando quiser. Encerre perguntando se quer o link. Máximo 3 linhas. Link: https://pay.plataformatutory.com.br/checkout/4f888bbd-5e7c-41a9-8dba-402f5fe2ea16`,
    proximoDelayDias: 14,
  },
  {
    abordagem: "ebook",
    prompt: `Você é o Professor Perito Walker, falando em 1ª pessoa (eu, meu método, minha mentoria). Este lead não converteu em nenhum produto. Envie o link do meu e-book gratuito como gesto de valor. Diga que é um material meu pra quem quer entrar na área de perícia. Curto, sem pressão. Link: https://www.csiacademy.com.br/ebooks`,
    proximoDelayDias: 30,
  },
];

async function agenteNutrir(state: FollowUpStateType) {
  logger.info("follow-up", "executando agente nutrir...");

  // Verifica se o lead já respondeu recentemente
  try {
    const totalIncoming = await contarMensagensIncoming(state.accountId, state.conversationId);
    if (totalIncoming > 0) {
      logger.info("follow-up", "Lead já respondeu — pausando nurturing");
      // Agenda próximo contato em 30 dias
      const proxima = proximoHorarioComercial(new Date(), 30 * 24 * 60 * 60 * 1000);
      await atualizarKanbanTask(state.accountId, state.taskId, { due_date: proxima.toISOString() });
      return { respostaAgente: "" };
    }
  } catch (e) {
    logger.warn("follow-up", "Erro ao verificar incoming:", e);
  }

  const contador = lerContadorNutrir(state.description ?? "");
  const item = SEQUENCIA_NUTRIR[contador];

  if (!item) {
    // Sequência esgotada — agenda contato passivo em 90 dias
    logger.info("follow-up", "Sequência de nurturing esgotada — agendando contato passivo em 90 dias");
    const proxima = proximoHorarioComercial(new Date(), 90 * 24 * 60 * 60 * 1000);
    await atualizarKanbanTask(state.accountId, state.taskId, { due_date: proxima.toISOString() });
    return { respostaAgente: "" };
  }

  logger.info("follow-up", `Nurturing ${item.abordagem} (${contador + 1}/${SEQUENCIA_NUTRIR.length})`);

  const historico = await buscarHistorico(state.telefone, 30);
  const msgsHistorico = historico.map((m) => {
    if (m.type === "human") return new HumanMessage(m.content);
    return new AIMessage(m.content);
  });

  const model = new ChatOpenAI({
    modelName: env.OPENAI_MODEL,
    openAIApiKey: env.OPENAI_API_KEY,
    temperature: 0.8,
  });

  const langfuseHandler = criarLangfuseHandler("follow-up-nutrir", {
    sessionId: state.telefone,
    userId: state.telefone,
    metadata: { taskId: state.taskId, abordagem: item.abordagem, contador },
    tags: ["follow-up", "nutrir"],
  });

  let resposta = "";
  try {
    const resultado = await model.invoke(
      [
        { role: "system", content: item.prompt },
        ...msgsHistorico.map(m => ({
          role: m._getType() === "human" ? "user" as const : "assistant" as const,
          content: m.content as string,
        })),
        { role: "user", content: "<retomar contato com lead>" },
      ],
      langfuseHandler ? { callbacks: [langfuseHandler] } : undefined,
    );
    resposta = resultado.content as string;
  } catch (e) {
    logger.error("follow-up", "Erro no agente nutrir:", e);
    return { respostaAgente: "" };
  } finally {
    await finalizarLangfuseHandler(langfuseHandler);
  }

  // Atualiza contador e agenda próximo follow-up
  const novoContador = contador + 1;
  const descricaoAtualizada = atualizarContadorNutrir(state.description ?? "", novoContador);
  const proxima = proximoHorarioComercial(new Date(), item.proximoDelayDias * 24 * 60 * 60 * 1000);
  await atualizarKanbanTask(state.accountId, state.taskId, {
    description: descricaoAtualizada,
    due_date: proxima.toISOString(),
  });
  logger.info("follow-up", `Próximo nurturing agendado para: ${proxima.toISOString()}`);

  return { respostaAgente: resposta };
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

// --- Nó: Template inicial (Novo Lead presos sem entrada em leads_template_pendente) ---

async function agenteTemplateInicial(state: FollowUpStateType) {
  logger.info("follow-up", "executando template inicial (Novo Lead)...");
  const primeiroNome = primeiroNomeSaudacao(state.title);

  const dentroJanela = await verificarJanela24h(state.accountId, state.conversationId);

  // Se o lead já enviou mensagem: move para "Primeira mensagem" sem enviar template
  try {
    const totalIncoming = await contarMensagensIncoming(state.accountId, state.conversationId);
    if (totalIncoming > 0) {
      logger.info("follow-up", "Lead já enviou mensagem — pulando template inicial, movendo para Primeira mensagem");
      const stepPM = state.funilSteps.find(s => s.name.toLowerCase().includes("primeira mensagem"));
      if (stepPM) {
        await atualizarKanbanTask(state.accountId, state.taskId, { board_step_id: stepPM.id });
      }
      return { respostaAgente: "" };
    }
  } catch (e) {
    logger.warn("follow-up", "Erro ao verificar incoming:", e);
  }

  const conteudo = substituirNome(CONTEUDO_TEMPLATES["abertura02"] ?? "", state.title);

  try {
    if (dentroJanela && conteudo) {
      logger.info("follow-up", "Janela aberta — enviando mensagem normal (template inicial)");
      await enviarMensagem(state.accountId, state.conversationId, conteudo);
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: conteudo, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else {
      logger.info("follow-up", "Enviando template inicial: abertura02");
      await enviarTemplate(state.accountId, state.conversationId, "abertura02", conteudo, { "1": primeiroNome });
    }
  } catch (e) {
    logger.error("follow-up", "Erro ao enviar template inicial:", e);
    return { respostaAgente: "" };
  }

  // Mover card para "Primeira mensagem"
  const stepPM = state.funilSteps.find(s => s.name.toLowerCase().includes("primeira mensagem"));
  if (stepPM) {
    await atualizarKanbanTask(state.accountId, state.taskId, { board_step_id: stepPM.id });
    logger.info("follow-up", `Card movido para "Primeira mensagem" (step ${stepPM.id})`);
  } else {
    logger.warn("follow-up", "Etapa 'Primeira mensagem' não encontrada no funil");
  }

  return { respostaAgente: "" };
}

// --- Construção do grafo ---

export function rotaClassificacao(state: FollowUpStateType): string {
  switch (state.tipoFollowup) {
    case "template_inicial":  return "agente_template_inicial";
    case "followup":          return "agente_followup";
    case "lembrete":          return "agente_lembrete";
    case "boas_vindas":       return "agente_boas_vindas";
    case "template_abertura": return "agente_template_abertura";
    case "nutrir":            return "agente_nutrir";
    case "ignorar":           return "ignorar";
    default:                  return "ignorar";
  }
}

export async function criarGrafoFollowUp() {
  const checkpointer = await obterCheckpointer();
  const grafo = new StateGraph(FollowUpState)
    .addNode("buscar_funil", buscarFunil)
    .addNode("classificar", classificar)
    .addNode("agente_template_inicial", agenteTemplateInicial)
    .addNode("agente_followup", agenteFollowup)
    .addNode("agente_lembrete", agenteLembrete)
    .addNode("agente_boas_vindas", agenteBoasVindas)
    .addNode("agente_template_abertura", agenteTemplateAbertura)
    .addNode("agente_nutrir", agenteNutrir)
    .addNode("enviar_mensagem", enviarMensagemNo)

    // Arestas
    .addEdge("__start__", "buscar_funil")
    .addEdge("buscar_funil", "classificar")
    .addConditionalEdges("classificar", rotaClassificacao, {
      agente_template_inicial: "agente_template_inicial",
      agente_followup: "agente_followup",
      agente_lembrete: "agente_lembrete",
      agente_boas_vindas: "agente_boas_vindas",
      agente_template_abertura: "agente_template_abertura",
      agente_nutrir: "agente_nutrir",
      ignorar: "__end__",
    })
    .addEdge("agente_template_inicial", "__end__")
    .addEdge("agente_followup", "enviar_mensagem")
    .addEdge("agente_lembrete", "enviar_mensagem")
    .addEdge("agente_boas_vindas", "enviar_mensagem")
    .addEdge("agente_template_abertura", "__end__")
    .addEdge("agente_nutrir", "enviar_mensagem")
    .addEdge("enviar_mensagem", END);

  return grafo.compile({ checkpointer });
}
