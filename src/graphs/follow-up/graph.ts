import { StateGraph, END } from "@langchain/langgraph";
import { FollowUpState, type FollowUpStateType } from "./state.ts";
import { env } from "../../config/env.ts";
import { buscarKanbanBoard, enviarMensagem, enviarTemplate, contarMensagensIncoming, verificarJanela24h, msRestantesJanela24h, verificarLeadRespondeuUltimo, ultimaMensagemAgente, atualizarKanbanTask } from "../../services/chatwoot.ts";
import { CONTEUDO_TEMPLATES } from "../../lib/templates.ts";
import { primeiroNomeSaudacao, substituirNome, substituirCampos } from "../../lib/nome.ts";
import { ehMedicoPorFormacao } from "../../lib/medico.ts";
import { buscarCamposFormulario } from "../../db/formulario.ts";
import { proximoHorarioComercial, agendarMaximizandoJanela } from "../../lib/horario-comercial.ts";
import { AUDIO_WALKER_POSPRECO_URL, enviarAudioPorUrl } from "../../tools/enviar-audio-walker.ts";

// Espaçamento mínimo anti-spam entre toques grátis ao "espremer" a cadência pra dentro
// da janela de 24h (economiza envios pagos à Meta sem parecer spam).
const MIN_GAP_JANELA_MS = 60 * 60 * 1000; // 1h
import { salvarMensagem } from "../../db/memoria.ts";
import { obterCheckpointer } from "../../db/checkpointer.ts";
import { logger } from "../../lib/logger.ts";

