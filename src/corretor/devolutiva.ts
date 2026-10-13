// Devolutiva no WhatsApp em 3 blocos (nota e veredito → espelho e erros → modelo). Numa mensagem
// só, a correção completa do GPT ficava ilegível no celular e passava do limite do WhatsApp.
import type { AvaliacaoIA, MotivoZero, PerfilConcurso, StatusEspelho } from "./tipos.ts";
import { type CalculoNota, dividirMensagem, errosValidos, formatarNumero } from "./regras.ts";

const ICONE_STATUS: Record<StatusEspelho, string> = {
  ATENDIDO: "✅ ATENDIDO",
  PARCIAL: "🟡 PARCIAL",
  NAO_ATENDIDO: "❌ NÃO ATENDIDO",
  INCORRETO: "⛔ INCORRETO",
};

function motivoZero(motivo: MotivoZero, perfil: PerfilConcurso, tl: number): string {
  switch (motivo) {
    case "sem_texto": return "não há texto para avaliar";
    case "menos_linhas": return `a resposta tem ${tl} linha(s), abaixo do mínimo de ${perfil.linhasMin}`;
    case "fuga_tema": return "fuga ao tema";
    case "identificacao": return "identificação em local indevido";
  }
}

function lista(itens: string[], numerada = false): string {
  return itens.filter((i) => i.trim()).map((i, n) => `${numerada ? `${n + 1}.` : "•"} ${i.trim()}`).join("\n");
}

export interface MetaDevolutiva {
  linhasEstimadas: boolean;
  codigoQuestao: string | null;
}

