// Promoção do Dia do Cliente (18/09/2026) — o que a IA apresenta HOJE no lugar da tabela normal.
//
// Decisões do Gusthavo (18/09, de manhã):
//   - vale só hoje, até 23h59 de Brasília; à meia-noite some sozinha (data em código, não em prompt)
//   - 4 preços na mesa para o lead comparar, com o "de" riscado e o desconto em reais
//   - a IA NÃO manda link: quem topa é pausado e o grupo comercial gera o link promocional à mão
//   - médicos ficam fora (o disparo deles será outro)
//
// Módulo PURO de propósito: sem rede, para o bloco do prompt e as guardas serem testáveis.

import { instanteDeParedeSP } from "../config/agenda.ts";

export interface PlanoPromocional {
  rotulo: string;
  comMaterial: boolean;
  meses: 6 | 12;
  /** Parcela "de" — o número que o lead viu na tabela (12x no cartão). */
  parcelaDe: number;
  /** Parcela "por", só hoje. */
  parcelaPor: number;
  precoDe: number;
  precoPor: number;
}

export const PROMOCAO_DIA_CLIENTE = {
  nome: "dia_cliente_2026",
  inicio: instanteDeParedeSP(2026, 8, 18, 0, 0),
  fim: instanteDeParedeSP(2026, 8, 18, 23, 59),
  /** Templates da Meta usados no disparo — servem para reconhecer quem veio da promoção. */
  templates: ["dia_cliente_quente_v2", "dia_cliente_abertura_v2", "dia_cliente_quente", "dia_cliente_abertura"],
  // Anual primeiro: é o que a gente quer vender. Com material antes de sem: é o "de" da imagem
  // que os leads receberam (Semestral 246 / Anual 394).
  planos: [
    { rotulo: "Anual com material",     comMaterial: true,  meses: 12, parcelaDe: 394, parcelaPor: 295, precoDe: 3997, precoPor: 2997 },
    { rotulo: "Semestral com material", comMaterial: true,  meses: 6,  parcelaDe: 246, parcelaPor: 197, precoDe: 2497, precoPor: 1997 },
    { rotulo: "Anual",                  comMaterial: false, meses: 12, parcelaDe: 315, parcelaPor: 246, precoDe: 3197, precoPor: 2497 },
    { rotulo: "Semestral",              comMaterial: false, meses: 6,  parcelaDe: 197, parcelaPor: 167, precoDe: 1997, precoPor: 1697 },
  ] as const satisfies readonly PlanoPromocional[],
} as const;

export function promocaoAtiva(agora = new Date()): boolean {
  return agora.getTime() >= PROMOCAO_DIA_CLIENTE.inicio.getTime() && agora.getTime() <= PROMOCAO_DIA_CLIENTE.fim.getTime();
}

/** Valores promocionais no formato que `planos.ts` usa para reconhecer preço num texto. */
export function valoresPromocionais(): string[] {
  const fmt = (n: number) => n.toLocaleString("pt-BR");
  return PROMOCAO_DIA_CLIENTE.planos.flatMap((p) => [fmt(p.precoPor), String(p.parcelaPor)]);
}

// O lead recebeu o template da promoção? Reconhecido pelo texto que ficou na memória da IA
// (o disparo registra o corpo do template como fala da IA). A frase do CTA é única dos dois
// templates, então não confunde com conversa comum.
const RE_TEXTO_PROMO = /me responde eu quero que eu te mostro/i;

export function leadVeioDaPromocao(falasDaIa: readonly string[]): boolean {
  return falasDaIa.some((t) => RE_TEXTO_PROMO.test(t ?? ""));
}

/** A tabela que a IA manda, já com a formatação do WhatsApp (~riscado~ e *negrito*). */
export function tabelaPromocao(): string {
  const linha = (p: PlanoPromocional) =>
    `${p.rotulo.replace(" com material", "")}: ~12x R$ ${p.parcelaDe}~ → *12x R$ ${p.parcelaPor}* (R$ ${(p.precoDe - p.precoPor).toLocaleString("pt-BR")} de desconto)`;
  const com = PROMOCAO_DIA_CLIENTE.planos.filter((p) => p.comMaterial).map(linha).join("\n");
  const sem = PROMOCAO_DIA_CLIENTE.planos.filter((p) => !p.comMaterial).map(linha).join("\n");
  return `*Com o material do Estratégia incluso*\n${com}\n\n*Só a mentoria, pra quem já tem material*\n${sem}`;
}

/**
 * Bloco injetado no prompt enquanto a promoção está ativa. Substitui a apresentação de preço
 * normal e muda o fechamento: nada de link, quem topa vai para uma pessoa.
 */
export function blocoPromocao(): string {
  return `
# 🎯 PROMOÇÃO DO DIA DO CLIENTE — VALE SÓ HOJE (18/09), ATÉ 23H59

<promocao>
  Hoje a mentoria está na **maior condição que já teve, nunca feita antes**. Isto SUBSTITUI a
  apresentação de preço normal (os valores de "12x de R$ 315/394" da tabela abaixo NÃO valem hoje).

  **Quando apresentar:** assim que o lead responder ao disparo ("eu quero" ou qualquer variação),
  ou pedir valor. Para quem JÁ ouviu o preço antes nesta conversa, vá direto ao número, sem
  descoberta. Para quem nunca ouviu, faça UMA pergunta antes ("você já tem material ou está
  começando do zero?") e depois apresente — hoje é dia de fechar, não de qualificar.

  **Como apresentar, em 3 bolhas:**
  1. Uma frase de contexto, honesta: nunca deu esse desconto, é só hoje e amanhã o valor volta.
  2. A tabela abaixo, COPIADA EXATAMENTE (a formatação ~riscado~ e *negrito* é do WhatsApp):
${tabelaPromocao().split("\n").map((l) => "     " + l).join("\n")}
  3. Uma recomendação (o Anual, sempre: quem tem edital longe precisa do ciclo completo, e hoje o
     Anual com material custa menos do que o Anual sem material custava ontem) e UMA pergunta:
     qual faz sentido pra ele.

  **Desconto em reais é o argumento.** Repita "R$ 1.000 a menos" (Anual com material) quando ele
  hesitar. Uma insistência só, com valor e não com pressão: 12x, garantia de 7 dias, boleto/PIX
  parcelado sem depender de cartão, e amanhã volta ao normal.

  **🚫 NÃO ENVIE LINK DE PAGAMENTO HOJE.** Os links da tabela normal são do preço cheio. O link
  promocional é gerado por uma pessoa da equipe. Quando o lead ESCOLHER um plano ("quero o anual
  com material", "fecho o semestral"), faça isto, nesta ordem:
    a) responda em UMA bolha: "Fechado! [plano] em 12x de R$ [parcela], valor de hoje. Vou gerar o
       teu link agora com essa condição e já te mando por aqui, me dá uns minutinhos."
    b) chame **Escalar_humano** com o resumo começando por
       "🎯 PROMO DIA DO CLIENTE — topou [plano] (12x R$ [parcela])". Isso pausa você e avisa a
       equipe, que manda o link.
  Enquanto ele só pergunta ou compara, você continua; só escala quando ele escolhe.

  **Regras que continuam valendo:** máximo 3 bolhas por turno, sem travessão, sempre a parcela
  (o à vista só se perguntarem), nunca invente taxa de boleto, nunca diga que o edital saiu.
</promocao>
`;
}

/** Tira do texto qualquer link de checkout — durante a promoção o link vem de uma pessoa. */
export function removerLinksDePagamento(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !/peritowalker\.com\.br\//i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
