// Tabela de planos da mentoria em CÓDIGO — espelha a seção "# PRODUTOS E LINKS" do prompt
// (src/graphs/main-agent/prompt.ts). Serve às guardas determinísticas que não podem depender do
// LLM: mover o card ao apresentar o preço, travar o cardápio de planos e bloquear o preço antes
// da descoberta de material.
//
// ⚠️ Ao mudar um valor no prompt, mude aqui também — os dois têm que contar a mesma história.

export type PlanoId =
  | "anual_completo"
  | "anual"
  | "semestral_premium"
  | "semestral"
  | "trimestral"
  | "medico_semestral"
  | "medico_anual";

interface Plano {
  id: PlanoId;
  rotulo: string;
  /** Valores que identificam o plano (à vista no PIX, 12x no cartão e parcelado boleto/PIX). */
  valores: string[];
  /** Casa o NOME do plano escrito no texto — desempata valores compartilhados. */
  nome: RegExp;
  /** Caminho do link de CARTÃO (à vista no PIX ou 12x), depois de peritowalker.com.br/. */
  slug: string;
  /** Caminho do link de BOLETO/PIX PARCELADO. `null` = esse plano só tem cartão. */
  slugParcelado: string | null;
}

// Ordem importa na detecção por nome: "anual completo" tem que ser testado antes de "anual",
// e os planos de médico antes dos genéricos (o rótulo "semestral" aparece nos dois).
const PLANOS: Plano[] = [
  { id: "medico_anual",     rotulo: "Médico Legista Anual",     valores: ["6.497", "641"],            nome: /m[ée]dic[oa] legista\s+anual|legista anual/i,
    slug: "mentorialegistaanual",          slugParcelado: null },
  { id: "medico_semestral", rotulo: "Médico Legista Semestral", valores: ["3.997", "394", "413"],     nome: /m[ée]dic[oa] legista/i,
    slug: "medicolegista",                 slugParcelado: "medicolegistaparcelado" },
  { id: "anual_completo",   rotulo: "Anual Completo",           valores: ["3.997", "394", "413,38"],  nome: /anual completo/i,
    slug: "mentoriaperitoanualpremium",    slugParcelado: "mentoriaperitoanualpremiumparcelado" },
  { id: "anual",            rotulo: "Anual",                    valores: ["3.197", "315", "330"],     nome: /\banual\b/i,
    slug: "mentoriaperitoanual",           slugParcelado: "mentoriaperitoanualparcelado" },
  // Semestral Premium: 6 meses COM a Premium do Estratégia. Testado antes do Semestral puro
  // porque "premium" e "completo" precisam ganhar do rótulo genérico "semestral".
  // ⚠️ É o ÚNICO plano de Perito sem link de parcelado — ver conferirFormaDePagamento.
  { id: "semestral_premium", rotulo: "Semestral Premium",       valores: ["2.497", "246"],            nome: /semestral premium|premium semestral|perito criminal premium/i,
    slug: "mentoriaperitosemestralpremium", slugParcelado: null },
  { id: "semestral",        rotulo: "Semestral",                valores: ["1.997", "197", "206"],     nome: /semestral/i,
    slug: "mentoriaperito",                slugParcelado: "mentoriaperitoparcelado" },
  { id: "trimestral",       rotulo: "Trimestral",               valores: ["997", "98,35", "103,11"],  nome: /trimestral/i,
    slug: "mentoriaperitotrimestral",      slugParcelado: "mentoriaperitotrimestralparcelado" },
];

export const ROTULO_PLANO: Record<PlanoId, string> = Object.fromEntries(
  PLANOS.map((p) => [p.id, p.rotulo]),
) as Record<PlanoId, string>;

// Todos os valores da tabela, do mais longo pro mais curto: casar "3.997" antes de "997" evita
// que o prefixo curto roube o match do valor completo.
const TODOS_VALORES = [...new Set(PLANOS.flatMap((p) => p.valores))].sort((a, b) => b.length - a.length);

const escapar = (v: string) => v.replace(/\./g, "\\.");

// "R$ 3.997", "R$ *394*", "R$3.197", "12x de R$ 197". O lookbehind impede que "997" case dentro
// de "3.997" e que "197" case dentro de "3.197". O lookahead impede "39" casar em "394".
// Instância nova a cada uso: a flag `g` guarda lastIndex e um regex compartilhado daria
// resultados diferentes conforme a chamada anterior.
const reValor = () =>
  new RegExp(`R\\$\\s*\\*{0,2}\\s*(?<![\\d.,])(${TODOS_VALORES.map(escapar).join("|")})(?![\\d])`, "gi");

/** Há algum preço de plano no texto? Usado pelo guard de Kanban e pelo gate de material. */
export function temPrecoDePlano(texto: string): boolean {
  return reValor().test(texto ?? "");
}

// Links de checkout da seção "# PRODUTOS E LINKS" do prompt.
const RE_LINK_PAGAMENTO = /peritowalker\.com\.br\/(mentoria|medicolegista)/i;

/**
 * A resposta contém um link de checkout? O guard de Kanban precisa reconhecê-lo mesmo quando a IA
 * não escreve valor nenhum: na conv 6890 a lead voltou com "Gostaria de contratar a mentoria" e
 * recebeu só o link do Anual, sem um único R$. Quem tem o link na mão está em abandono de
 * checkout (lembrete, 20min), não em pós-preço (1h) — e é o marcador "link enviado" que separa
 * as duas cadências.
 */
