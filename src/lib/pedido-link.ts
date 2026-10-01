// Pedido do link no fechamento (conv 9360).
//
// O roteiro manda perguntar "Olha, posso gerar o link pra você, pra gente já finalizar agora?"
// quando o lead escolhe o plano. A IA parafraseou: "Ótimo, Dorineide! Vou gerar o link pra você,
// pra gente já finalizar agora. Pode ser?". Os filtros fizeram o resto: o "Ótimo, Dorineide!" caiu
// como validação vazia, o "Vou gerar o link..." caiu como anúncio de link sem link
// (blocoTemFraseProibida), e a lead recebeu só "Pode ser?".
//
// Aqui o anúncio curto de link, num turno SEM link, vira a pergunta canônica — antes dos filtros,
// para que a pergunta sobreviva — e a confirmação solta que vinha atrás dele ("Pode ser?") sai.

export const PERGUNTA_LINK = "Olha, posso gerar o link pra você, pra gente já finalizar agora?";

const RE_URL_CHECKOUT = /peritowalker\.com\.br\//i;
// Mesmo recorte do filtro de anúncio em blocoTemFraseProibida: frase curta que anuncia o link.
const RE_ANUNCIO_LINK = /^(olha,?\s+)?vou (te |lhe )?(gerar|passar|mandar|enviar|preparar).{0,25}\blink\b/i;
// Confirmação solta, sem conteúdo próprio: "Pode ser?", "Posso?", "Bora?", "Beleza?", "Tudo bem?".
const RE_CONFIRMACAO_SOLTA = /^(pode ser|posso|bora|beleza|tudo bem|combinado|fechado|ok|certo)\s*\?$/i;

export function normalizarPedidoDeLink(frases: readonly string[]): string[] {
  if (frases.some((f) => RE_URL_CHECKOUT.test(f))) return [...frases];
  const i = frases.findIndex((f) => RE_ANUNCIO_LINK.test(f.trim()) && f.trim().split(/\s+/).length <= 14);
  if (i < 0) return [...frases];

  const saida = frases.filter((f, k) => k !== i && !(k > i && RE_CONFIRMACAO_SOLTA.test(f.trim())));
  saida.splice(Math.min(i, saida.length), 0, PERGUNTA_LINK);
  // A pergunta é o fecho do turno: o que viesse depois dela competiria com ela.
  return saida.slice(0, saida.indexOf(PERGUNTA_LINK) + 1);
}
