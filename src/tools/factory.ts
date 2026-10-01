import type { StructuredToolInterface } from "@langchain/core/tools";
import { refletir } from "./refletir.ts";
import { criarToolEscalarHumano } from "./escalar-humano.ts";
import { criarToolAlertarGestor } from "./alertar-gestor.ts";
import { criarToolAtualizarTarefa, criarToolAtualizarTarefaFollowup } from "./atualizar-tarefa.ts";
import { criarToolReagirMensagem } from "./reagir-mensagem.ts";
import { criarToolEnviarVideo } from "./enviar-video.ts";
import { criarToolEnviarImagemEntregaveis } from "./enviar-imagem-entregaveis.ts";
import { criarToolEnviarProvaSocial } from "./enviar-prova-social.ts";
import { CASOS_APROVADOS } from "../lib/prova-social.ts";
import {
  criarToolEnviarAudioWalker1,
  criarToolEnviarAudioWalker2,
} from "./enviar-audio-walker.ts";
import { criarToolBuscarContextoSimilar } from "./buscar-contexto-similar.ts";
import { criarToolAgendarSessao } from "./agendar-sessao.ts";
import type { MotivoInelegivel } from "../lib/elegibilidade.ts";
import { criarToolMostrarCondicaoPromocao } from "./mostrar-condicao-promocao.ts";
import { agendaConfigurada } from "../services/google-calendar.ts";

interface ContextoMainAgent {
  idMensagem: string;
  idConta: string;
  idConversa: string;
  idContato: string;
  idInbox: string;
  telefone: string;
  nome: string;
  mensagem: string;
  tarefa: Record<string, unknown>;
  /** Qual funil este lead está vendo. Só a trilha de sessão ganha a tool de agenda. */
  trilha?: "antigo" | "sessao";
  concurso?: string;
  /** Lead barrado da sessão (sem graduação / formação não aceita): a tool de agenda recusa marcar. */
  bloqueioSessao?: MotivoInelegivel;
  /** Promoção do Dia do Cliente ativa para este lead (só hoje, só trilha Perito): ganha a tool da tabela. */
  promocao?: boolean;
  /**
   * Turno de abertura (intro depois do grupo de espera): sem ferramentas de mídia. A tool roda antes
   * do texto, então um áudio chamado aqui chegava ANTES do "Olá, aqui é o Perito Walker" (conv 9476).
   */
  semMidia?: boolean;
}

export function criarToolsAgenteVestigium(contexto: ContextoMainAgent): StructuredToolInterface[] {
  const tarefa = contexto.tarefa;
  const board = tarefa["board"] as { steps?: Array<{ id: number; name: string }> } | undefined;
  const etapas = board?.steps ?? [];
  const etapasDescricao = etapas.map(s => `${s.name}: ${s.id}`).join("\n") || "(não disponível)";

  // A tool de agenda entra SÓ na trilha de sessão e SÓ se a integração estiver configurada.
  // Sem essa guarda, um lead do funil antigo poderia receber convite para uma call que ninguém
  // combinou — e, com a agenda fora do ar, a IA prometeria horário que não existe.
  const toolsAgenda =
    contexto.trilha === "sessao" && agendaConfigurada()
      ? [criarToolAgendarSessao({
          idConta: contexto.idConta,
          idConversa: contexto.idConversa,
          telefone: contexto.telefone,
          nome: contexto.nome,
          ...(contexto.concurso ? { concurso: contexto.concurso } : {}),
          ...(contexto.bloqueioSessao ? { bloqueioSessao: contexto.bloqueioSessao } : {}),
        })]
      : [];

  const toolsPromocao = contexto.promocao
    ? [criarToolMostrarCondicaoPromocao({ idConta: contexto.idConta, idConversa: contexto.idConversa, telefone: contexto.telefone })]
    : [];

  const NOMES_MIDIA = new Set(["Enviar_video_plataforma", "Enviar_imagem_entregaveis", "Enviar_audio_walker_1", "Enviar_audio_walker_2", "Enviar_prova_social"]);
  const todas: StructuredToolInterface[] = [
    ...toolsAgenda,
    ...toolsPromocao,
    refletir,
    criarToolEscalarHumano({
      telefone: contexto.telefone,
      nome: contexto.nome,
      idConta: contexto.idConta,
      idConversa: contexto.idConversa,
      idInbox: contexto.idInbox,
      ultimaMensagem: contexto.mensagem,
    }),
    criarToolAlertarGestor({
      telefone: contexto.telefone,
      nome: contexto.nome,
      idConta: contexto.idConta,
      idConversa: contexto.idConversa,
      ultimaMensagem: contexto.mensagem,
    }),
    criarToolAtualizarTarefa({ idConta: contexto.idConta, tarefa }, etapasDescricao),
    criarToolReagirMensagem({
      idConta: contexto.idConta,
      idInbox: contexto.idInbox,
      idConversa: contexto.idConversa,
      idMensagem: contexto.idMensagem,
    }),
    criarToolEnviarVideo({
      idConta: contexto.idConta,
      idConversa: contexto.idConversa,
    }),
    criarToolEnviarImagemEntregaveis({
      idConta: contexto.idConta,
      idConversa: contexto.idConversa,
    }),
    criarToolEnviarAudioWalker1({
      idConta: contexto.idConta,
      idConversa: contexto.idConversa,
    }),
    criarToolEnviarAudioWalker2({
      idConta: contexto.idConta,
      idConversa: contexto.idConversa,
    }),
    criarToolBuscarContextoSimilar(),
    // Só entra quando há print cadastrado: sem catálogo, a tool só gastaria uma chamada à toa.
    ...(CASOS_APROVADOS.length > 0
      ? [criarToolEnviarProvaSocial({ idConta: contexto.idConta, idConversa: contexto.idConversa, telefone: contexto.telefone })]
      : []),
  ];
  return contexto.semMidia ? todas.filter((t) => !NOMES_MIDIA.has(t.name)) : todas;
}

interface ContextoFollowUp {
  accountId: number;
  boardId: number;
  taskId: number;
  funilSteps: Array<{ id: number; name: string }>;
  board_step: { id: number; name: string };
}

export function criarToolsFollowup(contexto: ContextoFollowUp): StructuredToolInterface[] {
  const etapasDescricao = contexto.funilSteps.map(s => `* ${s.name}: ${s.id}`).join("\n");

  return [
    criarToolAtualizarTarefaFollowup(
      {
        accountId: contexto.accountId,
        taskId: contexto.taskId,
      },
      etapasDescricao,
      contexto.board_step.id,
    ),
  ];
}
