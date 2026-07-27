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
