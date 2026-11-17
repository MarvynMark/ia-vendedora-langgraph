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

// Qual contato o webhook de pagamento usa quando a busca acha MAIS DE UM para a mesma pessoa.
//
// 16/11/2026 (Léia Sartori, Black Médico Legista): a LP da Black criou um contato novo com o
// telefone COM o 9º dígito (+5534988417380), sem conversa nem inbox, enquanto o contato real
// (com card no funil) estava salvo SEM o 9º (+553488417380). O webhook busca primeiro a variante
// com o 9º, pegou o duplicado, o fallback não conseguiu criar conversa para um contato sem
// vínculo de WhatsApp e a venda não chegou nem ao grupo nem ao card.
//
// Preferência: 1º quem tem card no funil → 2º quem tem alguma conversa → 3º o primeiro achado
// (que cai no fallback de criar conversa + card, como antes).
export interface CandidatoContato<C> {
  contato: C;
  conversas: ConversaComCard[];
}

export function escolherContatoDoPagamento<C>(
  candidatos: CandidatoContato<C>[],
  boardIdFunil: number,
): CandidatoContato<C> | undefined {
  return (
    candidatos.find((c) => escolherConversaDoFunil(c.conversas, boardIdFunil)) ??
    candidatos.find((c) => c.conversas.length > 0) ??
    candidatos[0]
  );
}

// Quem tem card no quadro de renovação já é aluno — a rotina de retenção da Central só cria card
// ali para aluno com plano ativo/vencendo. A compra dele é RENOVAÇÃO mesmo quando o card do funil
// não mostra isso: card antigo sem "boas-vindas: enviado" (Leandra Rosique, 08/11) ou nenhum card
// no funil, caindo no fallback (Eliza Nunes, 08/11). Sem isso o grupo via "NOVO ALUNO" e a aluna
// recebia de novo as boas-vindas de quem acabou de entrar.
export function temCardDeRenovacao(conversas: ConversaComCard[], boardIdRenovacao: number): boolean {
  return conversas.some(
    (c) => c.kanban_task && Number(c.kanban_task["board_id"]) === boardIdRenovacao,
  );
}
