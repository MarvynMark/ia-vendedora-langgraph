// Devolutiva no WhatsApp com divulgação progressiva.
//
// A versão anterior mandava 4–5 mensagens com 12 seções de uma vez: sobrecarga cognitiva, o aluno
// lia a nota e parava. Agora a mensagem principal tem UM foco (feed up / feed back / feed forward):
// o que ele já domina, o ponto de virada, o trecho dele antes → depois e um desafio de reescrita.
// O resto (espelho, erros, modelo) fica a um comando de distância, para quando ele quiser.
import type { CorrecaoSalva } from "./sessao.ts";
import type { RetornoReescrita } from "./reescrita.ts";
import type { AvaliacaoIA, MotivoZero, PerfilConcurso, StatusEspelho } from "./tipos.ts";
import { type CalculoNota, dividirMensagem, errosValidos, formatarNumero } from "./regras.ts";
import { errosRecorrentes, linhaEvolucao } from "./historico.ts";

const ICONE_STATUS: Record<StatusEspelho, string> = {
  ATENDIDO: "✅ ATENDIDO",
  PARCIAL: "🟡 PARCIAL",
  NAO_ATENDIDO: "❌ NÃO ATENDIDO",
  INCORRETO: "⛔ INCORRETO",
};

export const MENU_APROFUNDAR = "📚 *Quer ir mais fundo?* Responda:\n*DETALHES* — espelho da questão e nota de cada critério\n*ERROS* — português, com a regra de cada erro\n*MODELO* — resposta-modelo";

function motivoZero(motivo: MotivoZero, perfil: PerfilConcurso, tl: number): string {
  switch (motivo) {
    case "sem_texto": return "não há texto para avaliar";
    case "menos_linhas": return `a resposta tem ${tl} linha(s), abaixo do mínimo de ${perfil.linhasMin}`;
    case "fuga_tema": return "fuga ao tema";
    case "identificacao": return "identificação em local indevido";
  }
}

/** Trecho do aluno sem as aspas que a IA às vezes já põe (evita "“…”"). */
function semAspas(t: string): string {
  return t.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim();
}

function lista(itens: string[], numerada = false): string {
  return itens.filter((i) => i.trim()).map((i, n) => `${numerada ? `${n + 1}.` : "•"} ${i.trim()}`).join("\n");
}

export interface MetaDevolutiva {
  linhasEstimadas: boolean;
  codigoQuestao: string | null;
  autoavaliacao: number | null;
  anteriores: CorrecaoSalva[];      // correções anteriores do aluno no concurso (mais recente primeiro)
}

/**
 * A estimativa do aluno ao lado da nota: treina a metacognição (saber julgar a própria resposta é
 * o que permite revisar na prova, sem corretor).
 */
export function comentarioAutoavaliacao(estimada: number, nota: number): string {
  const dif = estimada - nota;
  const base = `Você estimou ${formatarNumero(estimada)}; a correção deu ${formatarNumero(nota)}.`;
  if (Math.abs(dif) <= 1.5) return `🎯 ${base} Boa calibragem: você está sabendo julgar a própria resposta.`;
  if (dif > 0) return `🧭 ${base} Você se avaliou acima. Costuma acontecer quando a gente confere o *tema* e não cada *item do comando* — na próxima, antes de entregar, confira item por item.`;
  return `🧭 ${base} Você se avaliou abaixo: sua resposta está melhor do que você acha.`;
}

