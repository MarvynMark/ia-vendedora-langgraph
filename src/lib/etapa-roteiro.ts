// Próximo passo do roteiro de mídias, decidido pelo que DE FATO saiu (decisão do Gusthavo, 09/10/2026).
//
// Conv 9909: o lead mandou um áudio durante os 61s de "gravando" do áudio 2. O verificarNovasMsgs
// descartou o texto do turno — e com ele a oferta do vídeo —, mas o áudio e o cronograma já tinham
// saído. No turno seguinte o modelo não sabia em que ponto do roteiro estava, respondeu em texto,
// e no "E qual o valor?" foi direto ao preço: vídeo e entregáveis nunca saíram.
//
// O histórico já carrega a marca "[enviado ao lead: <mídia>]" de cada envio (ver db/midias.ts),
// então a etapa sai dele, sem consulta extra. Depois que o preço foi apresentado não há instrução:
// dali em diante é negociação, e mídia de apresentação atrapalha.

import { MARCA_MIDIA_ENVIADA } from "../services/chatwoot.ts";
import { temPrecoDePlano, temLinkDePagamento } from "./planos.ts";

const AUDIO_2 = "áudio 2 do Walker";
const VIDEO = "vídeo da plataforma";
const ENTREGAVEIS = "imagem dos entregáveis";

interface MensagemHistorico {
  type: string;
  content?: string | null;
}

export function instrucaoEtapaRoteiro(historico: MensagemHistorico[]): string {
  const falas = historico.filter((m) => m.type === "ai").map((m) => m.content ?? "");
  if (falas.some((t) => temPrecoDePlano(t) || temLinkDePagamento(t))) return "";

  const enviadas = new Set(
    falas
      .filter((t) => t.startsWith(MARCA_MIDIA_ENVIADA))
      .map((t) => t.slice(MARCA_MIDIA_ENVIADA.length).replace(/\]\s*$/, "").trim()),
  );
  if (!enviadas.has(AUDIO_2) || enviadas.has(ENTREGAVEIS)) return "";

  const proximo = enviadas.has(VIDEO)
    ? `ENTREGÁVEIS (Mensagem 6): chame Enviar_imagem_entregaveis NESTE turno (exceção: se ele acabou de contar que já teve mentoria/cursinho, pergunte antes "E o que faltou naquela?")`
    : `VÍDEO DA PLATAFORMA (Mensagem 5): chame Enviar_video_plataforma NESTE turno, sem perguntar se pode (se ele recusou o vídeo, vá para os entregáveis)`;

  return `\n\n⚠️ ETAPA DO ROTEIRO (calculada pelo que já foi enviado: ${[...enviadas].join(", ")}): o próximo passo é ${proximo}. Se o lead fez uma pergunta, responda em UMA bolha curta e siga com a mídia. Se ele perguntou o valor pela 1ª vez, segure ("Já já te passo os valores, deixa eu só te mostrar o que tá incluso") e mande a mídia; o preço vem logo depois dos entregáveis.`;
}
