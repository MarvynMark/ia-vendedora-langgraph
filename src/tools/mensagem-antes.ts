/**
 * Envio do texto de apresentação que vai ANTES de uma mídia (o parâmetro `mensagem_antes` das
 * tools de áudio/vídeo/imagem).
 *
 * Além de garantir a ordem texto -> mídia, filtra as frases que a IA JÁ disse ao lead nos últimos
 * turnos. Na conv 5525 o agente mandou "Isso é bem mais comum do que parece, e quase nunca é falta
 * de esforço" como texto normal e, no turno seguinte, repetiu a mesma frase dentro do
 * `mensagem_antes` do áudio 1. Os filtros de saída não pegavam isso porque só agem sobre o output
 * de texto, nunca sobre o que a tool envia por conta própria.
 *
 * Se TODAS as frases forem filtradas, a mídia vai sem texto de apresentação — que é o
 * comportamento desejado pelo roteiro ("NUNCA anuncie o áudio... o áudio simplesmente chega") e
 * nunca deixa o lead sem contexto, já que ele acabou de ler a mesma frase.
 */
import {
  enviarMensagem,
  pausaComDigitando,
  calcularDelayDigitando,
  registrarTextoMidia,
  registrarTextoMidiaNaoEnviado,
  saidasRecentes,
} from "../services/chatwoot.ts";
import { dividirEmFrases } from "../lib/response-formatter.ts";
import { ehRepeticaoDeAlgum } from "../lib/similaridade.ts";
import { logger } from "../lib/logger.ts";

export async function enviarMensagemAntes(
  idConta: string,
  idConversa: string,
  mensagemAntes: string | undefined,
  origem: string,
): Promise<void> {
  if (!mensagemAntes || !mensagemAntes.trim()) return;

  const frases = dividirEmFrases(mensagemAntes);
  const jaDitas = saidasRecentes(idConversa);
  const aEnviar = frases.filter(f => !ehRepeticaoDeAlgum(f, jaDitas));

  if (aEnviar.length < frases.length) {
    logger.warn(origem, "mensagem_antes: frase(s) já enviada(s) ao lead foram descartadas", {
      idConversa,
      descartadas: frases.filter(f => !aEnviar.includes(f)).map(f => f.slice(0, 120)),
    });
  }

  try {
    // Cada frase vira uma mensagem separada, com "digitando" proporcional antes de cada
    for (const frase of aEnviar) {
      await pausaComDigitando(idConta, idConversa, calcularDelayDigitando(frase));
      await enviarMensagem(idConta, idConversa, frase);
    }
    // Filtro: registra o texto INTEIRO (inclusive o descartado) — se o LLM copiar isso no output,
    // blocoDuplicaMidia ainda remove.
    registrarTextoMidiaNaoEnviado(idConversa, mensagemAntes);
    // Histórico: só o que REALMENTE foi enviado, senão gravaríamos uma mensagem fantasma.
    if (aEnviar.length > 0) {
      registrarTextoMidia(idConversa, aEnviar.join(" "));
      await pausaComDigitando(idConta, idConversa, 3000);
    }
  } catch (e) {
    logger.warn(origem, "Erro ao enviar mensagem antes da mídia:", e);
  }
}
