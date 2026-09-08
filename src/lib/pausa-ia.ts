/**
 * A IA está pausada nesta conversa? Quem manda é a label `agente-on` — o humano assume removendo
 * ela, e a IA só volta quando alguém devolve a label.
 *
 * Vive aqui, pura, porque DOIS caminhos precisam da mesma regra e só um a aplicava: o webhook do
 * Chatwoot já checava antes de responder o lead, mas o follow-up é disparado pelo Kanban e passava
 * direto. Uma conversa escalada continuava recebendo toque automático por cima do atendente que
 * tinha assumido.
 */
export function iaEstaPausada(labels: string[] | undefined | null): boolean {
  return !(labels ?? []).includes("agente-on");
}
