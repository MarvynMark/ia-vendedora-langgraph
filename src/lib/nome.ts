// Saudação segura com o primeiro nome do lead.
//
// Contatos criados sem nome no Chatwoot ficam com o TELEFONE/wa_id no campo "name".
// Sem tratamento, as automações (follow-up, boas-vindas, opener) mandavam saudações
// esquisitas como "Oi 5518997537716, ...". Estas funções detectam esse caso e evitam
// usar o número como nome.

// Token que é basicamente um telefone: só dígitos e símbolos de telefone (+, -, (), ., espaço).
const SO_NUMERO_RE = /^[\d+()\-.\s]+$/;

/**
 * Retorna o primeiro nome do lead para saudação, ou `fallback` quando o "nome" é inválido
 * (vazio ou parece um telefone/wa_id). Ex.: "Maria Silva" → "Maria"; "5518997537716" → fallback.
 */
export function primeiroNomeSaudacao(nomeCru: string | null | undefined, fallback = ""): string {
  const nome = (nomeCru ?? "").trim();
  if (!nome) return fallback;
  const primeiro = nome.split(/\s+/)[0] ?? "";
  if (!primeiro) return fallback;
  if (SO_NUMERO_RE.test(primeiro)) return fallback;                 // "+5518...", "18 99753-7716"
  if ((primeiro.match(/\d/g) ?? []).length >= 4) return fallback;   // muitos dígitos = wa_id/telefone
  return primeiro;
}

/**
 * Substitui o placeholder [Nome] no texto de forma segura.
 * - Nome válido → "Oi Maria, ...".
 * - Nome inválido/ausente → remove o [Nome] E a pontuação/espaço órfãos → "Oi, ..."
 *   (evita o "Oi , ..." e principalmente o "Oi <telefone>, ...").
 */
export function substituirNome(texto: string, nomeCru: string | null | undefined): string {
  const nome = primeiroNomeSaudacao(nomeCru);
  if (nome) return texto.replace(/\[Nome\]/g, nome);
  return texto
    .replace(/\s*,?\s*\[Nome\]/g, "")   // " [Nome]" / ", [Nome]"  → ""  ("Oi [Nome]," → "Oi,")
    .replace(/\[Nome\]\s*,?\s*/g, "")   // "[Nome], " no início     → ""
    .replace(/\[Nome\]/g, "");          // qualquer resto
}

/**
 * Personaliza um texto de follow-up com nome + campos do formulário (concurso/dificuldade),
 * degradando limpo quando um campo falta.
 *
 * Convenção dos textos:
 * - `[Nome]` → primeiro nome (via substituirNome).
 * - `{{ ...trecho com [concurso]/[dificuldade]... }}` = SEGMENTO OPCIONAL: é mantido (com os
 *   placeholders preenchidos) só se TODOS os campos citados nele tiverem valor; senão o segmento
 *   inteiro some. Assim "a rotina de quem quer{{ a aprovação em [concurso]}} é corrida" vira
 *   "...quem quer a aprovação em PCDF é corrida" OU, sem concurso, "...quem quer é corrida".
 *   (Delimitador `{{ }}` — não colide com o `]` dos placeholders `[campo]`.)
 */
export function substituirCampos(
  texto: string,
  campos: { nome?: string | null; concurso?: string | null; dificuldade?: string | null },
): string {
  const valores: Record<string, string> = {};
  const concurso = (campos.concurso ?? "").trim();
  const dificuldade = (campos.dificuldade ?? "").trim();
  if (concurso) valores["concurso"] = concurso;
  if (dificuldade) valores["dificuldade"] = dificuldade.charAt(0).toLowerCase() + dificuldade.slice(1);

  let out = texto.replace(/\{\{([\s\S]+?)\}\}/g, (_m, seg: string) => {
    const usados = [...seg.matchAll(/\[(concurso|dificuldade)\]/g)].map((x) => x[1]!);
    if (usados.some((k) => !valores[k])) return "";                                  // falta valor → remove o segmento
    return seg.replace(/\[(concurso|dificuldade)\]/g, (_mm, k: string) => valores[k]!);
  });

  out = substituirNome(out, campos.nome);
  // Limpa resíduos da remoção (espaço duplo, espaço antes de pontuação)
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.!?])/g, "$1").trim();
}
