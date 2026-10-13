// Histórico do aluno: progresso visível (as notas em sequência) e padrões que se repetem entre
// correções. O padrão recorrente é o que mais custa nota ao longo do tempo, então ele entra no
// prompt para virar o ponto de virada, e na devolutiva de ERROS para o aluno enxergá-lo.
import { formatarNumero } from "./regras.ts";
import type { CorrecaoSalva } from "./sessao.ts";
import type { AvaliacaoIA } from "./tipos.ts";

// Correções antigas podem ter o formato anterior (sem ponto de virada): tudo é opcional aqui.
type AvaliacaoGravada = Partial<AvaliacaoIA> & { ondePerdeu?: string[] };

function avaliacaoDe(c: CorrecaoSalva): AvaliacaoGravada {
  return (c.avaliacao ?? {}) as AvaliacaoGravada;
}

function dataCurta(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
}

export function errosPorTipo(erros: Array<{ tipo: string }> | undefined): Record<string, number> {
  const r: Record<string, number> = {};
  for (const e of erros ?? []) {
    const tipo = e.tipo.trim().toLowerCase();
    if (tipo) r[tipo] = (r[tipo] ?? 0) + 1;
  }
  return r;
}

/** Resumo das correções anteriores para a IA (mais recente primeiro). Vazio = primeira correção. */
export function historicoParaIA(anteriores: CorrecaoSalva[]): string {
  if (!anteriores.length) return "";
  return anteriores.slice(0, 3).map((c) => {
    const a = avaliacaoDe(c);
    const foco = a.pontoDeVirada?.problema ?? a.ondePerdeu?.[0] ?? "—";
    const erros = Object.entries(errosPorTipo(a.errosPortugues)).map(([t, n]) => `${t} ${n}`).join(", ") || "nenhum";
    return `- ${dataCurta(c.criadoEm)}: nota ${formatarNumero(c.nota)}${c.codigoQuestao ? ` (questão ${c.codigoQuestao})` : ""}. Ponto de virada apontado: ${foco}. Erros de língua: ${erros}.`;
  }).join("\n");
}

/** "16,10 → 18,40 → *21,35*": as notas em ordem, a atual em destaque. Null na primeira correção. */
export function linhaEvolucao(anteriores: CorrecaoSalva[], notaAtual: number): string | null {
  if (!anteriores.length) return null;
  const notas = anteriores.slice(0, 4).reverse().map((c) => formatarNumero(c.nota));
  return `${notas.join(" → ")} → *${formatarNumero(notaAtual)}*`;
}

/**
 * Tipos de erro de língua que aparecem na correção atual E em pelo menos 2 das 3 anteriores:
 * aí já não é deslize, é hábito.
 */
export function errosRecorrentes(anteriores: CorrecaoSalva[], atual: Array<{ tipo: string }>): Array<{ tipo: string; vezes: number; de: number }> {
  const recentes = anteriores.slice(0, 3);
  if (recentes.length < 2) return [];
  return Object.keys(errosPorTipo(atual))
    .map((tipo) => ({ tipo, vezes: 1 + recentes.filter((c) => (errosPorTipo(avaliacaoDe(c).errosPortugues)[tipo] ?? 0) > 0).length, de: recentes.length + 1 }))
    .filter((r) => r.vezes >= 3);
}