// Envia um template Meta (fora da janela de 24h) E persiste no histórico, para que o registro
// da conversa reflita o que o lead recebeu. Sem isso, todo envio de template ficava invisível
// para análise E para o próprio agente (que relia o histórico e não sabia o que já mandou).
// O ramo "dentro da janela" (enviarMensagem) já salvava; os ramos de template não.
export async function enviarTemplateComHistorico(
  state: FollowUpStateType,
  templateName: string,
  texto: string,
  primeiroNome: string,
): Promise<void> {
  await enviarTemplate(state.accountId, state.conversationId, templateName, texto, { "1": primeiroNome });
  if (state.telefone && texto.trim() !== "") {
    await salvarMensagem(state.telefone, { type: "ai", content: texto, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
  }
}

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

export async function classificar(state: FollowUpStateType) {
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
    // "Aguardando Pagamento" tem duas subpopulações, distinguidas por "link enviado" na descrição:
    // - COM "link enviado" = comprometeu-se, falta pagar → lembrete ("o link ainda tá ativo").
    // - SEM "link enviado" = viu o preço e sumiu (link nunca foi mandado) → sequência PÓS-PREÇO.
    // O DEFAULT é PÓS-PREÇO. Antes o default era lembrete (e ainda pior: no cron o tipo vinha
    // pré-definido como "lembrete", ver verificar-followups.ts), então leads sem link recebiam
    // "o link ainda tá ativo" sobre um link que nunca existiu — o "link fantasma" do diagnóstico,
    // e a SEQUENCIA_POS_PRECO nunca disparava.
    const temLink = /link\s*enviado/i.test(state.description ?? "");
    tipoFollowup = temLink ? "lembrete" : "followup";
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

// Médico segue a trilha Médico Legista, que NÃO tem downsell — por isso não recebe o toque da
// "versão enxuta" (Semestral de Perito). Detecção em src/lib/medico.ts, compartilhada com o
// prompt do agente principal e com o gate de material.

// Sequência de recuperação para leads em Conexão (já conversaram mas pararam de responder)
const SEQUENCIA_RECUPERACAO_CONEXAO = [
  "conexao_followup_1",
  "conexao_followup_2",
  "conexao_followup_3",
] as const;

// Toque 1 dispara no delay INICIAL da etapa (1h, ver STEPS_RASTREADOS). Depois: toque 2 "espremido" pra dentro
// da janela grátis (ideal 24h + clamp da janela); toque 3 no Dia 2 (pago); encerramento Dia 4.
const DELAYS_CONEXAO_MS = [24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 48 * 60 * 60 * 1000] as const;

// Fallback pago (fora da janela 24h), por posição do contador — ângulo de dúvida/reabertura.
const TEMPLATE_FALLBACK_CONEXAO = ["conexao_1", "conexao_2", "conexao_duvida"] as const;

// Sequência pós-preço (viu o pitch e sumiu — está em "Aguardando Pagamento" sem "link enviado"):
// cutucada de reforço → versão enxuta 6 meses → parcelado → garantia → prova social (D+7) →
// última chamada consultiva (D+14). Cadência mais longa e espaçada porque o pós-preço é o
// maior vazamento do funil e a recuperação antes morria em 24-48h (diagnóstico).
const SEQUENCIA_POS_PRECO = [
  "pos_preco_reforco",       // t1: cutucada leve reforçando a proposta
  "pos_preco_audio_walker",  // t2: ÁUDIO do Walker (dentro da janela 24h) — conexão + abre o Semestral
  "recuperacao_enxuta",      // t3: reforça o Semestral em texto (se o áudio não fechou)
  "pos_preco_followup_2",    // t4: parcelado sem limite
  "pos_preco_prova_social",  // t5: prova social (~D+7)
  "pos_preco_ultima_chamada",// t6: última chamada consultiva (~D+14)
] as const;

// Marcador do toque de áudio (não é um template de texto — enviado por enviarAudioPorUrl).
const TOQUE_AUDIO_POSPRECO = "pos_preco_audio_walker";

// Pós-preço: t1(entrada)→t2 3h (áudio no mesmo dia, dentro da janela grátis), t2→t3 e t3→t4 dia
// seguinte, t4→t5 ~D+7 (prova social), t5→t6 ~D+14 (última chamada), t6→encerramento +3d.
const DELAYS_POS_PRECO_MS = [3 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 5 * 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000] as const;
// Fallbacks pagos (fora da janela 24h), por posição. O áudio (t2) não pode ser template Meta →
// fora da janela cai em recuperacao_enxuta (abre o Semestral em texto). Toques novos (prova
// social/última chamada) também caem em fallback aprovado (duvida/urgencia).
const TEMPLATE_FALLBACK_POS_PRECO = ["pos_preco_reforco", "recuperacao_enxuta", "recuperacao_enxuta", "pos_preco_duvida", "pos_preco_duvida", "pos_preco_urgencia"] as const;

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
  // Pós-preço = está em "Aguardando Pagamento" (viu o pitch) e ainda NÃO recebeu link.
  // Antes dependia só de "status: proposta_apresentada" (que o agente nem sempre grava), por
  // isso a SEQUENCIA_POS_PRECO quase nunca disparava. Agora espelha classificar(): basta estar
  // em Aguardando Pagamento sem "link enviado". Leads em Conexão (outro step) continuam na
  // SEQUENCIA_RECUPERACAO_CONEXAO normalmente (isPosPreco = false).
  const stepNameFollowup = state.board_step?.name?.toLowerCase() ?? "";
  const temLinkEnviado = /link\s*enviado/i.test(state.description ?? "");
  const isPosPreco = stepNameFollowup === "aguardando pagamento" && !temLinkEnviado;

  // Dados do formulário (concurso/formação) + detecção de médico (trilha Médico Legista, sem downsell).
  const campos = await buscarCamposFormulario(state.telefone);
  const ehMedico = ehMedicoPorFormacao(campos?.formacao);

  // Seleciona sequência, fallbacks e delays conforme contexto (cópia mutável p/ guarda de médico).
  const sequencia: string[] = [...(isPosPreco ? SEQUENCIA_POS_PRECO : SEQUENCIA_RECUPERACAO_CONEXAO)];
  const fallbacks: string[] = [...(isPosPreco ? TEMPLATE_FALLBACK_POS_PRECO : TEMPLATE_FALLBACK_CONEXAO)];
  const delays = isPosPreco ? DELAYS_POS_PRECO_MS : DELAYS_CONEXAO_MS;
  const nomeEncerramento = isPosPreco ? "pos_preco_encerramento" : "conexao_encerramento";

  // Guarda de médico: não oferecer o downsell Semestral de Perito — nem o áudio que ABRE o
  // Semestral, nem o toque "versão enxuta". Troca ambos por um toque de dúvida (texto).
  if (ehMedico) {
    for (const chave of [TOQUE_AUDIO_POSPRECO, "recuperacao_enxuta"]) {
      const i = sequencia.indexOf(chave);
      if (i >= 0) { sequencia[i] = "pos_preco_followup_1"; fallbacks[i] = "pos_preco_duvida"; }
    }
  }

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
        await enviarTemplateComHistorico(state, "encerramento", conteudoEnc, primeiroNome);
      }
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar encerramento:", e);
    }
    await encerrarParaNutrir(state);
    return { respostaAgente: "" };
  }

  // Retomada agendada (rec #13): se o agente combinou um retorno numa data e marcou "retomar:" na
  // descrição, o PRIMEIRO toque acknowledge o combinado (retomada_agendada) em vez do template
  // genérico — corrige o "Confirmar o quê?" (follow-up que contradizia o acordo). Depois segue a
  // cadência normal (o marcador é removido na atualização da descrição, abaixo).
  const temRetomarAgendado = /retomar:/i.test(state.description ?? "") && contador === 0;
  const nomeMsg = temRetomarAgendado ? "retomada_agendada" : sequencia[contador]!;

  // Toque de ÁUDIO pós-preço (rec do usuário): o Walker fala direto com quem sumiu no preço, cria
  // conexão e abre o Semestral — mais difícil de ignorar que texto. Só envia áudio DENTRO da janela
  // de 24h E com a URL já configurada; senão (janela fechada ou áudio ainda não gravado) cai no
  // texto que abre o Semestral (recuperacao_enxuta), pra não deixar o toque vazio.
  const ehAudioPosPreco = nomeMsg === TOQUE_AUDIO_POSPRECO;
  const podeEnviarAudio = ehAudioPosPreco && dentroJanela && AUDIO_WALKER_POSPRECO_URL !== "";
  const nomeMsgEfetivo = (ehAudioPosPreco && !podeEnviarAudio) ? "recuperacao_enxuta" : nomeMsg;

  // Personaliza com concurso/dificuldade do formulário (só chega ao lead na janela aberta —
  // fora dela usa o template Meta puro; ver textoEnviar abaixo). campos já buscado acima.
  const conteudo = substituirCampos(CONTEUDO_TEMPLATES[nomeMsgEfetivo] ?? "", { nome: state.title, concurso: campos?.concurso, dificuldade: campos?.dificuldade });
  const templateFallback = temRetomarAgendado ? "conexao_duvida" : (fallbacks[contador] ?? "encerramento_02");
  // Fora da janela o lead recebe o template Meta (só {{1}}=nome). O texto REGISTRADO no Chatwoot
  // precisa refletir isso: substitui o nome e remove os segmentos {{ }} de concurso que o template
  // Meta não envia. Sem isso o registro mostrava "[Nome]" cru (ou vazio, quando a chave não existia).
  const textoFallback = CONTEUDO_TEMPLATES[templateFallback] ?? CONTEUDO_TEMPLATES[nomeMsgEfetivo] ?? "";
  const textoEnviar = dentroJanela ? conteudo : substituirCampos(textoFallback, { nome: state.title });

  // Trava anti-duplicata: não reenvia se for idêntico ao último que o agente mandou (não vale pro áudio).
  const ultimaAgente = await ultimaMensagemAgente(state.accountId, state.conversationId);
  const ehDuplicata = !podeEnviarAudio && textoEnviar.trim() !== "" && ultimaAgente.trim() === textoEnviar.trim();

  logger.info("follow-up", `Enviando ${podeEnviarAudio ? "áudio pós-preço" : nomeMsgEfetivo} (${contador + 1}/${sequencia.length}) — janela: ${dentroJanela}${ehDuplicata ? " — PULADO (idêntico ao último)" : ""}`);

  try {
    if (podeEnviarAudio) {
      await enviarAudioPorUrl(state.accountId, state.conversationId, AUDIO_WALKER_POSPRECO_URL, "walker-posprecoo.ogg");
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: "[áudio do Walker — retomada pós-preço]", tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else if (ehDuplicata) {
      // idêntico ao último envio — não reenvia
    } else if (dentroJanela) {
      await enviarMensagem(state.accountId, state.conversationId, conteudo);
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: conteudo, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else {
      await enviarTemplateComHistorico(state, templateFallback, textoEnviar, primeiroNome);
    }
  } catch (e) {
    logger.error("follow-up", `Erro ao enviar ${nomeMsg}:`, e);
    return { respostaAgente: "" };
  }

  const novoContador = contador + 1;
  let descricaoAtualizada = atualizarContadorNutrir(state.description ?? "", novoContador);
  // Remove o marcador "retomar:" após usá-lo, pra o acknowledge do combinado não repetir a cada toque.
  if (temRetomarAgendado) descricaoAtualizada = descricaoAtualizada.replace(/[^\S\n]*retomar:[^\n]*\n?/i, "").trimEnd();
  const delayProximo = delays[contador] ?? 24 * 60 * 60 * 1000;
  const proxima = agendarMaximizandoJanela(new Date(), delayProximo, msRestantes, { minGapMs: MIN_GAP_JANELA_MS });
  await atualizarKanbanTask(state.accountId, state.taskId, {
    description: descricaoAtualizada,
    due_date: proxima.toISOString(),
  });
  logger.info("follow-up", `Follow-up ${novoContador}/${sequencia.length} enviado — próximo: ${proxima.toISOString()} (janela restante: ${Math.round(msRestantes / 60000)}min)`);

  return { respostaAgente: "" };
}

// Sequência lembrete (link enviado): cutucada (o link tá ativo) → (se sumir) versão enxuta → travou em quê.
const SEQUENCIA_LEMBRETE = ["lembrete_1", "recuperacao_enxuta", "lembrete_2"] as const;
// Toque 1 dispara no delay INICIAL da etapa (20min). Depois: t1→t2 3h (mesmo dia), t2→t3 dia seguinte.
const DELAYS_LEMBRETE_MS = [3 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;
// Fallback pago (fora da janela 24h), por posição do contador.
const TEMPLATE_FALLBACK_LEMBRETE = ["lembrete_acesso", "recuperacao_enxuta", "lembrete_2"] as const;

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
        await enviarTemplateComHistorico(state, "encerramento", conteudoEnc, primeiroNome);
      }
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar encerramento lembrete:", e);
    }
    await encerrarParaNutrir(state);
    return { respostaAgente: "" };
  }

  // Dados do formulário + guarda de médico: troca o downsell "versão enxuta" por um lembrete neutro.
  const campos = await buscarCamposFormulario(state.telefone);
  const seqLembrete: string[] = [...SEQUENCIA_LEMBRETE];
  const fallbackLembrete: string[] = [...TEMPLATE_FALLBACK_LEMBRETE];
  if (ehMedicoPorFormacao(campos?.formacao)) {
    const iEnxuta = seqLembrete.indexOf("recuperacao_enxuta");
    if (iEnxuta >= 0) { seqLembrete[iEnxuta] = "lembrete_3"; fallbackLembrete[iEnxuta] = "lembrete_acesso"; }
  }
  const nomeMsg = seqLembrete[contador]!;
  const conteudo = substituirCampos(CONTEUDO_TEMPLATES[nomeMsg] ?? "", { nome: state.title, concurso: campos?.concurso, dificuldade: campos?.dificuldade });
  const templateFallback = fallbackLembrete[contador] ?? "encerramento_02";
  // Fora da janela o registro no Chatwoot deve refletir o template Meta ({{1}}=nome), não o
  // "[Nome]" cru — substitui o nome (e remove segmentos {{ }} caso existam).
  const textoFallback = CONTEUDO_TEMPLATES[templateFallback] ?? CONTEUDO_TEMPLATES[nomeMsg] ?? "";
  const textoEnviar = dentroJanela ? conteudo : substituirCampos(textoFallback, { nome: state.title });

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
      await enviarTemplateComHistorico(state, templateFallback, textoEnviar, primeiroNome);
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