export function montarDevolutiva(
  perfil: PerfilConcurso,
  avaliacao: AvaliacaoIA,
  calculo: CalculoNota,
  meta: MetaDevolutiva,
): string[] {
  const { dq, ne, tl, nq, zero } = calculo;
  const titulo = `📝 *CORREÇÃO ${perfil.nome.toUpperCase()} (${perfil.banca})*${meta.codigoQuestao ? ` — questão ${meta.codigoQuestao}` : ""}`;

  // ── 1. Nota, conta e veredito ──
  const notasCriterios = calculo.criterios
    .map((c) => `${c.sigla} — ${c.nome}: ${formatarNumero(c.nota)} / ${formatarNumero(c.maximo)}${c.faixa ? ` (faixa ${c.faixa.codigo})` : ""}`)
    .join("\n");
  const memoria = [
    `DQ = ${calculo.criterios.map((c) => formatarNumero(c.nota)).join(" + ")} = ${formatarNumero(dq)}`,
    `NE = ${ne} | TL = ${tl}${meta.linhasEstimadas ? " (estimativa: texto digitado)" : ""}`,
    tl > 0
      ? `${perfil.formulaTexto} = ${formatarNumero(dq)} − (${ne} / ${tl}) = ${formatarNumero(calculo.nqCalculada)}`
      : perfil.formulaTexto,
  ];
  if (zero) memoria.push(`Questão zerada: ${motivoZero(zero, perfil, tl)}. NQ = 0,00`);
  else if (calculo.nqCalculada < 0) memoria.push("Resultado negativo vira zero. NQ = 0,00");

  const bloco1 = [
    titulo,
    `*NOTA ESTIMADA: ${formatarNumero(nq)} / ${formatarNumero(perfil.notaMaximaQuestao)}*\n_rubrica didática Vestigium — não é nota oficial da banca_`,
    zero ? `⚠️ Questão zerada pelo edital: ${motivoZero(zero, perfil, tl)}. As notas abaixo são só referência para você evoluir.` : "",
    notasCriterios,
    `*MEMÓRIA DE CÁLCULO*\n${memoria.join("\n")}`,
    `*O QUE SALVOU SUA RESPOSTA*\n${lista(avaliacao.pontosFortes.slice(0, 2))}`,
    `*ONDE VOCÊ MAIS PERDEU PONTOS*\n${lista(avaliacao.ondePerdeu)}`,
    `*3 PRIORIDADES PARA A PRÓXIMA*\n${lista(avaliacao.prioridades.slice(0, 3), true)}`,
    `*VEREDITO DO PROFESSOR VESTIGIUM*\n${avaliacao.veredito.trim()}`,
  ].filter(Boolean).join("\n\n");

  // ── 2. Espelho, justificativas, erros e linhas ──
  const comentario = (c: string) => (c.trim() ? `\n   ${c.trim()}` : "");
  const exigidos = avaliacao.espelho.filter((e) => e.origem !== "APROFUNDAMENTO")
    .map((e, i) => `${i + 1}. ${e.elemento.trim()} — ${ICONE_STATUS[e.status] ?? e.status}${comentario(e.comentario)}`)
    .join("\n");
  // Aprofundamento não desconta: aparece como "você trouxe" ou "poderia agregar". Só o INCORRETO
  // mantém o alerta, porque afirmar algo errado desconta mesmo sem ter sido pedido.
  const aprofundamentos = avaliacao.espelho.filter((e) => e.origem === "APROFUNDAMENTO")
    .map((e) => {
      const marca = e.status === "INCORRETO" ? ICONE_STATUS.INCORRETO
        : e.status === "ATENDIDO" ? "➕ você trouxe"
        : e.status === "PARCIAL" ? "➕ você trouxe em parte" : "💡 poderia agregar";
      return `• ${e.elemento.trim()} — ${marca}${comentario(e.comentario)}`;
    })
    .join("\n");
  const justificativas = calculo.criterios
    .map((c) => {
      const faixa = c.faixa ? ` (faixa ${c.faixa.codigo}: ${c.faixa.descritor})` : "";
      const ajuste = c.faixaAjustada ? "\n⚙️ Faixa definida pela contagem do espelho técnico." : "";
      return `${c.sigla}${faixa}\n${avaliacao.criterios[c.sigla]?.justificativa?.trim() ?? "—"}${ajuste}`;
    })
    .join("\n\n");
  const erros = errosValidos(avaliacao, meta.linhasEstimadas ? Number.MAX_SAFE_INTEGER : perfil.linhasMax);
  const listaErros = erros.length
    ? erros.map((e, i) => `${i + 1}. Linha ${e.linha}: "${e.trecho.trim()}" → "${e.correcao.trim()}" (${e.tipo.trim()})\n   ${e.explicacao.trim()}`).join("\n")
    : "Nenhum erro efetivo encontrado.";
  const linhas = [
    meta.linhasEstimadas
      ? `TL = ${tl} — estimativa, não contagem: texto digitado, calculado com ~${perfil.caracteresPorLinha} caracteres por linha manuscrita. Por ser estimativa, a extensão não altera a sua nota.`
      : `TL = ${tl}`,
    calculo.linhasDescartadas
      ? `⚠️ ${calculo.linhasDescartadas} linha(s) depois da ${perfil.linhasMax}ª foram desconsideradas, como no edital.`
      : "",
    calculo.excedenteEstimado
      ? `⚠️ Pela estimativa, seu texto ficaria com cerca de ${perfil.linhasMax + calculo.excedenteEstimado} linhas na folha. Confira escrevendo à mão: na prova, o que passar da ${perfil.linhasMax}ª linha é desconsiderado.`
      : "",
    calculo.curtoEstimado
      ? `⚠️ Pela estimativa, seu texto ficaria com menos de ${perfil.linhasMin} linhas na folha. Confira escrevendo à mão: na prova, menos de ${perfil.linhasMin} linhas zera a questão.`
      : "",
  ].filter(Boolean).join("\n");

  const bloco2 = [
    `*O QUE A QUESTÃO EXIGIA*\n${avaliacao.oQueAQuestaoExigia.trim()}`,
    `*ESPELHO TÉCNICO — EXIGIDO PELO COMANDO*\n${exigidos}`,
    aprofundamentos ? `*APROFUNDAMENTOS (valorizam; a ausência não desconta)*\n${aprofundamentos}` : "",
    `*JUSTIFICATIVA DA NOTA*\n${justificativas}`,
    `*ERROS DE PORTUGUÊS (NE = ${ne})*\n${listaErros}`,
    `*TOTAL DE LINHAS*\n${linhas}`,
  ].filter(Boolean).join("\n\n");

  // ── 3. Modelo ──
  const bloco3 = [
    `*ESPELHO IDEAL*\n${lista(avaliacao.espelhoIdeal)}`,
    `*RESPOSTA-MODELO (${perfil.linhasMin} a ${perfil.linhasMax} linhas)*\n${avaliacao.respostaModelo.trim()}`,
    `_${perfil.aviso}_`,
  ].join("\n\n");

  return [bloco1, bloco2, bloco3].flatMap((b) => dividirMensagem(b));
}