/** Mensagem principal: nota + UM foco + prática. */
export function mensagemPrincipal(perfil: PerfilConcurso, a: AvaliacaoIA, c: CalculoNota, meta: MetaDevolutiva): string[] {
  const notas = c.criterios.map((x) => `${x.sigla} ${formatarNumero(x.nota)}${x.faixa ? ` (${x.faixa.codigo})` : ""}`).join(" · ");
  const evolucao = linhaEvolucao(meta.anteriores, c.nq);
  const blocos = [
    `📝 *Correção — ${perfil.nome}*${meta.codigoQuestao ? ` · questão ${meta.codigoQuestao}` : ""}`,
    `*Nota estimada: ${formatarNumero(c.nq)} / ${formatarNumero(perfil.notaMaximaQuestao)}*\n${notas} · erros de português: ${c.ne}\n_rubrica didática Vestigium — não é nota oficial da banca_`,
    c.zero ? `⚠️ Pelo edital, esta questão seria zerada: ${motivoZero(c.zero, perfil, c.tl)}. O resto da correção mostra como evoluir.` : "",
    meta.autoavaliacao != null ? comentarioAutoavaliacao(meta.autoavaliacao, c.nq) : "",
    evolucao ? `📈 *Sua evolução:* ${evolucao}${a.evolucao.trim() ? `\n${a.evolucao.trim()}` : ""}` : "",
    `✅ *O que você já domina*\n${a.dominado.oQue.trim()}${a.dominado.trecho.trim() ? `\n_"${semAspas(a.dominado.trecho)}"_` : ""}`,
    `🎯 *Seu ponto de virada*\n${a.pontoDeVirada.problema.trim()}\n\n*Por que importa:* ${a.pontoDeVirada.porQueImporta.trim()}\n*Como fazer:* ${a.pontoDeVirada.comoFazer.trim()}`,
    a.antesDepois.antes.trim()
      ? `✍️ *Antes → depois*${a.antesDepois.linhas.trim() ? ` (linhas ${a.antesDepois.linhas.trim()})` : ""}\n*Antes:* _"${semAspas(a.antesDepois.antes)}"_\n*Depois:* "${semAspas(a.antesDepois.depois)}"\n${lista(a.antesDepois.oQueMudou)}`
      : "",
    `🏋️ *Seu desafio (2 minutos)*\n${a.desafio.instrucao.trim()}\n\nDigite *REESCREVER* e mande sua versão: eu confiro na hora.`,
    a.mensagemFinal.trim(),
    MENU_APROFUNDAR,
  ];
  return dividirMensagem(blocos.filter(Boolean).join("\n\n"));
}

/** DETALHES: o porquê da nota — espelho, faixas, cálculo e linhas. */
export function mensagemDetalhes(perfil: PerfilConcurso, a: AvaliacaoIA, c: CalculoNota, meta: Pick<MetaDevolutiva, "linhasEstimadas">): string[] {
  const comentario = (t: string) => (t.trim() ? `\n   ${t.trim()}` : "");
  const exigidos = a.espelho.filter((e) => e.origem !== "APROFUNDAMENTO")
    .map((e, i) => `${i + 1}. ${e.elemento.trim()} — ${ICONE_STATUS[e.status] ?? e.status}${comentario(e.comentario)}`)
    .join("\n");
  // Aprofundamento não desconta: aparece como "você trouxe" ou "poderia agregar". Só o INCORRETO
  // mantém o alerta, porque afirmar algo errado desconta mesmo sem ter sido pedido.
  const aprofundamentos = a.espelho.filter((e) => e.origem === "APROFUNDAMENTO")
    .map((e) => {
      const marca = e.status === "INCORRETO" ? ICONE_STATUS.INCORRETO
        : e.status === "ATENDIDO" ? "➕ você trouxe"
        : e.status === "PARCIAL" ? "➕ você trouxe em parte" : "💡 poderia agregar";
      return `• ${e.elemento.trim()} — ${marca}${comentario(e.comentario)}`;
    })
    .join("\n");
  const criterios = c.criterios.map((x) => {
    const faixa = x.faixa ? ` — faixa ${x.faixa.codigo}: ${x.faixa.descritor}` : "";
    const ajuste = x.faixaAjustada ? "\n⚙️ Faixa definida pela contagem do espelho técnico." : "";
    return `*${x.sigla} ${formatarNumero(x.nota)} / ${formatarNumero(x.maximo)}*${faixa}\n${a.criterios[x.sigla]?.justificativa?.trim() ?? "—"}${ajuste}`;
  }).join("\n\n");

  const memoria = [
    `DQ = ${c.criterios.map((x) => formatarNumero(x.nota)).join(" + ")} = ${formatarNumero(c.dq)}`,
    `NE = ${c.ne} | TL = ${c.tl}${meta.linhasEstimadas ? " (estimativa: texto digitado)" : ""}`,
    c.tl > 0 ? `${perfil.formulaTexto} = ${formatarNumero(c.dq)} − (${c.ne} / ${c.tl}) = ${formatarNumero(c.nqCalculada)}` : perfil.formulaTexto,
    c.zero ? `Questão zerada: ${motivoZero(c.zero, perfil, c.tl)}. NQ = 0,00` : c.nqCalculada < 0 ? "Resultado negativo vira zero. NQ = 0,00" : "",
  ].filter(Boolean).join("\n");

  const linhas = [
    meta.linhasEstimadas
      ? `TL = ${c.tl} — estimativa, não contagem: texto digitado, calculado com ~${perfil.caracteresPorLinha} caracteres por linha manuscrita. Por ser estimativa, a extensão não altera a sua nota.`
      : `TL = ${c.tl}`,
    c.linhasDescartadas ? `⚠️ ${c.linhasDescartadas} linha(s) depois da ${perfil.linhasMax}ª foram desconsideradas, como no edital.` : "",
    c.excedenteEstimado ? `⚠️ Pela estimativa, seu texto ficaria com cerca de ${perfil.linhasMax + c.excedenteEstimado} linhas na folha. Confira escrevendo à mão: na prova, o que passar da ${perfil.linhasMax}ª linha é desconsiderado.` : "",
    c.curtoEstimado ? `⚠️ Pela estimativa, seu texto ficaria com menos de ${perfil.linhasMin} linhas na folha. Confira escrevendo à mão: na prova, menos de ${perfil.linhasMin} linhas zera a questão.` : "",
  ].filter(Boolean).join("\n");

  return dividirMensagem([
    `🔎 *O que a questão exigia*\n${a.oQueAQuestaoExigia.trim()}`,
    `*Espelho — exigido pelo comando*\n${exigidos}`,
    aprofundamentos ? `*Aprofundamentos (valorizam; a ausência não desconta)*\n${aprofundamentos}` : "",
    `*Nota por critério*\n${criterios}`,
    a.outrosAjustes.length ? `*Depois do ponto de virada, ajuste também*\n${lista(a.outrosAjustes)}` : "",
    `*Memória de cálculo*\n${memoria}`,
    `*Linhas*\n${linhas}`,
  ].filter(Boolean).join("\n\n"));
}

