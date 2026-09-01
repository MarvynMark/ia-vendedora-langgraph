import { env } from "../config/env.ts";
import { listarKanbanTasks, atualizarKanbanTask, buscarConversa } from "../services/chatwoot.ts";
import { criarGrafoFollowUp } from "../graphs/follow-up/graph.ts";
import { proximoHorarioComercial } from "./horario-comercial.ts";
import { delayInicialMs } from "./delays-followup.ts";
import { primeiroNomeSaudacao } from "./nome.ts";
import { logger } from "./logger.ts";

// Etapas rastreadas: Novo Lead (1), Primeira mensagem (7), Conexao (10), Aguardando Pagamento (8), Nutrir (12)
// delayMs = quando disparar o 1º toque ao ENTRAR na etapa (fallback p/ cards sem due_date).
// Deve bater com processarTaskUpdated em routes/followup.ts.
// Etapa "Perdido" (destino da limpeza de órfãos antigos). Mesmo id usado nos demais scripts.
const STEP_PERDIDO = 11;
// Card órfão (sem conversa) mais antigo que isto é duplicata obsoleta → expira pra Perdido em vez
// de re-agendar +7d pra sempre. 14 dias dá folga de sobra: um lead novo ganha conversa em minutos.
export const DIAS_ORFAO_EXPIRA = 14;

/** Idade do card em dias a partir do created_at (0 se ausente/inválido). Exportado p/ teste. */
export function idadeCardDias(createdAt: string | undefined, agoraMs = Date.now()): number {
  if (!createdAt) return 0;
  const ms = new Date(createdAt).getTime();
  if (Number.isNaN(ms)) return 0;
  return (agoraMs - ms) / (24 * 60 * 60 * 1000);
}

// O delay do 1º toque de cada etapa vem de delayInicialMs (src/lib/delays-followup.ts), que também
// é usado pelo webhook em routes/followup.ts — os dois precisam concordar, e antes concordavam só
// por um comentário "deve bater com".
const STEPS_RASTREADOS = [
  { id: 1,  name: "Novo Lead",            tipoFollowup: "template_inicial"  as const },
  { id: 7,  name: "Primeira mensagem",    tipoFollowup: "template_abertura" as const },
  { id: 10, name: "Conexao",              tipoFollowup: "followup"          as const },
  { id: 8,  name: "Aguardando Pagamento", tipoFollowup: "lembrete"          as const },
  { id: 12, name: "Nutrir",               tipoFollowup: "nutrir"            as const },
];

let grafoFollowup: Awaited<ReturnType<typeof criarGrafoFollowUp>> | null = null;
async function obterGrafoFollowup() {
  if (!grafoFollowup) grafoFollowup = await criarGrafoFollowUp();
  return grafoFollowup;
}

