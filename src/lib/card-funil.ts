// Qual card o webhook de pagamento usa para mover para "Ganho" e avisar o grupo.
//
// O contato pode ter cards em VÁRIOS quadros: o Funil Mentoria (vendas) e, desde a rotina de
// retenção da Central, o quadro "Renovação - Mentoria Vestigium" (etapas Novo, Em conversa,
// Renovou…). O webhook pegava o PRIMEIRO card que achasse; quando era o de renovação, não existe
// etapa "Ganho" ali, o processamento abortava ANTES da notificação e a venda sumia do grupo.
// 06–08/11/2026 (Black de alunos): Lucas Luscher, Renata Rivero e Priscila Fajardo pagaram e o
// grupo não soube.
//
// Só vale card do quadro do funil. Sem nenhum, o chamador cai no fallback que cria conversa + card.
//
// Função PURA e sem I/O (mesmo motivo de renovacao.ts: mock.module vaza entre arquivos de teste).

export interface ConversaComCard {
  id: number;
  inbox_id: number;
  kanban_task?: Record<string, unknown>;
}

export function escolherConversaDoFunil<T extends ConversaComCard>(
  conversas: T[],
  boardIdFunil: number,
): T | undefined {
  return conversas.find(
    (c) =>
      c.kanban_task &&
      Object.keys(c.kanban_task).length > 0 &&
      Number(c.kanban_task["board_id"]) === boardIdFunil,
  );
}