/** ERROS: agrupados por tipo, com a regra — e o padrão, se ele se repete entre correções. */
export function mensagemErros(perfil: PerfilConcurso, a: AvaliacaoIA, meta: Pick<MetaDevolutiva, "linhasEstimadas" | "anteriores">): string[] {
  const erros = errosValidos(a, meta.linhasEstimadas ? Number.MAX_SAFE_INTEGER : perfil.linhasMax);
  if (!erros.length) return ["✍️ *Português*\nNenhum erro efetivo encontrado nesta resposta. 👏"];

  const grupos = new Map<string, typeof erros>();
  for (const e of erros) {
    const tipo = e.tipo.trim().toLowerCase() || "outros";
    grupos.set(tipo, [...(grupos.get(tipo) ?? []), e]);
  }
  const blocos = [...grupos.entries()]
    .sort((x, y) => y[1].length - x[1].length)
    .map(([tipo, doTipo]) => {
      const itens = doTipo.map((e) => `• Linha ${e.linha}: "${e.trecho.trim()}" → "${e.correcao.trim()}"`).join("\n");
      const regras = [...new Set(doTipo.map((e) => (e.regra ?? "").trim()).filter(Boolean))].map((r) => `📌 ${r}`).join("\n");
      return `*${tipo[0]!.toUpperCase()}${tipo.slice(1)} (${doTipo.length})*\n${itens}${regras ? `\n${regras}` : ""}`;
    });

  const recorrentes = errosRecorrentes(meta.anteriores, erros)
    .map((r) => `🔁 *${r.tipo}* apareceu em ${r.vezes} das suas últimas ${r.de} correções: já é hábito, não deslize. Revise essa regra antes da próxima resposta.`);

  return dividirMensagem([`✍️ *Português — ${erros.length} erro(s)*`, ...recorrentes, ...blocos].join("\n\n"));
}

/** MODELO: referência de nível — vem por último de propósito. */
export function mensagemModelo(perfil: PerfilConcurso, a: AvaliacaoIA): string[] {
  return dividirMensagem([
    `🧩 *O que uma resposta nota máxima traria*\n${lista(a.espelhoIdeal)}`,
    `📄 *Resposta-modelo (${perfil.linhasMin} a ${perfil.linhasMax} linhas)*\n${a.respostaModelo.trim()}`,
    "Use como referência de nível, não para decorar: compare com a sua e veja o que *você* mudaria.",
    `_${perfil.aviso}_`,
  ].join("\n\n"));
}

export function mensagemReescrita(r: RetornoReescrita): string {
  return [
    r.atingiu ? "✅ *Desafio cumprido!*" : "🔄 *Quase lá*",
    r.oQueMelhorou.trim() ? `*O que melhorou:* ${r.oQueMelhorou.trim()}` : "",
    r.ajuste.trim() ? `*Ajuste:* ${r.ajuste.trim()}` : "",
    r.versaoLapidada.trim() ? `*Sua versão, lapidada:*\n"${r.versaoLapidada.trim()}"` : "",
    r.atingiu
      ? "Guarde esse jeito de escrever: é ele que você leva para a prova. Quer treinar outra questão? Digite */corrigir*."
      : "Quer tentar de novo? Digite *REESCREVER* e mande a nova versão.",
  ].filter(Boolean).join("\n\n");
}
