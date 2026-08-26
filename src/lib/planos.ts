// Tabela de planos da mentoria em CÓDIGO — espelha a seção "# PRODUTOS E LINKS" do prompt
// (src/graphs/main-agent/prompt.ts). Serve às guardas determinísticas que não podem depender do
// LLM: mover o card ao apresentar o preço, travar o cardápio de planos e bloquear o preço antes
// da descoberta de material.
//
// ⚠️ Ao mudar um valor no prompt, mude aqui também — os dois têm que contar a mesma história.

export type PlanoId =
  | "anual_completo"
  | "anual"
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
}

// Ordem importa na detecção por nome: "anual completo" tem que ser testado antes de "anual",
// e os planos de médico antes dos genéricos (o rótulo "semestral" aparece nos dois).
const PLANOS: Plano[] = [
  { id: "medico_anual",     rotulo: "Médico Legista Anual",     valores: ["6.497", "641"],            nome: /m[ée]dic[oa] legista\s+anual|legista anual/i },
  { id: "medico_semestral", rotulo: "Médico Legista Semestral", valores: ["3.997", "394", "413"],     nome: /m[ée]dic[oa] legista/i },
  { id: "anual_completo",   rotulo: "Anual Completo",           valores: ["3.997", "394", "413,38"],  nome: /anual completo/i },
  { id: "anual",            rotulo: "Anual",                    valores: ["3.197", "315", "330"],     nome: /\banual\b/i },
  { id: "semestral",        rotulo: "Semestral",                valores: ["1.997", "197", "206"],     nome: /semestral/i },
  { id: "trimestral",       rotulo: "Trimestral",               valores: ["997", "98,35", "103,11"],  nome: /trimestral/i },
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
