import type { StructuredToolInterface } from "@langchain/core/tools";
import { refletir } from "./refletir.ts";
import { criarToolEscalarHumano } from "./escalar-humano.ts";
import { criarToolAtualizarTarefa, criarToolAtualizarTarefaFollowup } from "./atualizar-tarefa.ts";
import { criarToolReagirMensagem } from "./reagir-mensagem.ts";
import { criarToolEnviarVideo } from "./enviar-video.ts";

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
}

export function criarToolsAgenteVestigium(contexto: ContextoMainAgent): StructuredToolInterface[] {
  const tarefa = contexto.tarefa;
  const board = tarefa["board"] as { steps?: Array<{ id: number; name: string }> } | undefined;
  const etapas = board?.steps ?? [];
  const etapasDescricao = etapas.map(s => `${s.name}: ${s.id}`).join("\n") || "(não disponível)";

  return [
    refletir,
    criarToolEscalarHumano({
      telefone: contexto.telefone,
      nome: contexto.nome,
      idConta: contexto.idConta,
      idConversa: contexto.idConversa,
      idInbox: contexto.idInbox,
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
  ];
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
