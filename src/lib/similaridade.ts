/**
 * Comparação de texto tolerante a PARÁFRASE.
 *
 * O LLM repete a mesma informação com outras palavras: na conv 5385 o `mensagem_antes` do áudio 1
 * foi "Acabei de ver que você é formado em Medicina e que essa é a primeira vez..." e o output do
 * mesmo turno trouxe "Vi que você é formado em Medicina e que essa é a primeira vez...". Comparação
 * por substring (o que blocoDuplicaMidia fazia) não pega esse caso.
 *
 * Módulo PURO e sem dependências: usado pelos filtros de saída (services/chatwoot.ts), pela
 * montagem do output do turno (graphs/main-agent/output.ts) e pelas tools de mídia.
 */

/** minúsculas, sem acento, sem pontuação/emoji, espaços colapsados. */
export function normalizar(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trigramas de PALAVRAS (não de caracteres): exigem a mesma ordem, o que segura falso-positivo. */
function trigramas(s: string): string[] {
  const w = normalizar(s).split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + 2 < w.length; i++) out.push(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Fração mínima dos trigramas do bloco que precisa existir no texto anterior. */
export const LIMIAR_PARAFRASE = 0.6;
/** Abaixo disto a frase é curta demais para similaridade — só substring exata decide. */
const MIN_PALAVRAS = 6;
/** Trava absoluta: frase nova precisa repetir 4+ sequências de 3 palavras na MESMA ordem. */
const MIN_TRIGRAMAS_COMUNS = 4;

/**
 * `bloco` repete (literalmente ou parafraseando) algo já dito em `anterior`?
 *
 * Calibrado com os textos reais das conversas 5385 e 5525:
 *   "Vi que você é formado em Medicina..." vs "Acabei de ver que você é formado em Medicina..."
 *      → 16/17 = 0,94 → true
 *   "Isso é bem mais comum do que parece..." vs "Isso é mais comum do que parece..."
 *      → 10/13 = 0,77 → true
 *   "Você também sente isso na hora de estudar?" vs os mesmos → 0/6 → false
 */
export function ehRepeticao(bloco: string, anterior: string): boolean {
  const nb = normalizar(bloco);
  const na = normalizar(anterior);
  if (nb.length < 5 || !na) return false;
  if (na.includes(nb)) return true; // caminho antigo (substring exata), preservado
  if (nb.split(" ").length < MIN_PALAVRAS) return false;
  const tb = trigramas(bloco);
  if (tb.length === 0) return false;
  const ta = new Set(trigramas(anterior));
  const comuns = tb.filter((t) => ta.has(t)).length;
  return comuns >= MIN_TRIGRAMAS_COMUNS && comuns / tb.length >= LIMIAR_PARAFRASE;
}

export function ehRepeticaoDeAlgum(bloco: string, anteriores: string[]): boolean {
  return anteriores.some((a) => ehRepeticao(bloco, a));
}