// Páginas de onboarding "Primeiros passos". Substituem a antiga sequência de 6 mensagens:
// vídeo de apresentação, acesso à plataforma, Laudo Inicial, grupos oficiais e suporte
// estão todos dentro da página, com checklist de progresso.
const LINK_PRIMEIROS_PASSOS_PERITO = "https://lp.mentoriavestigium.com.br/primeiros-passos-perito";
const LINK_PRIMEIROS_PASSOS_MEDICO = "https://lp.mentoriavestigium.com.br/primeiros-passos-medico";

// A trilha do aluno vem do plano que o webhook de pagamento grava no card
// ("💳 - Plano: Mentoria Vestigium - Médico Legista - 12 meses"). Só a linha do plano é
// analisada: o resto da description carrega marcadores de follow-up que poderiam dar
// falso positivo. Sem plano identificável, cai na página de perito (maioria dos alunos).
export function linkPrimeirosPassos(description: string): string {
  const linhaPlano = description.match(/Plano:\s*(.+)/i)?.[1] ?? "";
  return /m[ée]dic|legista/i.test(linhaPlano)
    ? LINK_PRIMEIROS_PASSOS_MEDICO
    : LINK_PRIMEIROS_PASSOS_PERITO;
}

async function agenteBoasVindas(state: FollowUpStateType) {
  logger.info("follow-up", "enviando boas-vindas...");

  // Só o primeiro nome deixa a saudação mais natural (evita "Renan Martins Paludo").
  // Alinhado aos demais agentes do grafo, que já usam o primeiro nome.
  const primeiroNome = primeiroNomeSaudacao(state.title, "aluno(a)");
  const link = linkPrimeirosPassos(state.description ?? "");

  const msg = `🚀 ${primeiroNome}, parabéns por entrar para a Mentoria Vestigium!\nSua matrícula já está liberada.\n\nMontei uma página com o seu passo a passo de entrada: o vídeo que gravei, o acesso à plataforma, o Laudo Inicial e os grupos oficiais. Está tudo lá, em um lugar só.\n\n👉 ${link}\n\nReserva 5 minutos e faz agora, na ordem. Qualquer dúvida, é só me chamar por aqui.`;

  try {
    await enviarMensagem(state.accountId, state.conversationId, msg);
    logger.info("follow-up", "boas-vindas enviada", { link });
  } catch (e) {
    logger.error("follow-up", "Erro ao enviar boas-vindas:", e);
  }

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
const HORA_MAX_FOLLOWUP_JANELA = 20;

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

  // Verificar se o lead já respondeu — se sim, para a sequência.
  // ignorarGrupoEspera: o "quero grupo de espera" é o gatilho do anúncio, não uma resposta;
  // sem isso, TODO lead de anúncio conta como "já respondeu" e a sequência nunca dispara.
  try {
    const totalIncoming = await contarMensagensIncoming(state.accountId, state.conversationId, { ignorarGrupoEspera: true });
    if (totalIncoming > 0) {
      // O lead ENGAJOU (respondeu), mas o card ficou preso em "Primeira mensagem" porque o agente
      // principal não o moveu pra Conexão. Antes, aqui a sequência só PARAVA e o card ficava num
      // limbo: o abertura02 é pulado (ele já foi contactado), mas a régua de Conexão nunca rodava
      // (o card não está em Conexão) → 0 follow-up pra sempre, o cron só empurrava o prazo.
      // Agora movemos pra Conexão pra ele entrar na recuperação certa ("ficou alguma dúvida?").
      const stepConexao = state.funilSteps.find(s => /conex/i.test(s.name));
      if (stepConexao) {
        logger.info("follow-up", `Lead engajou mas preso em Primeira mensagem — movendo para Conexão (step ${stepConexao.id})`);
        await atualizarKanbanTask(state.accountId, state.taskId, { board_step_id: stepConexao.id });
      } else {
        logger.info("follow-up", "Lead já respondeu — encerrando (Conexão não encontrada no funil)");
      }
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
    const conteudoEnc = substituirNome(CONTEUDO_TEMPLATES["encerramento_02"] ?? "", state.title);
    try {
      if (dentroJanela && conteudoEnc) {
        await enviarMensagem(state.accountId, state.conversationId, conteudoEnc);
        if (state.telefone) {
          await salvarMensagem(state.telefone, { type: "ai", content: conteudoEnc, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
        }
      } else {
        await enviarTemplateComHistorico(state, "encerramento", conteudoEnc ?? "", primeiroNome);
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
  // Personaliza com concurso do formulário — só chega ao lead na janela aberta (fora, a Meta usa
  // o template com só {{1}}); substituirCampos garante que nenhum [[...]] cru vaze no conteúdo.
  const campos = await buscarCamposFormulario(state.telefone);
  const conteudo = substituirCampos(CONTEUDO_TEMPLATES[nomeMsg] ?? "", { nome: state.title, concurso: campos?.concurso, dificuldade: campos?.dificuldade });
  try {
    if (dentroJanela && conteudo) {
      logger.info("follow-up", `Janela 24h ativa — mensagem normal: ${nomeMsg}`);
      await enviarMensagem(state.accountId, state.conversationId, conteudo);
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: conteudo, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else {
      logger.info("follow-up", `Fora da janela — template: ${nomeMsg}`);
      await enviarTemplateComHistorico(state, nomeMsg, conteudo, primeiroNome);
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

// Nutrir dispara SEMPRE fora da janela de 24h (leads frios, delays de dias/semanas), então usa
// template Meta aprovado — texto livre do LLM não pode ser enviado fora da janela (era o bug:
// gerava a mensagem e o enviarMensagemNo bloqueava por estar fora da janela, sem fallback).
const SEQUENCIA_NUTRIR = [
  { abordagem: "ebook",               template: "nutrir_ebook",          proximoDelayDias: 7 },
  { abordagem: "video_aprovada",      template: "nutrir_video_aprovada", proximoDelayDias: 14 },
  { abordagem: "reabertura",          template: "nutrir_reabertura",     proximoDelayDias: 30 },
] as const;

async function agenteNutrir(state: FollowUpStateType) {
  logger.info("follow-up", "executando agente nutrir...");

  // Se o lead está ATIVO (janela de 24h aberta = respondeu nas últimas 24h), não nutre agora:
  // o atendimento normal cuida. Antes usava contarMensagensIncoming (histórico INTEIRO), que era
  // sempre > 0 pra lead que já engajou → o nurturing pausava pra sempre e nunca disparava.
  try {
    const janelaAberta = await verificarJanela24h(state.accountId, state.conversationId);
    if (janelaAberta) {
      logger.info("follow-up", "Lead ativo (janela aberta) — adiando nurturing 3 dias");
      const proxima = proximoHorarioComercial(new Date(), 3 * 24 * 60 * 60 * 1000);
      await atualizarKanbanTask(state.accountId, state.taskId, { due_date: proxima.toISOString() });
      return { respostaAgente: "" };
    }
  } catch (e) {
    logger.warn("follow-up", "Erro ao verificar janela no nutrir:", e);
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

  logger.info("follow-up", `Nurturing ${item.abordagem} (${contador + 1}/${SEQUENCIA_NUTRIR.length}) via template ${item.template}`);

  // Nutrir é sempre fora da janela → envia o template Meta aprovado (entrega de verdade) e persiste.
  // O texto registrado é a versão personalizada (concurso/nome); o que chega ao lead é o template
  // aprovado com {{1}}=nome. Se o template ainda não estiver aprovado na Meta, o envio erra e é
  // logado — o contador avança mesmo assim (evita loop; ativa de vez após a aprovação).
  const primeiroNome = primeiroNomeSaudacao(state.title);
  const campos = await buscarCamposFormulario(state.telefone);
  const conteudo = substituirCampos(CONTEUDO_TEMPLATES[item.template] ?? "", { nome: state.title, concurso: campos?.concurso });
  try {
    await enviarTemplateComHistorico(state, item.template, conteudo, primeiroNome);
  } catch (e) {
    logger.error("follow-up", `Erro ao enviar nutrir ${item.template} (template aprovado na Meta?):`, e);
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
      await enviarTemplateComHistorico(state, "abertura02", conteudo, primeiroNome);
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
