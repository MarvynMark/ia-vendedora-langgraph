// Saudação segura com o primeiro nome do lead.
//
// Contatos criados sem nome no Chatwoot ficam com o TELEFONE/wa_id no campo "name".
// Sem tratamento, as automações (follow-up, boas-vindas, opener) mandavam saudações
// esquisitas como "Oi 5518997537716, ...". Estas funções detectam esse caso e evitam
// usar o número como nome.

// Token que é basicamente um telefone: só dígitos e símbolos de telefone (+, -, (), ., espaço).
const SO_NUMERO_RE = /^[\d+()\-.\s]+$/;

// Placeholders genéricos que o Chatwoot/Kanban usa quando o contato não tem nome real
// (ex.: título de tarefa "Conversa", contato "Contato"). Não são nomes de pessoa — se
// usados na saudação viram o esquisito "Oi Conversa, ...". Tratados como inválidos.
const PLACEHOLDERS_GENERICOS = new Set(["conversa", "contato", "cliente", "lead", "aluno", "aluna"]);

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
  if (!/\p{L}/u.test(primeiro)) return fallback;                    // sem nenhuma letra: "~", ".", emojis → evita "Oi ~."
  if (PLACEHOLDERS_GENERICOS.has(primeiro.toLowerCase())) return fallback; // "Conversa", "Contato"...
  return capitalizarNome(primeiro);                                 // "érica"→"Érica", "ADRIANO"→"Adriano"
}

// Corrige a capitalização de um primeiro nome vindo cru do formulário/Chatwoot: só age quando o
// token está todo minúsculo ("érica") ou todo maiúsculo ("ADRIANO"), preservando nomes já em caixa
// mista ("McArthur"). Evita a saudação "Oi, érica" e o gritado "Oi ADRIANO".
function capitalizarNome(token: string): string {
  const soUpper = token === token.toLocaleUpperCase("pt-BR");
  const soLower = token === token.toLocaleLowerCase("pt-BR");
  if (!soUpper && !soLower) return token;
  return token.charAt(0).toLocaleUpperCase("pt-BR") + token.slice(1).toLocaleLowerCase("pt-BR");
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
// Valores genéricos do formulário que NÃO devem ser interpolados como se fossem um concurso ou
// dificuldade específicos: o lead marcou "Todos"/"não sei". Interpolados crus geram frases como
// "a aprovação em Todos". Tratados como ausentes (o segmento opcional {{ }} some).
const CAMPO_GENERICO_RE = /^(todos?|todas?|v[aá]ri[oa]s?|qualquer( um)?|outr[oa]s?|nenhum[ao]?|ainda n[aã]o sei|n[aã]o sei|sei l[aá]|tanto faz|indecis[oa]|tudo)$/i;

// Sanitiza um campo do formulário para interpolação: vazio, genérico ou longo demais (texto livre
// colado cru, que denuncia automação) → "" (tratado como ausente pelo segmento opcional).
function campoValidoOuVazio(valor: string | null | undefined, maxLen: number): string {
  const v = (valor ?? "").trim();
  if (!v || CAMPO_GENERICO_RE.test(v) || v.length > maxLen) return "";
  return v;
}

// Separadores que denunciam uma LISTA de concursos ("PCMG, PCES, PCRJ", "PF - PCIPR - PCISC",
// "PC RJ e PC ES", "PCDF / PCGO"). O hífen exige espaços em volta pra não quebrar "PC-GO".
const SEP_LISTA_CONCURSO = /\s*(?:,|\/| e | - )\s*/i;

/**
 * Colapsa uma lista de concursos crua para o PRIMEIRO item, evitando o vazamento robótico
 * "aprovação em PCMG, PCES, PCRJ" no texto humanizado. Um concurso único ("Perito Criminal PC-GO")
 * não tem separador de lista e passa intacto. Exportado para reuso no prompt do agente principal.
 */
export function primeiroConcurso(valor: string | null | undefined): string {
  const v = (valor ?? "").trim();
  if (!v) return v;
  const partes = v.split(SEP_LISTA_CONCURSO).map((p) => p.trim()).filter(Boolean);
  return partes.length > 1 ? partes[0]! : v;
}

export function substituirCampos(
  texto: string,
  campos: { nome?: string | null; concurso?: string | null; dificuldade?: string | null },
): string {
  const valores: Record<string, string> = {};
  const concurso = campoValidoOuVazio(primeiroConcurso(campos.concurso), 40); // colapsa lista → 1º; siglas curtas
  const dificuldade = campoValidoOuVazio(campos.dificuldade, 80); // frase de dor, mas não um parágrafo
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