export async function verificarFollowupsPendentes() {
  if (env.MODO_TESTE) {
    logger.debug("followup-timer", "Modo teste — verificação de follow-ups bloqueada");
    return;
  }

  const accountId = env.CHATWOOT_ACCOUNT_ID;
  const boardId = env.KANBAN_BOARD_ID;

  for (const step of STEPS_RASTREADOS) {
    // Buscar todas as páginas (API retorna 25 por página)
    let tasks: Awaited<ReturnType<typeof listarKanbanTasks>> = [];
    try {
      let page = 1;
      while (true) {
        const pagina = await listarKanbanTasks(accountId, boardId, step.id, page);
        tasks = tasks.concat(pagina);
        if (pagina.length < 25) break; // última página
        page++;
      }
      // Filtrar client-side pois o step_id da API não filtra corretamente
      tasks = tasks.filter(t => t.board_step_id === step.id);
      logger.info("followup-timer", `Step ${step.name}: ${tasks.length} tasks encontradas`);
    } catch (e) {
      logger.error("followup-timer", `Erro ao listar tasks do step ${step.name}:`, e);
      continue;
    }

    for (const task of tasks) {
      try {
        // Sem due_date: agendar pela primeira vez
        if (!task.due_date) {
          const proximaData = proximoHorarioComercial(new Date(), delayInicialMs(step.name, task.description ?? ""));
          await atualizarKanbanTask(accountId, task.id, { due_date: proximaData.toISOString() });
          logger.info("followup-timer", `due_date agendada para task ${task.id} (${task.title}) → ${proximaData.toISOString()}`);
          continue;
        }

        // Vencida: disparar follow-up
        if (task.date_status !== "overdue") continue;

        const conversa =
          task.conversations?.find(c => c.inbox.id === env.CHATWOOT_INBOX_ID)
          ?? task.conversations?.[0];
        if (!conversa) {
          // Card órfão (sem conversa: card de teste ou conversa removida) — não há como fazer follow-up.
          const idadeDias = idadeCardDias(task.created_at);
          if (idadeDias > DIAS_ORFAO_EXPIRA) {
            // Órfão ANTIGO = duplicata obsoleta (o card real do lead já migrou pra Perdido COM a
            // conversa). Antes o cron empurrava o due_date +7d pra sempre e o card girava à toa.
            // Agora expira UMA vez pra Perdido, parando o loop de reciclagem.
            logger.info("followup-timer", `Task ${task.id} (${task.title}) órfã há ${Math.round(idadeDias)}d — expirando para Perdido`);
            try {
              await atualizarKanbanTask(accountId, task.id, { board_step_id: STEP_PERDIDO });
            } catch { /* noop */ }
            continue;
          }
          // Órfão RECENTE (pode ganhar conversa em breve): empurra o due_date pra parar de re-escanear.
          logger.warn("followup-timer", `Task ${task.id} sem conversa associada (${Math.round(idadeDias)}d) — adiando 7 dias`);
          try {
            await atualizarKanbanTask(accountId, task.id, {
              due_date: proximoHorarioComercial(new Date(), 7 * 24 * 60 * 60 * 1000).toISOString(),
            });
          } catch { /* noop */ }
          continue;
        }
        if (conversa.inbox.id !== env.CHATWOOT_INBOX_ID) {
          logger.warn("followup-timer", `Task ${task.id}: conversa ${conversa.id} fora do inbox comercial (inbox ${conversa.inbox.id}) — follow-up ignorado`);
          continue;
        }

        // Busca telefone na conversa completa.
        // ATENÇÃO: a API do Chatwoot usa o display_id, não o id interno do banco
        // (conversa.id = id interno; conversa.display_id = id da API). Usar conversa.id aqui
        // fazia o fetch falhar → telefone vazio → card pulado sem avançar due_date → follow-up preso.
        const convApiId = conversa.display_id ?? conversa.id;
        let telefone = "";
        let nomeContato = "";
        try {
          const conversaCompleta = await buscarConversa(accountId, convApiId) as {
            meta?: { sender?: { phone_number?: string; name?: string } };
            contact?: { name?: string; phone_number?: string; additional_attributes?: { social_profiles?: { instagram?: string } } };
          };
          telefone =
            conversaCompleta.meta?.sender?.phone_number ??
            conversaCompleta.contact?.phone_number ??
            conversaCompleta.contact?.additional_attributes?.social_profiles?.instagram ??
            "";
          nomeContato =
            conversaCompleta.meta?.sender?.name ??
            conversaCompleta.contact?.name ??
            "";
        } catch (e) {
          logger.warn("followup-timer", `Erro ao buscar conversa ${conversa.id} para telefone:`, e);
        }

        if (!telefone) {
          logger.warn("followup-timer", `Task ${task.id} sem telefone — ignorando`);
          continue;
        }

        logger.info("followup-timer", `Disparando follow-up para task ${task.id} (${task.title}) — ${telefone}`);

        // Avançar due_date imediatamente antes de disparar o grafo — evita re-disparo pelo próximo
        // ciclo do cron (a cada 5 min) caso o grafo demore ou a task permaneça "overdue" na API
        try {
          const proximaProvisoria = proximoHorarioComercial(new Date(), delayInicialMs(step.name, task.description ?? ""));
          await atualizarKanbanTask(accountId, task.id, { due_date: proximaProvisoria.toISOString() });
          logger.info("followup-timer", `due_date avançada preventivamente para task ${task.id} → ${proximaProvisoria.toISOString()}`);
        } catch (e) {
          logger.warn("followup-timer", `Não foi possível avançar due_date para task ${task.id}:`, e);
        }

        const stepInfo = { id: step.id, name: step.name };

        // "Aguardando Pagamento" (8) tem duas subpopulações (viu-preço-sem-link → pós-preço vs
        // link-enviado → lembrete) que só a descrição distingue. NÃO pré-definir o tipo aqui:
        // deixa a classificar() decidir pela descrição (senão o pós-preço nunca dispararia, pois
        // o cron forçava "lembrete" para todo mundo). Demais steps mantêm o tipo pré-definido.
        const tipoFollowupInicial = step.id === 8 ? undefined : step.tipoFollowup;

        void (async () => {
          try {
            const g = await obterGrafoFollowup();
            await g.invoke({
              messages: [],
              accountId: Number(accountId),
              boardId,
              taskId: task.id,
              board_step: stepInfo,
              // Prefere o nome real do contato ao título da tarefa (que vira "Conversa" para
              // leads sem nome). Só cai no task.title se o contato não tiver primeiro nome válido.
              title: primeiroNomeSaudacao(nomeContato) ? nomeContato : task.title,
              description: task.description ?? "",
              dueDate: task.due_date ?? "",
              telefone,
              conversationId: convApiId,
              inboxId: conversa.inbox.id,
              displayId: conversa.display_id,
              funilSteps: [],
              idEtapaPerdido: 0,
              tipoFollowup: tipoFollowupInicial,
              respostaAgente: "",
            }, { configurable: { thread_id: `followup_${telefone}` } });
          } catch (e) {
            logger.error("followup-timer", `Erro no follow-up da task ${task.id}:`, e);
          }
        })();

      } catch (e) {
        logger.error("followup-timer", `Erro ao processar task ${task.id}:`, e);
      }
    }
  }
}
