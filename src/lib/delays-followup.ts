// Delay do PRIMEIRO toque ao entrar em cada etapa do Kanban.
//
// Estava duplicado em dois lugares que precisavam concordar na unha (STEPS_RASTREADOS em
// verificar-followups.ts e o if/else de processarTaskUpdated em routes/followup.ts, com um
// comentário "deve bater com" em cada um). Centralizado aqui para que mudar um tempo seja
// mudar um número só.
//
// Os intervalos ENTRE os toques seguintes de cada sequência continuam em graphs/follow-up/graph.ts
// (DELAYS_CONEXAO_MS, DELAYS_POS_PRECO_MS, DELAYS_LEMBRETE_MS...).

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export const DELAY_INICIAL = {
  /** Novo Lead: o template de abertura sai quase imediato. */
  novoLead: 5 * MIN,
  /** Primeira mensagem: lead frio que acabou de receber a abertura e não respondeu. */
  primeiraMensagem: 1 * DIA,
  /** Conexão: conversou e parou. 1h chegava no meio da conversa de quem responde em blocos. */
  conexao: 3 * HORA,
  /** Aguardando Pagamento SEM link enviado — viu o preço e não respondeu. */
  posPreco: 1 * HORA,
  /** Aguardando Pagamento COM link enviado — provável abandono de checkout, socorro rápido resolve. */
  lembrete: 20 * MIN,
  /** Nutrir / Perdido: esteira longa. */
  nutrir: 3 * DIA,
  /** Qualquer etapa não mapeada. */
  padrao: 1 * DIA,
} as const;

/** "link enviado" na descrição do card é o que separa o lembrete do pós-preço. */
const RE_LINK_ENVIADO = /link\s*enviado/i;

/**
 * Delay do primeiro toque, pelo nome da etapa. A descrição do card só importa em "Aguardando
 * Pagamento", que tem duas subpopulações com ritmos diferentes: quem já recebeu o link (lembrete,
 * rápido) e quem só ouviu o preço (pós-preço, com folga para responder sozinho).
 */
export function delayInicialMs(nomeEtapa: string, descricao = ""): number {
  const etapa = (nomeEtapa ?? "").toLowerCase();
  if (etapa.includes("novo lead")) return DELAY_INICIAL.novoLead;
  if (etapa.includes("primeira mensagem")) return DELAY_INICIAL.primeiraMensagem;
  if (etapa.includes("conexão") || etapa.includes("conexao")) return DELAY_INICIAL.conexao;
  if (etapa.includes("aguardando pagamento")) {
    return RE_LINK_ENVIADO.test(descricao ?? "") ? DELAY_INICIAL.lembrete : DELAY_INICIAL.posPreco;
  }
  if (etapa.includes("nutrir") || etapa.includes("perdido")) return DELAY_INICIAL.nutrir;
  return DELAY_INICIAL.padrao;
}
