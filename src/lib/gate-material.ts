// GATE DE DESCOBERTA DE MATERIAL — guarda determinística que impede o preço de sair antes de a
// IA saber se o lead já tem material/curso organizado.
//
// Motivo (diagnóstico de 25/08 sobre as conversas desde 17/08): a pergunta de descoberta só foi
// feita em 20 de 62 conversas que chegaram ao preço. Sem ela o agente chuta o plano e depois se
// corrige, despejando dois preços — na conv 5929 o lead abriu com "eu já tenho a assinatura do
// estratégia concurso", recebeu o Anual Completo (R$ 394, que INCLUI a Premium do Estratégia) e
// só então o Anual (R$ 315). Sumiu. Apenas 1 dos 36 leads ouviu um único preço.
//
// O gate garante que a PERGUNTA aconteça; a escolha do plano continua com o LLM lendo a resposta
// no histórico. Médicos passam direto: a trilha Médico Legista já inclui o material.

// A pergunta de descoberta como o prompt a formula ("você já tem um material/conteúdo organizado
// (tipo Estratégia, Gran, apostila) ou ainda tá sem isso?") e suas paráfrases prováveis.
const RE_PERGUNTA_MATERIAL =
  /(material|conte[úu]do organizado|apostila|cursinho|curso preparat[óo]rio|estrat[ée]gia|gran\b)/i;

// Texto da pergunta que substitui o preço quando o gate bloqueia. Mesma formulação do prompt,
// para o lead não ver duas versões diferentes da mesma pergunta.
export const PERGUNTA_DESCOBERTA_MATERIAL =
  "Antes de te indicar o plano certo, me conta uma coisa: pra estudar as matérias você já tem " +
  "algum material ou curso organizado (tipo Estratégia, Gran, um cursinho), ou ainda tá sem isso?";

/** Mesmo formato do histórico persistido em `buscarHistorico` (src/db/memoria.ts). */
export interface MensagemHistorico {
  type: string;
  content: string;
}

/**
 * A descoberta já aconteceu? Verdadeiro quando o agente fez a pergunta de material e o lead
 * respondeu alguma coisa depois dela — a classificação do que ele respondeu fica com o LLM.
 */
export function descobertaMaterialFeita(historico: MensagemHistorico[]): boolean {
  const iPergunta = historico.findIndex(
    (m) => m.type === "ai" && RE_PERGUNTA_MATERIAL.test(m.content ?? "") && (m.content ?? "").includes("?"),
  );
  if (iPergunta < 0) return false;
  return historico.slice(iPergunta + 1).some((m) => m.type === "human" && (m.content ?? "").trim() !== "");
}

/**
 * O próprio lead já entregou a informação sem ser perguntado ("já tenho o Estratégia",
 * "não tenho material nenhum")? Evita fazer uma pergunta cuja resposta já está na mesa —
 * repetir o que o lead acabou de dizer é o comportamento robótico que o prompt proíbe.
 */
const RE_LEAD_TEM = /\b(j[áa] (tenho|assino|sou assinante)|tenho (o|a|um|uma)?\s*(estrat[ée]gia|gran|cursinho|curso|material|apostila)|sou aluno|assinatura d[oa])\b/i;
const RE_LEAD_NAO_TEM = /\b(n[ãa]o tenho|ainda n[ãa]o tenho|t[ôo] sem|estou sem|n[ãa]o possuo|nada ainda|comecei do zero|do zero)\b/i;

export function classificarRespostaMaterial(texto: string): "sim" | "nao" | null {
  const t = texto ?? "";
  if (RE_LEAD_NAO_TEM.test(t)) return "nao";
  if (RE_LEAD_TEM.test(t)) return "sim";
  return null;
}

/** O lead falou de material espontaneamente em qualquer ponto da conversa? */
export function materialDeclaradoPeloLead(historico: MensagemHistorico[]): "sim" | "nao" | null {
  for (const m of historico) {
    if (m.type !== "human") continue;
    const c = classificarRespostaMaterial(m.content ?? "");
    if (c) return c;
  }
  return null;
}
