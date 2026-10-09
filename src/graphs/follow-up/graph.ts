import { StateGraph, END } from "@langchain/langgraph";
import { FollowUpState, type FollowUpStateType } from "./state.ts";
import { env } from "../../config/env.ts";
import { avisarComercial } from "../../lib/lembretes-sessao.ts";
import { buscarKanbanBoard, enviarMensagem, enviarTemplate, contarMensagensIncoming, verificarJanela24h, msRestantesJanela24h, verificarLeadRespondeuUltimo, minutosDesdeUltimaMensagemLead, ultimaMensagemAgente, atualizarKanbanTask, msDesdePrimeiraSaida } from "../../services/chatwoot.ts";
import { CONTEUDO_TEMPLATES } from "../../lib/templates.ts";
import { primeiroNomeSaudacao, substituirNome, substituirCampos } from "../../lib/nome.ts";
import { buscarCamposFormulario } from "../../db/formulario.ts";
import { proximoHorarioComercial } from "../../lib/horario-comercial.ts";
import { delayInicialMs } from "../../lib/delays-followup.ts";
import { TOQUE_IA, TOQUE_PUXAR, escolherToque2, gerarToque1, agendarProximoToque, type EtapaToque } from "../../lib/followup-toques.ts";
import { TOQUE_AUDIO_MUDO, TOQUE_PIX, ehToqueCuriosidade, enviarToqueCuriosidade } from "../../lib/followup-curiosidade.ts";
import { lerRetomada, removerRetomada } from "../../lib/retomada.ts";

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

/**
 * Aguardando Pagamento NÃO vai para Nutrir quando os follow-ups acabam (decisão do Gusthavo,
 * 22/09/2026): quem ouviu o preço ou recebeu o link é o lead mais valioso do funil e fica onde o
 * comercial olha. O card ganha a marca "follow-ups concluídos" na descrição e sai da fila do cron
 * (due_date longe); se o lead responder, o fluxo normal retoma.
 */
