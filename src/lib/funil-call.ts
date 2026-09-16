import { env } from "../config/env.ts";
import { ETIQUETA_TIER } from "./tier-lead.ts";

// Qual funil este lead vê: o de sempre (venda por texto) ou o de sessão estratégica (a IA agenda,
// o humano fecha). É a ÚNICA porta entre as duas trilhas — o graph.ts só pergunta aqui.
//
// Reverter o experimento é trocar FUNIL_CALL para "off" no Coolify e redeployar (~2 min), NUNCA um
// git revert: o revert de bf3063d mostrou que ele leva junto correções boas do mesmo commit.

export type Trilha = "antigo" | "sessao";

export interface EntradaTrilha {
  etiquetas?: string[] | null;
  /**
   * A IA já disse um preço ou mandou um link de pagamento NESTA conversa?
   *
   * Se já disse, o lead fica no funil antigo até o fim, mesmo com a flag ligada. Sem isso, no dia
   * em que a flag é ligada, quem está no meio de uma negociação veria a IA de repente se recusar a
   * falar de valor — que é a pior coisa que pode acontecer com um lead quente.
   */
  ofertaJaApresentada: boolean;
}

/**
 * Etiqueta que força a trilha antiga (venda por texto) mesmo com FUNIL_CALL="on". Nasceu em
 * 16/09/2026 para os 57 médicos de agosto cujo webhook nunca disparou: o Gusthavo quis atendê-los
 * pelo WhatsApp, sem convite para reunião. Serve para qualquer lead que uma pessoa decida tirar
 * do funil de sessão — é só pôr a etiqueta na conversa.
 */
export const ETIQUETA_SEM_SESSAO = "sem-sessao";

export function trilhaDoLead({ etiquetas, ofertaJaApresentada }: EntradaTrilha): Trilha {
  if (env.FUNIL_CALL === "off") return "antigo";
  if (ofertaJaApresentada) return "antigo";
  if ((etiquetas ?? []).includes(ETIQUETA_SEM_SESSAO)) return "antigo";
  if (env.FUNIL_CALL === "on") return "sessao";
  // "piloto": só o tier que declarou ter condição de investir vai para a sessão; o resto segue
  // byte a byte no fluxo antigo. Lead sem a etiqueta (formulário antigo, lead orgânico) fica no
  // antigo de propósito — no piloto a comparação entre os dois grupos é o objetivo.
  return (etiquetas ?? []).includes(ETIQUETA_TIER.sim) ? "sessao" : "antigo";
}

/**
 * Resposta que SUBSTITUI o turno quando a IA tenta falar de preço na trilha de sessão.
 *
 * Substitui em vez de descartar a bolha (como fazem os filtros de saída) porque a pergunta do lead
 * ficaria sem resposta — e "quanto custa?" ignorado é o que mais faz lead sumir. Mesmo padrão do
 * gate de material (PERGUNTA_DESCOBERTA_MATERIAL) e do de elegibilidade (RESPOSTA_ELEGIBILIDADE).
 *
 * A razão dada é VERDADEIRA, e é por isso que ela segura: o plano muda mesmo conforme o ponto de
 * partida (com ou sem material) e o concurso (edital publicado ou não). Não é evasiva.
 */
export const PONTE_PRECO_SESSAO =
  "O valor eu te falo na nossa conversa, e não é enrolação: o plano muda conforme o teu ponto de partida e o teu concurso, e já vi gente escolher errado decidindo só pelo número. " +
  "Lá eu te mostro o que faz sentido pro teu caso e o valor certinho. " +
  "Me diz qual dos horários fica melhor pra você que eu já deixo reservado.";

// ─────────────────────────────────────────────────────────────────────────────
// DESISTÊNCIA / REMARCAÇÃO — o lead com sessão marcada avisa que não vem.
//
// Ronaldo (conv 7399, 14/09): "Houve um imprevisto e não poderei participar hoje as 18hs", depois
// "posso verificar uma data e te informar em outro momento?". A IA respondeu "quando estiver
// pronto me avisa" e NÃO chamou Agendar_sessao. O evento ficou na agenda, o lembrete de 1h saiu
// com link para quem já tinha cancelado, e a cadeira ficou reservada para ninguém.
//
// Regex só de TRIAGEM: quem decide cancelar ou remarcar continua sendo o modelo, via tool. O que
// muda é que, quando isto bate e há sessão futura, o turno recebe uma instrução explícita — e se
// mesmo assim a tool não for chamada, o comercial é avisado para resolver à mão.
const RE_DESISTE_DA_SESSAO =
  /n[ãa]o (vou|vai|irei|consigo) (poder|conseguir|participar|comparecer|estar|dar)|n[ãa]o (poderei|conseguirei|participarei)|imprevisto|desmarcar|cancelar|remarcar|reagendar|adiar|(outro|outra) (dia|hor[áa]rio|data|hora)|mudar (o |a )?(dia|hor[áa]rio|data)|n[ãa]o (vai|vou) (dar|rolar)|n[ãa]o d[áa] (pra|para) (mim|hoje|amanh[ãa])|deixa (pra|para) (outro|depois)|te (avis|inform|fal)\w* (depois|em (um )?outro momento|outra hora|mais tarde)|(verificar|ver|olhar|conferir) (melhor )?(uma|a|minha) (data|agenda)/i;

/** A mensagem do lead parece cancelamento ou pedido de remarcação da sessão? */
export function pareceDesistirDaSessao(texto: string): boolean {
  return RE_DESISTE_DA_SESSAO.test(texto ?? "");
}
