/**
 * Montagem do texto que o turno vai enviar ao lead.
 *
 * O createReactAgent devolve várias AIMessages: as que carregam tool_calls e a final (sem
 * tool_calls). Quando a tool é de MÍDIA, ela já mandou texto ao lead por conta própria (o
 * parâmetro `mensagem_antes`) — e o LLM, contrariando o prompt, costuma repetir esse mesmo texto
 * no `content` da mesma mensagem. Concatenar tudo era o que duplicava a reação da Mensagem 2
 * (conv 5385: "Acabei de ver que você é formado em Medicina..." saiu pela tool e
 * "Vi que você é formado em Medicina..." saiu de novo no output).
 *
 * Descartar o preâmbulo AQUI (e não em mais um filtro na saída de texto) corrige de uma vez os
 * três consumidores do output: o envio de texto, a rota de áudio TTS (que não passa por filtro
 * nenhum) e o salvarMensagem que grava o histórico dos turnos seguintes.
 */
import { dividirEmFrases } from "../../lib/response-formatter.ts";
import { ehRepeticao } from "../../lib/similaridade.ts";

/**
 * Tools que JÁ enviam texto ao lead sozinhas (parâmetro `mensagem_antes`).
 * As demais (Refletir, Escalar_humano, Atualizar_tarefa, Reagir_mensagem, Buscar_contexto_similar)
 * não mandam nada — o `content` que as acompanha é a única fala do turno e precisa ser mantido.
 */
export const TOOLS_QUE_ENVIAM_TEXTO_AO_LEAD = new Set([
  "Enviar_audio_walker_1",
  "Enviar_audio_walker_2",
  "Enviar_video_plataforma",
  "Enviar_imagem_entregaveis",
]);

interface MsgLike {
  _getType: () => string;
  content: unknown;
  tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }>;
}

export interface OutputDoTurno {
  /** Texto a enviar ao lead. */
  output: string;
  /** Preâmbulos descartados (para log e para a guarda de mídia determinística). */
  preambulosDescartados: string[];
  /** `mensagem_antes` de todas as tools de mídia chamadas no turno. */
  mensagensAntes: string[];
}

export function montarOutputDoTurno(newMsgs: MsgLike[]): OutputDoTurno {
  const mantidos: string[] = [];
  const preambulos: Array<{ texto: string; antes: string }> = [];
  const mensagensAntes: string[] = [];

  for (const m of newMsgs) {
    if (m._getType() !== "ai") continue;
    const texto = typeof m.content === "string" ? m.content.trim() : "";
    const tcs = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    const midia = tcs.filter(tc => tc.name && TOOLS_QUE_ENVIAM_TEXTO_AO_LEAD.has(tc.name));

    const antesDestaMsg = midia
      .map(tc => tc.args?.["mensagem_antes"])
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map(a => a.trim());
    mensagensAntes.push(...antesDestaMsg);

    if (!texto) continue;
    if (midia.length > 0) {
      // Preâmbulo de tool de mídia: o texto pro lead já saiu (ou vai sair) via mensagem_antes.
      preambulos.push({ texto, antes: antesDestaMsg.join(" ") });
      continue;
    }
    mantidos.push(texto);
  }

  let output = mantidos.join("\n\n");

  // Salvaguarda: o LLM pôs tudo no preâmbulo e devolveu a mensagem final vazia. Não deixar o lead
  // sem a pergunta de fechamento — recupera do preâmbulo só o que NÃO duplica o mensagem_antes.
  // Se sobrar nada, silêncio é o correto: a mídia e a reação já chegaram.
  if (!output && preambulos.length > 0) {
    output = preambulos
      .flatMap(p => dividirEmFrases(p.texto).filter(f => !ehRepeticao(f, p.antes)))
      .join(" ")
      .trim();
  }

  return { output, preambulosDescartados: preambulos.map(p => p.texto), mensagensAntes };
}
