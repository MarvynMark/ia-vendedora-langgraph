import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { atualizarKanbanTask } from "../services/chatwoot.ts";
import { logger } from "../lib/logger.ts";

interface ContextoAtualizarTarefaMainAgent {
  idConta: string;
  tarefa: Record<string, unknown>;
}

export function criarToolAtualizarTarefa(contexto: ContextoAtualizarTarefaMainAgent, etapasDescricao: string) {
  return tool(
    async (input) => {
      const taskId = contexto.tarefa["id"] as number | undefined;

      if (!taskId) {
        return JSON.stringify({ erro: "Tarefa não encontrada." });
      }

      try {
        const resultado = await atualizarKanbanTask(
          contexto.idConta,
          taskId,
          {
            board_step_id: Number(input.stepId),
            title: input.title,
            description: input.description,
            due_date: input.endDate,
          },
        );
        return JSON.stringify(resultado);
      } catch (e) {
        logger.error("tool:atualizar-tarefa", "Erro:", e);
        return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
      }
    },
    {
      name: "Atualizar_tarefa",
      description: `Use essa ferramenta para atualizar a tarefa.\n\n### IDs etapas\n\n${etapasDescricao}\n\n**USAR ID DA ETAPA ATUAL CASO NÃO HAJA ATUALIZAÇÃO NA ETAPA**\n\n### Descrição\n\nAo adicionar informações na descrição, sempre inclua a descrição original. NUNCA omita a descrição original, a não ser que o objetivo seja remover a informação.`,
      schema: z.object({
        stepId: z.string().describe("ID da etapa destino no Kanban"),
        title: z.string().describe("Título da tarefa"),
        description: z.string().describe("Descrição da tarefa"),
        endDate: z.string().describe("Data limite no formato ISO 8601 com fuso horário"),
      }),
    },
  );
}

// Versão simplificada para o Follow-up
interface ContextoAtualizarTarefaFollowUp {
  accountId: number;
  taskId: number;
}

export function criarToolAtualizarTarefaFollowup(
  contexto: ContextoAtualizarTarefaFollowUp,
  etapasDescricao: string,
  idEtapaAtual: number,
) {
  return tool(
    async (input) => {
      try {
        const resultado = await atualizarKanbanTask(
          contexto.accountId,
          contexto.taskId,
          {
            board_step_id: Number(input.Kanban_Step),
            description: input.Description,
            due_date: input.End_Date,
          },
        );
        return JSON.stringify(resultado);
      } catch (e) {
        logger.error("tool:atualizar-tarefa-followup", "Erro:", e);
        return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
      }
    },
    {
      name: "Atualizar_tarefa",
      description: `Atualizar o prazo do próximo follow-up ou mover o lead para "Perdido (reativar)".\n\nIDs de etapa:\n${etapasDescricao}\n* **Etapa atual do card**: ${idEtapaAtual}`,
      schema: z.object({
        Description: z.string().describe("Descrição atualizada da tarefa"),
        Kanban_Step: z.string().describe("ID da etapa destino"),
        End_Date: z.string().describe("Data/hora do próximo follow-up no formato ISO 8601 com fuso horário"),
      }),
    },
  );
}