export function temLinkDePagamento(texto: string): boolean {
  return RE_LINK_PAGAMENTO.test(texto ?? "");
}

/**
 * Planos cujo preço aparece no texto, na ordem em que aparecem (sem repetição).
 *
 * Anual Completo e Médico Legista Semestral compartilham os mesmos valores (R$ 3.997 / R$ 394),
 * então o valor sozinho é ambíguo: desempata pelo NOME do plano escrito perto do número, depois
 * pelo nome em qualquer lugar do texto, depois por `preferir` (o plano já ancorado no turno) e,
 * em último caso, pelo Anual Completo — a trilha de médico sempre nomeia o plano no pitch.
 */
export function planosCitados(texto: string, preferir?: PlanoId | null): PlanoId[] {
  const t = texto ?? "";
  if (!t) return [];
  const achados: PlanoId[] = [];
  for (const m of t.matchAll(reValor())) {
    const valor = m[1]!;
    const candidatos = PLANOS.filter((p) => p.valores.includes(valor));
    if (candidatos.length === 0) continue;
    let escolhido = candidatos[0]!;
    if (candidatos.length > 1) {
      // Janela de contexto antes do número ("o Anual Completo fica em 12x de R$ 394").
      const janela = t.slice(Math.max(0, (m.index ?? 0) - 140), m.index ?? 0);
      const porJanela = candidatos.find((p) => p.nome.test(janela));
      const porTexto = candidatos.find((p) => p.nome.test(t));
      const porPreferencia = preferir ? candidatos.find((p) => p.id === preferir) : undefined;
      // Último caso: o plano de Perito. A trilha de médico sempre nomeia o plano no pitch, então
      // um valor solto de R$ 3.997 / R$ 394 é muito mais provável de ser o Anual Completo.
      const padrao = candidatos.find((p) => p.id === "anual_completo") ?? candidatos[0]!;
      escolhido = porJanela ?? porTexto ?? porPreferencia ?? padrao;
    }
    if (!achados.includes(escolhido.id)) achados.push(escolhido.id);
  }
  return achados;
}

// --- Conferência da forma de pagamento (conv 7021) ---
//
// A Julia disse "não vou ter esse limite no cartão", a IA prometeu boleto/PIX parcelado e mandou
// `[Semestral Premium Parcelado](https://peritowalker.com.br/mentoriaperitosemestralpremium)` —
// que é o link do CARTÃO, rotulado como parcelado. Ela abre, não consegue pagar e some.
//
// A tabela de links já estava certa no prompt (o Semestral Premium é o único plano de Perito sem
// parcelado), mas tabela em prompt é sugestão. Aqui vira conferência determinística.

/** O texto promete parcelado/boleto/PIX parcelado, ou pagar sem depender do cartão? */
const RE_PROMESSA_PARCELADO = /parcelad|boleto|sem (depender de |precisar de )?limite|sem limite/i;

export interface ConferenciaPagamento {
  /** Texto com as URLs trocadas pela versão parcelada, quando ela existe. */
  texto: string;
  /** Trocas feitas — para log. */
  corrigidos: Array<{ plano: PlanoId; de: string; para: string }>;
  /** Planos oferecidos como parcelado que NÃO têm link de parcelado. Precisa de decisão humana. */
  semParcelado: PlanoId[];
}

/**
 * Quando a resposta promete parcelado mas carrega o link de cartão:
 * - o plano TEM link de parcelado → troca a URL (determinístico, pela tabela acima);
 * - o plano NÃO tem (Semestral Premium, Médico Legista Anual) → devolve em `semParcelado`,
 *   porque a saída certa é uma decisão comercial, não uma reescrita.
 * Sem promessa de parcelado no texto, não mexe em nada.
 */
export function conferirFormaDePagamento(texto: string): ConferenciaPagamento {
  const original = texto ?? "";
  const vazio: ConferenciaPagamento = { texto: original, corrigidos: [], semParcelado: [] };
  if (!original || !RE_PROMESSA_PARCELADO.test(original)) return vazio;

  const slugsNoTexto = [...original.matchAll(/peritowalker\.com\.br\/([a-z0-9]+)/gi)]
    .map((m) => m[1]!.toLowerCase());
  if (slugsNoTexto.length === 0) return vazio;

  let saida = original;
  const corrigidos: ConferenciaPagamento["corrigidos"] = [];
  const semParcelado: PlanoId[] = [];

  for (const slug of new Set(slugsNoTexto)) {
    // Já é um link de parcelado? Nada a fazer.
    if (PLANOS.some((p) => p.slugParcelado === slug)) continue;
    const plano = PLANOS.find((p) => p.slug === slug);
    if (!plano) continue;
    if (!plano.slugParcelado) {
      semParcelado.push(plano.id);
      continue;
    }
    // O lookahead impede que "mentoriaperito" (Semestral) case dentro de "mentoriaperitoanual".
    const re = new RegExp(`(peritowalker\\.com\\.br/)${slug}(?![a-z0-9])`, "gi");
    saida = saida.replace(re, `$1${plano.slugParcelado}`);
    corrigidos.push({ plano: plano.id, de: slug, para: plano.slugParcelado });
  }

  return { texto: saida, corrigidos, semParcelado };
}
