// Intro automática pós-grupo-espera com agendamento PERSISTIDO no banco (sobrevive a
// reinícios/deploys, ao contrário do setTimeout em memória que morria no restart e deixava
// o lead só com o link do grupo, sem a apresentação do Walker — bug da conv 4413).
//
// Fluxo: no pedido de grupo de espera, `agendarIntroPendente` grava uma linha em intro_pendente
// com agendado_para = agora + 2min. O cron `verificarIntrosPendentes` (index.ts, a cada 30s)
// dispara as vencidas, com trava de concorrência (guarda em processo + claim atômico) pra nunca
// disparar a mesma intro duas vezes.
import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";
import { logger } from "./logger.ts";
import { houveAiRecente } from "../db/memoria.ts";
import { buscarConversa } from "../services/chatwoot.ts";
import { buscarDadosFormulario } from "../db/formulario.ts";
import { criarGrafoAgenteClinica } from "../graphs/main-agent/graph.ts";

const DELAY_INTRO_MIN = 2;   // dispara 2 min após o pedido do grupo (tempo do lead entrar no grupo)
const MAX_TENTATIVAS = 3;

let grafo: Awaited<ReturnType<typeof criarGrafoAgenteClinica>> | null = null;
async function obterGrafo() {
  if (!grafo) grafo = await criarGrafoAgenteClinica();
  return grafo;
}

export interface DadosIntro {
  idConta: string;
  idConversa: string;
  idContato: string;
  idInbox: string;
  telefone: string;
  nome: string;
  labels: string[];
}

// Persiste o agendamento da intro no banco. Chamado no fluxo de grupo de espera.
export async function agendarIntroPendente(dados: DadosIntro): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO intro_pendente (account_id, conversa_id, contato_id, inbox_id, telefone, nome, labels, agendado_para)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, NOW() + ($8 || ' minutes')::interval)`,
      [dados.idConta, dados.idConversa, dados.idContato, dados.idInbox, dados.telefone, dados.nome, JSON.stringify(dados.labels ?? []), DELAY_INTRO_MIN],
    );
    logger.info("intro", `Intro agendada (conversa ${dados.idConversa}, ${dados.nome}, +${DELAY_INTRO_MIN}min)`);
  } catch (e) {
    logger.error("intro", "Erro ao agendar intro no banco:", e);
  }
}

// Invoca o grafo principal com o gatilho SISTEMA que inicia o roteiro do Walker.
async function dispararIntro(row: {
  account_id: string; conversa_id: string; contato_id: string; inbox_id: string;
  telefone: string; nome: string; labels: string[] | null;
}): Promise<void> {
  const conversa = await buscarConversa(row.account_id, row.conversa_id) as Record<string, unknown>;
  const tarefa = (conversa["kanban_task"] ?? {}) as Record<string, unknown>;
  const funil = (conversa["kanban_board"] ?? {}) as Record<string, unknown>;
  const dadosFormulario = await buscarDadosFormulario(row.telefone);

  const g = await obterGrafo();
  const idMensagemIntro = `intro_${row.telefone}_${Date.now()}`;
  await g.invoke({
    messages: [],
    idMensagem: idMensagemIntro,
    idMensagemReferenciada: null,
    idConta: row.account_id,
    idConversa: row.conversa_id,
    idContato: row.contato_id,
    idInbox: row.inbox_id,
    telefone: row.telefone,
    nome: row.nome,
    mensagem: "[SISTEMA: O lead pediu o grupo de espera e você já mandou o link. Agora INICIE a conversa de vendas. Se você NUNCA falou com esse lead antes (sem histórico seu na conversa), apresente-se em 1ª pessoa como o Perito Walker, diga que recebeu o formulário e comece pela Mensagem 1 do roteiro. Se JÁ houver histórico seu com ele (lead que está voltando), NÃO se reapresente: dê as boas-vindas de volta de forma natural e retome de onde pararam.]",
    mensagemDeAudio: false,
    timestamp: new Date().toISOString(),
    tipoArquivo: null,
    idAnexo: null,
    urlArquivo: null,
    etiquetas: row.labels ?? [],
    atributosContato: {},
    atributosConversa: "",
    dadosFormulario,
    tarefa,
    funil,
    mensagemProcessada: "[SISTEMA: Lead preencheu o formulário de aplicação.]",
    mensagemReferenciada: null,
    mensagensAgregadas: "",
    stale: false,
    lockTentativas: 0,
    locked: false,
    erroFatal: false,
    outputAgente: "",
    novasMensagens: false,
    respostaFormatada: "",
    ssml: "",
    audioBuffer: null,
  }, { configurable: { thread_id: `${row.telefone}_${idMensagemIntro}` } });
}

// Guarda em processo: impede que dois ticks do cron rodem ao mesmo tempo.
let introEmExecucao = false;

// Cron: dispara as intros vencidas. Roda a cada 30s.
export async function verificarIntrosPendentes(): Promise<void> {
  if (env.MODO_TESTE) return;
  if (introEmExecucao) return;
  introEmExecucao = true;
  try {
    const { rows } = await pool.query(
      `SELECT id, account_id, conversa_id, contato_id, inbox_id, telefone, nome, labels
       FROM intro_pendente
       WHERE enviado = FALSE AND tentativas < $1 AND agendado_para <= NOW()
       ORDER BY agendado_para LIMIT 10`,
      [MAX_TENTATIVAS],
    );

    for (const row of rows) {
      // Claim atômico: só UMA execução consegue marcar enviado=TRUE. Feito ANTES de disparar
      // pra garantir que nunca dispare a mesma intro duas vezes (duplicação é o pecado capital).
      const claim = await pool.query(
        `UPDATE intro_pendente SET enviado = TRUE WHERE id = $1 AND enviado = FALSE RETURNING id`,
        [row.id],
      );
      if (claim.rowCount === 0) continue; // outra execução já pegou

      try {
        // Não intro se a conversa já está ATIVA agora (a IA falou nos últimos 5min) — histórico
        // ANTIGO não bloqueia (lead que some por semanas e volta deve ser re-engajado).
        if (await houveAiRecente(row.telefone, 5)) {
          logger.info("intro", `Intro ${row.id} pulada: conversa ativa (IA falou nos últimos 5min)`, { telefone: row.telefone });
          continue;
        }
        await dispararIntro(row);
        logger.info("intro", `Intro ${row.id} disparada (${row.nome}, ${row.telefone})`);
      } catch (e) {
        // Já marcamos enviado=TRUE (claim). Em falha, a intro NÃO é reenviada — preferimos perder
        // uma intro rara a arriscar duplicação. O erro fica logado alto pra recuperação manual.
        logger.error("intro", `Falha ao disparar intro ${row.id} (${row.telefone}) — NÃO será reenviada:`, e);
      }
    }
  } catch (e) {
    logger.error("intro", "Erro ao verificar intros pendentes:", e);
  } finally {
    introEmExecucao = false;
  }
}
