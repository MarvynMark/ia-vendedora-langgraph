import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { atualizarKanbanTask } from "../services/chatwoot.ts";
import { delayInicialMs, RE_LINK_ENVIADO } from "../lib/delays-followup.ts";
import { proximoHorarioComercial } from "../lib/horario-comercial.ts";
import { logger } from "../lib/logger.ts";

interface ContextoAtualizarTarefaMainAgent {
  idConta: string;
  tarefa: Record<string, unknown>;
}

/**
 * O STATUS "link enviado" NÃO É MAIS ESCRITO PELO LLM — mesmo motivo do due_date logo abaixo.
 *
 * Na conv 6987 a IA moveu o card para "Aguardando Pagamento" já com "👤 - Descrição: link
 * enviado" enquanto ainda perguntava "posso te mostrar os planos?" — nenhum preço e nenhum link
 * tinham saído. O marcador roteia a cadência: com ele o primeiro toque é o lembrete de abandono
 * de checkout em 20 minutos, e a lead levou "travou alguma coisa na hora de finalizar?" sem
 * nunca ter visto um valor.
 *
 * Quem escreve o marcador é o guard determinístico do grafo (moverParaAguardandoPagamento), que
 * roda depois dos gates e detecta o link no texto que de fato foi enviado. Aqui só preservamos o
 * que o card já tinha: se o LLM tentar INTRODUZIR o marcador, ele vira "em negociação".
 */
const RE_LINHA_STATUS = /^(.*Descri[çc][ãa]o:\s*).*$/im;

export function sanitizarLinkEnviado(descricaoNova: string, descricaoAtual: string): string {
  const nova = descricaoNova ?? "";
  if (!RE_LINK_ENVIADO.test(nova)) return nova;
  if (RE_LINK_ENVIADO.test(descricaoAtual ?? "")) return nova; // já era do card, o código pôs
  if (RE_LINHA_STATUS.test(nova)) return nova.replace(RE_LINHA_STATUS, "$1em negociação");
  return nova.replace(RE_LINK_ENVIADO, "em negociação");
}

export function criarToolAtualizarTarefa(contexto: ContextoAtualizarTarefaMainAgent, etapasDescricao: string) {
  return tool(
    async (input) => {
      const taskId = contexto.tarefa["id"] as number | undefined;

      if (!taskId) {
        return JSON.stringify({ erro: "Tarefa não encontrada." });
      }

      // O PRAZO NÃO É MAIS DECIDIDO PELO LLM. Ele chutava um endDate (quase sempre "amanhã de
      // tarde") e isso sobrescrevia a cadência calibrada: na conv 6671 o card entrou em Aguardando
      // Pagamento com o link já enviado — o lembrete de abandono de checkout deveria sair em 20
      // minutos e foi agendado para 36 horas depois. Agora o due_date vem de delayInicialMs, a
      // mesma função que o cron e o webhook usam.
      const stepDestino = Number(input.stepId);
      const nomeEtapa =
        (contexto.tarefa["board"] as { steps?: Array<{ id: number; name: string }> } | undefined)
          ?.steps?.find(s => s.id === stepDestino)?.name ?? "";
      const descricaoAtual = String(contexto.tarefa["description"] ?? "");
      const descricao = sanitizarLinkEnviado(input.description ?? "", descricaoAtual);
      if (descricao !== (input.description ?? "")) {
        logger.warn("tool:atualizar-tarefa", "LLM tentou marcar 'link enviado' sem link no card — rebaixado para 'em negociação'", { taskId });
      }
      const dueDate = proximoHorarioComercial(new Date(), delayInicialMs(nomeEtapa, descricao));

      try {
        const resultado = await atualizarKanbanTask(
          contexto.idConta,
          taskId,
          {
            board_step_id: stepDestino,
            title: input.title,
            description: descricao,
            due_date: dueDate.toISOString(),
          },
        );
        // Reflete no turno atual: os guards determinísticos do grafo leem board_step_id/description
        // de `tarefa` depois que o agente responde, e sem isso enxergariam o card de antes da tool.
        contexto.tarefa["board_step_id"] = stepDestino;
        contexto.tarefa["description"] = descricao;
        return JSON.stringify(resultado);
      } catch (e) {
        logger.error("tool:atualizar-tarefa", "Erro:", e);
        return JSON.stringify({ erro: "Falha na operação. Tente novamente." });
      }
    },
    {
      name: "Atualizar_tarefa",
      description: `Atualiza a tarefa (mover etapa, título, descrição, prazo). Ação interna e silenciosa — nunca comente com o lead.\n\nIDs das etapas:\n${etapasDescricao}\nUse o ID da etapa atual se não houver mudança de etapa. Ao editar a descrição, sempre mantenha o conteúdo original.\n\nO prazo do próximo follow-up é calculado automaticamente pela etapa — você não define data.`,
      schema: z.object({
        stepId: z.string().describe("ID da etapa destino no Kanban"),
        title: z.string().describe("Título da tarefa"),
        description: z.string().describe("Descrição da tarefa"),
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
