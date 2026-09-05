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
//
// ⚠️ O gatilho é a OFERTA, não só o preço. Na conv 6890 a lead voltou com "Gostaria de contratar a
// mentoria" e recebeu direto o link do Anual puro, sem a IA escrever um único R$ — os dois gates
// passaram por baixo, e uma iniciante que não sabia por onde começar levou o plano SEM material
// quando o roteiro mandava o Anual Completo. Ver `temLinkDePagamento` em lib/planos.ts.

// A pergunta de descoberta como o prompt a formula ("você já tem um material/conteúdo organizado
// (tipo Estratégia, Gran, apostila) ou ainda tá sem isso?") e suas paráfrases prováveis.
const RE_PERGUNTA_MATERIAL =
  /(material|conte[úu]do organizado|apostila|cursinho|curso preparat[óo]rio|estrat[ée]gia|gran\b)/i;

// Texto da pergunta que substitui o preço quando o gate bloqueia. Mesma formulação do prompt,
// para o lead não ver duas versões diferentes da mesma pergunta.
/**
 * Segunda descoberta: a SITUAÇÃO de estudo. Em agosto o lead escreveu 34 caracteres em média
 * antes de ouvir o preço — a IA vendia para quem não conhecia. Esta pergunta pede uma cena, não
 * um rótulo, porque rótulo se responde com uma palavra e não dá o que espelhar depois.
 */
export const PERGUNTA_DESCOBERTA_SITUACAO =
  "Antes de eu te falar de plano, me conta uma coisa: como tá tua rotina de estudo hoje, na prática? " +
  "Pergunto porque eu acompanho cada mentorado de perto, então preciso entender teu caso pra saber o que faz sentido.";

export const PERGUNTA_DESCOBERTA_MATERIAL =
  "Antes de te indicar o plano certo, me conta uma coisa: pra estudar as matérias você já tem " +
  "algum material ou curso organizado (tipo Estratégia, Gran, um cursinho), ou ainda tá sem isso?";

/** Mesmo formato do histórico persistido em `buscarHistorico` (src/db/memoria.ts). */
export interface MensagemHistorico {
  type: string;
  content: string;
}

/** Uma fala é "substantiva" quando traz contexto, não um monossílabo de cortesia. */
const MIN_CHARS_SUBSTANTIVO = 40;
export function falaSubstantiva(texto: string): boolean {
  const t = (texto ?? "").trim();
  if (t.length < MIN_CHARS_SUBSTANTIVO) return false;
  // "sim, pode sim, obrigado" é longo mas não diz nada
  return !/^((sim|não|nao|ok|blz|beleza|certo|entendi|obrigad[oa]|claro|pode ser|t[áa] bom|isso)[\s,.!]*)+$/i.test(t);
}

/**
 * O lead já CONTOU a situação dele? Exige pelo menos duas falas substantivas — é o piso de
 * qualificação: sem isso o pitch cai no vazio, porque não há dor articulada para ancorar.
 */
export function situacaoDescoberta(historico: MensagemHistorico[]): boolean {
  return historico.filter((m) => m.type === "human" && falaSubstantiva(m.content ?? "")).length >= 2;
}

// Fragmento distintivo de PERGUNTA_DESCOBERTA_SITUACAO — reconhece a pergunta já enviada, mesmo
// se o LLM tiver parafraseado o resto da frase.
const RE_PERGUNTA_SITUACAO = /rotina de estudo (hoje|agora)|como (t[áa]|est[áa]) (a )?(tua|sua) rotina de estudo/i;

/**
 * VÁLVULA ANTI-LOOP. `situacaoDescoberta` só destrava com DUAS falas de 40+ caracteres, e nem
 * todo comprador escreve assim: quem responde "não tenho" e "quero sim" nunca chega lá, e o gate
 * devolveria a mesma pergunta a cada turno, para sempre. Se a pergunta já foi feita e o lead
 * respondeu alguma coisa, considera-se cumprida — perguntar de novo é o comportamento robótico
 * que o roteiro proíbe, e o custo de deixar passar é menor que o de travar quem quer comprar.
 */
export function descobertaSituacaoFeita(historico: MensagemHistorico[]): boolean {
  const iPergunta = historico.findIndex(
    (m) => m.type === "ai" && RE_PERGUNTA_SITUACAO.test(m.content ?? ""),
  );
  if (iPergunta < 0) return false;
  return historico.slice(iPergunta + 1).some((m) => m.type === "human" && (m.content ?? "").trim() !== "");
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
