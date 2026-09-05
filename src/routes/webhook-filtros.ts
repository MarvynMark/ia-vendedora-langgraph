// Filtros PUROS do webhook do Chatwoot, extraídos para teste determinístico. Testar a rota
// inteira exigia mock.module de chatwoot/graph/db, que no bun VAZA entre arquivos de teste e
// poluía a suíte (webhook.test.ts derrubava testes de chatwoot/áudio). Estas funções não têm
// dependência externa — dá pra testar sem mock nenhum.
//
// Elas cobrem só as decisões de IGNORAR/prosseguir. NÃO cobrem: filtro de event, dedup
// (reivindicarMensagem, assíncrono), nem as AÇÕES de grupo-espera e /reset.

// Checagens ANTES do ramo de grupo-espera: isto é uma mensagem real do lead?
// - not_incoming: não é mensagem recebida (bot/nota/atualização).
// - reaction: reação (emoji) — conv 4677: lead reagiu ❤️ ao pitch e a IA mandou o link. NÃO é msg.
// - agent_message: o sender não é o contato da conversa (mensagem do próprio bot/agente).
export function motivoIgnorarPreGrupo(
  messageType: number | string,
  isReaction: boolean | undefined,
  senderId: number,
  contactId: number | undefined,
): "not_incoming" | "reaction" | "agent_message" | null {
  if (messageType !== 0 && messageType !== "incoming") return "not_incoming";
  if (isReaction === true) return "reaction";
  if (contactId !== undefined && senderId !== contactId) return "agent_message";
  return null;
}

// Checagens de ATIVAÇÃO (depois do ramo de grupo-espera): a IA deve atender esta conversa?
// - no_agente-on: sem o label de ativação (humano assume removendo "agente-on").
// - modo_teste: com MODO_TESTE ligado, só atende conversas marcadas "teste-agente".
export function motivoIgnorarAtivacao(
  labels: string[],
  modoTeste: boolean,
): "no_agente-on" | "modo_teste" | null {
  if (!labels.includes("agente-on")) return "no_agente-on";
  if (modoTeste && !labels.includes("teste-agente")) return "modo_teste";
  return null;
}

// --- Grupo de espera: PEDIDO vs MENÇÃO ---
//
// O gatilho era só a presença da expressão, e citar o grupo virava pedir o grupo. Na conv 6890 a
// lead escreveu "Ontem eu assisti o vídeo no YouTube [...] que você mandou no grupo de espera. Foi
// muito inspiradora a história da Fernanda" e recebeu, UM SEGUNDO depois, "Clique no link abaixo
// para entrar no grupo de espera" — ela já estava lá dentro, e acabara de provar isso.

const GRUPO_ESPERA_KEYWORDS = ["grupo de espera", "grupo de espero", "acesso ao grupo", "entrar no grupo"];

// Verbos que colocam o grupo no PASSADO/relato: o lead está contando algo que viu ou recebeu lá.
const RE_MENCAO_GRUPO = /\b(mandou|mandaram|enviou|enviaram|postou|postaram|colocou|colocaram|compartilhou|falou|falaram|vi|assisti|li|ouvi|tinha|teve|apareceu)\b/i;

// Marcas de PEDIDO. Se aparecerem, é pedido mesmo que ele também mencione o grupo
// ("vi que tem um grupo de espera, quero entrar").
const RE_PEDIDO_GRUPO = /\b(quero|queria|gostaria|preciso|pode|poderia|consigo|como|onde|manda|mande|passa|passe|envia|envie|link|entrar|participar|acessar|acesso|cadastr\w*)\b/i;

/**
 * O lead está PEDINDO o link do grupo de espera?
 *
 * Conservador de propósito: só recusa quando a mensagem é claramente um RELATO sobre o grupo e
 * não tem nenhuma marca de pedido. Mandar o link a mais é constrangedor; não mandar para quem
 * pediu deixa o lead de fora, que é pior.
 */
export function pedeGrupoDeEspera(content: string): boolean {
  const c = (content ?? "").toLowerCase();
  if (!GRUPO_ESPERA_KEYWORDS.some((kw) => c.includes(kw))) return false;
  if (RE_MENCAO_GRUPO.test(c) && !RE_PEDIDO_GRUPO.test(c)) return false;
  return true;
}