async function sinalizarFollowupsConcluidos(state: FollowUpStateType, quantos: number): Promise<void> {
  const data = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const marca = `✅ - Follow-ups concluídos (${quantos}/${quantos}) em ${data}, sem resposta`;
  const semMarca = (state.description ?? "").split("\n").filter((l) => !/^✅ - Follow-ups concluídos/.test(l)).join("\n");
  await atualizarKanbanTask(state.accountId, state.taskId, {
    description: `${semMarca}\n${marca}`.trim(),
    due_date: proximoHorarioComercial(new Date(), 90 * 24 * 60 * 60 * 1000).toISOString(),
  });
  logger.info("follow-up", `Aguardando Pagamento: follow-ups concluídos, card mantido na etapa (sinalizado)`);
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

// --- Retorno combinado numa data (lib/retomada.ts) ---
//
// Conv 9883: "na próxima semana" virou, no dia seguinte, o PDF de comprovante PIX. Este nó roda
// antes de qualquer agente: com "Retomar em" no futuro o card só é reagendado pra data (nenhuma
// mensagem); com a data vencida vai pro agente_retomada. Boas-vindas e template inicial não
// passam por aqui — não são conversa de venda em aberto.
const TIPOS_COM_RETOMADA = new Set(["followup", "lembrete", "nutrir", "template_abertura"]);

export async function verificarRetomada(state: FollowUpStateType, agora = new Date()) {
  if (!TIPOS_COM_RETOMADA.has(state.tipoFollowup)) return {};
  const retomada = lerRetomada(state.description ?? "");
  if (!retomada) return {};
  if (retomada.momento.getTime() > agora.getTime()) {
    await atualizarKanbanTask(state.accountId, state.taskId, { due_date: retomada.momento.toISOString() });
    logger.info("follow-up", `Retorno combinado ainda não chegou — nada enviado, card reagendado para ${retomada.momento.toISOString()}`, { taskId: state.taskId });
    return { tipoFollowup: "ignorar" as const };
  }
  return { retomadaVencida: true };
}

/**
 * Chegou o dia combinado: manda a retomada ("como a gente tinha combinado...") e tira a linha do
 * card. Depois dela a cadência é a curta — um toque no dia seguinte e o encerramento. Áudio mudo
 * e comprovante PIX não entram em conversa com retorno combinado: quem disse quando decide não
 * cai em pegadinha de curiosidade.
 */
async function agenteRetomada(state: FollowUpStateType) {
  logger.info("follow-up", "executando retomada do retorno combinado...");
  const msRestantes = await msRestantesJanela24h(state.accountId, state.conversationId);
  const dentroJanela = msRestantes > 0;
  const primeiroNome = primeiroNomeSaudacao(state.title);
  const campos = await buscarCamposFormulario(state.telefone);
  // "retomada_agendada" não é template aprovado na Meta: fora da janela vai a pergunta curta.
  const templateFallback = "conexao_duvida";
  const texto = dentroJanela
    ? substituirCampos(CONTEUDO_TEMPLATES["retomada_agendada"] ?? "", { nome: state.title, concurso: campos?.concurso, dificuldade: campos?.dificuldade })
    : substituirCampos(CONTEUDO_TEMPLATES[templateFallback] ?? "", { nome: state.title });

  try {
    if (dentroJanela) {
      await enviarMensagem(state.accountId, state.conversationId, texto);
      if (state.telefone) {
        await salvarMensagem(state.telefone, { type: "ai", content: texto, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
      }
    } else {
      await enviarTemplateComHistorico(state, templateFallback, texto, primeiroNome);
    }
  } catch (e) {
    // A linha fica no card com a data vencida: o próximo ciclo do cron tenta de novo.
    logger.error("follow-up", "Erro ao enviar retomada:", e);
    return { respostaAgente: "" };
  }

  let descricao = removerRetomada(state.description ?? "");
  let proxima: Date;
  if (state.tipoFollowup === "followup" || state.tipoFollowup === "lembrete") {
    // Pula pro último toque da sequência (o de antes do encerramento), no dia seguinte.
    const ultimo = state.tipoFollowup === "lembrete" ? SEQUENCIA_LEMBRETE.length - 1 : SEQUENCIA_RECUPERACAO_CONEXAO.length - 1;
    descricao = atualizarContadorNutrir(descricao, ultimo);
    proxima = proximoHorarioComercial(new Date(), 24 * 60 * 60 * 1000);
  } else {
    proxima = proximoHorarioComercial(new Date(), delayInicialMs(state.board_step?.name ?? "", descricao));
  }
  await atualizarKanbanTask(state.accountId, state.taskId, { description: descricao, due_date: proxima.toISOString() });
  logger.info("follow-up", `Retomada enviada (janela: ${dentroJanela}) — próximo toque ${proxima.toISOString()}`);
  return { respostaAgente: "" };
}

// Sequências de quem JÁ conversou (Conexão, pós-preço e link enviado) — cadência de 30/09/2026,
// ver lib/followup-toques.ts: toque 1 (IA, pergunta ligada ao que o lead falou) e toque 2
// ("Oiii, consegue responder agora?") dentro da janela grátis de 24h; toque 3 no dia seguinte por
// template; encerramento 2 dias depois. Saíram o áudio pós-preço e o "caminho mais leve": na
// conv 9280 o downsell automático atropelou a condição que a equipe tinha acabado de oferecer.
// 03/10/2026: o "Oiii, consegue responder agora?" deu lugar a dois toques de curiosidade dentro
// da janela (áudio mudo + "O que você acha?", depois o PDF de comprovante PIX), ver
// lib/followup-curiosidade.ts. Fora da janela essas posições são puladas.
const SEQUENCIA_RECUPERACAO_CONEXAO = [TOQUE_IA, TOQUE_AUDIO_MUDO, TOQUE_PIX, "conexao_2"] as const;
const SEQUENCIA_POS_PRECO = [TOQUE_IA, TOQUE_AUDIO_MUDO, TOQUE_PIX, "pos_preco_duvida"] as const;
// Toques que cabem na janela grátis nessas sequências (pergunta da IA + os dois de curiosidade).
const TOQUES_NA_JANELA_CURIOSIDADE = 3;
// Template (fora da janela) por posição. O toque 1 quase sempre sai dentro dela; quando não sai
// (lead que falou tarde da noite, domingo), vai a pergunta curta aprovada. As posições de
// curiosidade nunca usam template (são puladas sem janela).
const TEMPLATE_FALLBACK_CONEXAO = ["conexao_duvida", "conexao_duvida", "conexao_duvida", "conexao_2"] as const;
const TEMPLATE_FALLBACK_POS_PRECO = ["conexao_duvida", "conexao_duvida", "conexao_duvida", "pos_preco_duvida"] as const;
// Encerramento de todas as sequências: curto, aprovado na Meta com {{1}} = nome.
const NOME_ENCERRAMENTO = "encerramento";

/** Texto do toque na posição `nome` — gerado (toques 1 e 2) ou fixo (templates). */
async function montarToque(
  nome: string,
  state: FollowUpStateType,
  etapa: EtapaToque,
  campos: { concurso?: string | null; dificuldade?: string | null } | null,
): Promise<string> {
  if (nome === TOQUE_IA) return gerarToque1({ etapa, telefone: state.telefone, nome: primeiroNomeSaudacao(state.title) });
  if (nome === TOQUE_PUXAR) return substituirNome(escolherToque2(state.conversationId), state.title);
  if (ehToqueCuriosidade(nome)) return "";
  return substituirCampos(CONTEUDO_TEMPLATES[nome] ?? "", { nome: state.title, concurso: campos?.concurso, dificuldade: campos?.dificuldade });
}

export async function agenteFollowup(state: FollowUpStateType) {
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
  let contador = lerContadorNutrir(state.description ?? "");
  const primeiroNome = primeiroNomeSaudacao(state.title);
  // Pós-preço = está em "Aguardando Pagamento" (viu o pitch) e ainda NÃO recebeu link.
  // Antes dependia só de "status: proposta_apresentada" (que o agente nem sempre grava), por
  // isso a SEQUENCIA_POS_PRECO quase nunca disparava. Agora espelha classificar(): basta estar
  // em Aguardando Pagamento sem "link enviado". Leads em Conexão (outro step) continuam na
  // SEQUENCIA_RECUPERACAO_CONEXAO normalmente (isPosPreco = false).
  const stepNameFollowup = state.board_step?.name?.toLowerCase() ?? "";
  const temLinkEnviado = /link\s*enviado/i.test(state.description ?? "");
  const isPosPreco = stepNameFollowup === "aguardando pagamento" && !temLinkEnviado;

  // Dados do formulário (concurso/dificuldade) para os textos fixos que os usam.
  const campos = await buscarCamposFormulario(state.telefone);

  const sequencia: readonly string[] = isPosPreco ? SEQUENCIA_POS_PRECO : SEQUENCIA_RECUPERACAO_CONEXAO;
  const fallbacks: readonly string[] = isPosPreco ? TEMPLATE_FALLBACK_POS_PRECO : TEMPLATE_FALLBACK_CONEXAO;

  logger.info("follow-up", `Modo: ${isPosPreco ? "pós-preço" : "conexão"}, contador: ${contador}`);

  // Áudio mudo e comprovante PIX só existem dentro da janela; fora dela pula pro próximo toque.
  while (!dentroJanela && ehToqueCuriosidade(sequencia[contador])) {
    logger.info("follow-up", `Janela fechada — ${sequencia[contador]} pulado`);
    contador++;
  }

  // Após N mensagens sem resposta: encerramento → Perdido
  if (contador >= sequencia.length) {
    logger.info("follow-up", `${contador} follow-ups sem resposta — encerrando`);
    const conteudoEnc = substituirNome(CONTEUDO_TEMPLATES[NOME_ENCERRAMENTO] ?? "", state.title);
    try {
      if (dentroJanela) {
        await enviarMensagem(state.accountId, state.conversationId, conteudoEnc);
        if (state.telefone) {
          await salvarMensagem(state.telefone, { type: "ai", content: conteudoEnc, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
        }
      } else {
        await enviarTemplateComHistorico(state, NOME_ENCERRAMENTO, conteudoEnc, primeiroNome);
      }
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar encerramento:", e);
    }
    // Lead que ouviu o preço e não respondeu a 3 mensagens: a IA para, mas ele não é lead frio —
    // é onde o "Olá, tá por aí?" do Pedro responde 30% e precede compras (análise de 21/09).
    if (isPosPreco) {
      await avisarComercial(
        `👋 VALE UM "TÁ AÍ?" — ${state.title} (${state.telefone ?? "?"}) ouviu o preço, recebeu ${sequencia.length + 1} mensagens e não respondeu. A IA parou; o card segue em Aguardando Pagamento.\n` +
          `${env.CHATWOOT_BASE_URL}/app/accounts/${state.accountId}/conversations/${state.conversationId}`,
      );
      await sinalizarFollowupsConcluidos(state, sequencia.length + 1);
    } else {
      await encerrarParaNutrir(state);
    }
    return { respostaAgente: "" };
  }

  // Retomada agendada (rec #13): se o agente combinou um retorno numa data e marcou "retomar:" na
  // descrição, o PRIMEIRO toque acknowledge o combinado (retomada_agendada) em vez do template
  // genérico — corrige o "Confirmar o quê?" (follow-up que contradizia o acordo). Depois segue a
  // cadência normal (o marcador é removido na atualização da descrição, abaixo).
  const temRetomarAgendado = /retomar:/i.test(state.description ?? "") && contador === 0;
  const nomeMsg = temRetomarAgendado ? "retomada_agendada" : sequencia[contador]!;

  const etapa: EtapaToque = isPosPreco ? "pos_preco" : "conexao";
  // O toque gerado só é usado dentro da janela; fora dela quem fala é o template.
  const conteudo = temRetomarAgendado
    ? substituirCampos(CONTEUDO_TEMPLATES["retomada_agendada"] ?? "", { nome: state.title, concurso: campos?.concurso, dificuldade: campos?.dificuldade })
    : dentroJanela ? await montarToque(nomeMsg, state, etapa, campos) : "";
  const templateFallback = temRetomarAgendado ? "conexao_duvida" : (fallbacks[contador] ?? "encerramento_03");
  // Fora da janela o lead recebe o template Meta (só {{1}}=nome). O texto REGISTRADO no Chatwoot
  // precisa refletir isso: substitui o nome e remove os segmentos {{ }} que o template não envia.
  const textoEnviar = dentroJanela ? conteudo : substituirCampos(CONTEUDO_TEMPLATES[templateFallback] ?? "", { nome: state.title });

  // Trava anti-duplicata: não reenvia se for idêntico ao último que o agente mandou.
  const ultimaAgente = await ultimaMensagemAgente(state.accountId, state.conversationId);
  const ehDuplicata = textoEnviar.trim() !== "" && ultimaAgente.trim() === textoEnviar.trim();

  logger.info("follow-up", `Enviando ${nomeMsg} (${contador + 1}/${sequencia.length}) — janela: ${dentroJanela}${ehDuplicata ? " — PULADO (idêntico ao último)" : ""}`, { texto: textoEnviar.slice(0, 160) });

  try {
    if (ehDuplicata) {
      // idêntico ao último envio — não reenvia
    } else if (ehToqueCuriosidade(nomeMsg)) {
      await enviarToqueCuriosidade(nomeMsg, state.accountId, state.conversationId, state.telefone);
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
  const proxima = agendarProximoToque(contador, msRestantes, new Date(), TOQUES_NA_JANELA_CURIOSIDADE);
  await atualizarKanbanTask(state.accountId, state.taskId, {
    description: descricaoAtualizada,
    due_date: proxima.toISOString(),
  });
  logger.info("follow-up", `Follow-up ${novoContador}/${sequencia.length} enviado — próximo: ${proxima.toISOString()} (janela restante: ${Math.round(msRestantes / 60000)}min)`);

  return { respostaAgente: "" };
}

// Sequência lembrete (link enviado) — mesma cadência das outras (ver lib/followup-toques.ts):
// toque 1 da IA (+20min, só com 1h de silêncio do lead), "Oiii, consegue responder agora?"
// perto do fim da janela, template no dia seguinte e encerramento 2 dias depois.
const SEQUENCIA_LEMBRETE = [TOQUE_IA, TOQUE_PUXAR, "lembrete_2"] as const;
const TEMPLATE_FALLBACK_LEMBRETE = ["lembrete_acesso", "lembrete_acesso", "lembrete_2"] as const;

// Silêncio mínimo antes do lembrete de checkout. O toque 1 sai 20min depois do link, prazo curto
// de propósito (abandono de carrinho se resolve rápido) — mas 20min de RELÓGIO não são 20min de
// silêncio. Quem acabou de responder não abandonou nada.
const MIN_SILENCIO_LEMBRETE_MIN = 60;

async function agenteLembrete(state: FollowUpStateType) {
  logger.info("follow-up", "executando lembrete pré-configurado...");

  // Guarda de sinal de vida — o agenteFollowup (Conexão) já tinha a dele, este não. Na conv 6890
  // a lead recebeu o link 19:12, respondeu "Combinado!" 19:13 e levou "travou alguma coisa na hora
  // de finalizar?" às 19:36. Só o `respondeuUltimo` não a salvaria: quem falou por último foi a IA
  // (um "🚀"), por isso a régua aqui é o silêncio do LEAD, não de quem falou por último.
  try {
    const [respondeuUltimo, minutosLead] = await Promise.all([
      verificarLeadRespondeuUltimo(state.accountId, state.conversationId),
      minutosDesdeUltimaMensagemLead(state.accountId, state.conversationId),
    ]);
    const falouAgoraPouco = minutosLead !== null && minutosLead < MIN_SILENCIO_LEMBRETE_MIN;
    if (respondeuUltimo || falouAgoraPouco) {
      const proxima = proximoHorarioComercial(new Date(), 2 * 60 * 60 * 1000);
      logger.info("follow-up", "Lead deu sinal de vida — lembrete adiado", {
        respondeuUltimo,
        minutosDesdeAFalaDoLead: minutosLead === null ? null : Math.round(minutosLead),
        proxima: proxima.toISOString(),
      });
      await atualizarKanbanTask(state.accountId, state.taskId, { due_date: proxima.toISOString() });
      return { respostaAgente: "" };
    }
  } catch (e) {
    // Falha de leitura não pode impedir o lembrete: pior ficar sem o toque que travar a cadência.
    logger.warn("follow-up", "Erro ao checar sinal de vida do lead (seguindo com o lembrete):", e);
  }

  const msRestantes = await msRestantesJanela24h(state.accountId, state.conversationId);
  const dentroJanela = msRestantes > 0;
  const contador = lerContadorNutrir(state.description ?? "");
  const primeiroNome = primeiroNomeSaudacao(state.title);

  // Sequência esgotada: encerramento, e o card fica em Aguardando Pagamento sinalizado.
  if (contador >= SEQUENCIA_LEMBRETE.length) {
    logger.info("follow-up", `${contador} lembretes sem resposta — encerrando`);
    const conteudoEnc = substituirNome(CONTEUDO_TEMPLATES[NOME_ENCERRAMENTO] ?? "", state.title);
    try {
      if (dentroJanela) {
        await enviarMensagem(state.accountId, state.conversationId, conteudoEnc);
        if (state.telefone) {
          await salvarMensagem(state.telefone, { type: "ai", content: conteudoEnc, tool_calls: [], additional_kwargs: {}, response_metadata: {}, invalid_tool_calls: [] });
        }
      } else {
        await enviarTemplateComHistorico(state, NOME_ENCERRAMENTO, conteudoEnc, primeiroNome);
      }
    } catch (e) {
      logger.error("follow-up", "Erro ao enviar encerramento lembrete:", e);
    }
    // Recebeu o link e não pagou: fica em Aguardando Pagamento, sinalizado, para o comercial.
    await sinalizarFollowupsConcluidos(state, SEQUENCIA_LEMBRETE.length + 1);
    return { respostaAgente: "" };
  }

  const campos = await buscarCamposFormulario(state.telefone);
  const nomeMsg = SEQUENCIA_LEMBRETE[contador]!;
  const conteudo = dentroJanela ? await montarToque(nomeMsg, state, "lembrete", campos) : "";
  const templateFallback = TEMPLATE_FALLBACK_LEMBRETE[contador] ?? "encerramento_03";
  // Fora da janela o registro no Chatwoot deve refletir o template Meta ({{1}}=nome).
  const textoEnviar = dentroJanela ? conteudo : substituirCampos(CONTEUDO_TEMPLATES[templateFallback] ?? "", { nome: state.title });

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
  const proxima = agendarProximoToque(contador, msRestantes);
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

// Sequência de recuperação para leads em "Primeira mensagem" (abertura enviada, sem resposta).
// 03/10/2026 (conv 9560): o 1º toque saía só 24h depois, já fora da janela, e o lead que pediu o
// grupo de espera passava o primeiro dia inteiro sem nenhum follow-up. Agora, com janela aberta,
// são TRÊS toques grátis no primeiro dia: o reforço (+3h), o áudio mudo + "O que você acha?" e o
// PDF de comprovante PIX perto de a janela fechar (ver lib/followup-curiosidade.ts); a urgência
// vai por template no dia seguinte e o encerramento depois.
// Sem janela (lead só de formulário, que recebeu a abertura por template) os de curiosidade são
// pulados e a régua continua a de antes: reforço D+1, urgência D+2, encerramento D+3.
// NOTA: a prova social (fup2_prova_social) ficou FORA por ora — a versão persuasiva dela usa
// mídia (imagem/vídeo) no template, que o Chatwoot 4.15.1 não repassa à Meta (bug #13159).
// Texto pronto em templates.ts pra reativar quando houver caminho de mídia (Cloud API direta).
const SEQUENCIA_RECUPERACAO_PM = ["fup1_reforco", TOQUE_AUDIO_MUDO, TOQUE_PIX, "fup3_urgencia"] as const;
// Sem janela, o 1º toque não sai antes disso desde a abertura (o delay inicial de 3h é pra quem
// tem janela; quem não tem continua recebendo o reforço só no dia seguinte, como antes).
const ESPERA_PM_SEM_JANELA_MS = 24 * 60 * 60 * 1000;

// Fora da janela (lead frio): reforço → urgência em ~2 dias, encerramento no Dia 3 seguinte.
// 21/09/2026: era [2d, 3d] (t1 D+1, t2 D+3, encerramento D+6). Depois de 4 dias de silêncio a
// resposta é < 9%; agora tudo cabe em 72h: t1 D+1, t2 D+2, encerramento D+3.
const DELAY_FORA_JANELA_PM_MS = 24 * 60 * 60 * 1000;

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

export async function agenteTemplateAbertura(state: FollowUpStateType) {
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
        await atualizarKanbanTask(state.accountId, state.taskId, {
          board_step_id: stepConexao.id,
          due_date: proximoHorarioComercial(new Date(), delayInicialMs(stepConexao.name)).toISOString(),
        });
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
  let contador = lerContadorTemplates(state.description ?? "");

  // Sem janela, o reforço espera completar 24h da abertura: o delay inicial (3h) existe pra
  // aproveitar a janela de quem pediu o grupo, não pra adiantar template pago de lead frio.
  if (contador === 0 && !dentroJanela) {
    const desdeAbertura = await msDesdePrimeiraSaida(state.accountId, state.conversationId);
    if (desdeAbertura < ESPERA_PM_SEM_JANELA_MS - MIN_GAP_JANELA_MS) {
      const adiada = proximoHorarioComercial(new Date(), ESPERA_PM_SEM_JANELA_MS - desdeAbertura);
      logger.info("follow-up", `Primeira mensagem sem janela — reforço adiado para ${adiada.toISOString()}`);
      await atualizarKanbanTask(state.accountId, state.taskId, { due_date: adiada.toISOString() });
      return { respostaAgente: "" };
    }
  }

  // Áudio mudo e comprovante PIX só existem dentro da janela; fora dela pula pra urgência.
  while (!dentroJanela && ehToqueCuriosidade(SEQUENCIA_RECUPERACAO_PM[contador])) {
    logger.info("follow-up", `Primeira mensagem: janela fechada — ${SEQUENCIA_RECUPERACAO_PM[contador]} pulado`);
    contador++;
  }

  // Contador >= tamanho da sequência: todas as mensagens enviadas → encerramento e Nutrir
  if (contador >= SEQUENCIA_RECUPERACAO_PM.length) {
    logger.info("follow-up", "Sequência Primeira mensagem esgotada — enviando encerramento");
    const conteudoEnc = substituirNome(CONTEUDO_TEMPLATES["encerramento_03"] ?? "", state.title);
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
  const conteudo = ehToqueCuriosidade(nomeMsg)
    ? ""
    : substituirCampos(CONTEUDO_TEMPLATES[nomeMsg] ?? "", { nome: state.title, concurso: campos?.concurso, dificuldade: campos?.dificuldade });
  try {
    if (ehToqueCuriosidade(nomeMsg)) {
      await enviarToqueCuriosidade(nomeMsg, state.accountId, state.conversationId, state.telefone);
    } else if (dentroJanela && conteudo) {
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

  // Próximo toque. Com janela: mesma régua dos toques curtos (lib/followup-toques.ts) — depois do
  // reforço, o áudio mudo no meio do que sobra da janela e o PIX perto de ela fechar; depois, a
  // urgência no dia seguinte e o encerramento. Sem janela: um dia entre cada um.
  const proximaData = dentroJanela
    ? agendarProximoToque(contador, msRestantes, new Date(), TOQUES_NA_JANELA_CURIOSIDADE)
    : proximoHorarioComercial(new Date(), DELAY_FORA_JANELA_PM_MS, 18);

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
//
// 21/09/2026: só o e-book. Na análise de jul–set o nutrir mandou 863 templates com 2% de resposta e
// nenhuma compra atribuível (vídeo 0,6%, reabertura 3,8%). Base parada não volta por gotejamento;
// volta por AÇÃO com oferta (o Dia do Cliente teve 7% de resposta e 7 vendas em um dia). O que
// resta aqui é um único toque de valor; o resto vira campanha mensal, disparada à mão.
const SEQUENCIA_NUTRIR = [
  { abordagem: "ebook",               template: "nutrir_ebook",          proximoDelayDias: 90 },
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
        await atualizarKanbanTask(state.accountId, state.taskId, {
          board_step_id: stepPM.id,
          due_date: proximoHorarioComercial(new Date(), delayInicialMs(stepPM.name)).toISOString(),
        });
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
    // O due_date PRECISA ser recalculado aqui. Sem isso o card entra em "Primeira mensagem"
    // carregando o prazo que acabou de vencer (foi ele que disparou este template), e o ciclo
    // seguinte do cron o vê como overdue e manda o follow-up de recuperação no mesmo minuto —
    // conv 6900: a abertura e o "me dá um oi rapidinho" saíram as duas às 08h54.
    const proximaPM = proximoHorarioComercial(new Date(), delayInicialMs(stepPM.name));
    await atualizarKanbanTask(state.accountId, state.taskId, {
      board_step_id: stepPM.id,
      due_date: proximaPM.toISOString(),
    });
    logger.info("follow-up", `Card movido para "Primeira mensagem" (step ${stepPM.id}) — próximo toque ${proximaPM.toISOString()}`);
  } else {
    logger.warn("follow-up", "Etapa 'Primeira mensagem' não encontrada no funil");
  }

  return { respostaAgente: "" };
}

// --- Construção do grafo ---

export function rotaClassificacao(state: FollowUpStateType): string {
  if (state.retomadaVencida && state.tipoFollowup !== "ignorar") return "agente_retomada";
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
    .addNode("verificar_retomada", (state: FollowUpStateType) => verificarRetomada(state))
    .addNode("agente_retomada", agenteRetomada)
    .addNode("enviar_mensagem", enviarMensagemNo)

    // Arestas
    .addEdge("__start__", "buscar_funil")
    .addEdge("buscar_funil", "classificar")
    .addEdge("classificar", "verificar_retomada")
    .addConditionalEdges("verificar_retomada", rotaClassificacao, {
      agente_retomada: "agente_retomada",
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
    .addEdge("agente_retomada", "__end__")
    .addEdge("enviar_mensagem", END);

  return grafo.compile({ checkpointer });
}
