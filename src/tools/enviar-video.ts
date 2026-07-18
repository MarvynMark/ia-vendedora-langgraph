import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo, enviarMensagem, pausaComDigitando, calcularDelayDigitando, registrarTextoMidia } from "../services/chatwoot.ts";
import { dividirEmFrases } from "../lib/response-formatter.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { logger } from "../lib/logger.ts";

// Vídeo de apresentação da plataforma por dentro — enviado durante a VENDA (Etapa 5B, após imagem de entregáveis)
export const VIDEO_PLATAFORMA_URL = "https://s3.stkd.site/arquivosclientes/Vestigium%2Fplataforma-entregaveis-walker-falando.mp4";

// Vídeo de boas-vindas — enviado APENAS para alunos que acabaram de pagar (sequência de onboarding)
export const VIDEO_BOAS_VINDAS_URL = "https://minio.stkd.site/api/v1/buckets/arquivosclientes/objects/download?preview=true&prefix=Vestigium%2Fboas-vindas.mp4";

const conversasComVideoEnviado = new Set<string>();

interface ContextoEnviarVideo {
  idConta: string;
  idConversa: string;
}

// Envia o vídeo da plataforma para a conversa (com dedupe e fallback em link).
// Exportado para ser reutilizado tanto pela tool do LLM quanto pela guarda determinística
// do grafo principal (garante o envio mesmo quando o LLM narra o envio sem chamar a tool).
export async function enviarVideoPlataforma(idConta: string, idConversa: string, mensagemAntes?: string): Promise<string> {
  if (conversasComVideoEnviado.has(idConversa)) {
    return "Vídeo já enviado nesta conversa.";
  }
  conversasComVideoEnviado.add(idConversa);

  // Envia o texto de apresentação ANTES do vídeo (garante a ordem texto -> vídeo)
  if (mensagemAntes && mensagemAntes.trim()) {
    try {
      for (const frase of dividirEmFrases(mensagemAntes)) {
        await pausaComDigitando(idConta, idConversa, calcularDelayDigitando(frase));
        await enviarMensagem(idConta, idConversa, frase);
      }
      registrarTextoMidia(idConversa, mensagemAntes);
      await pausaComDigitando(idConta, idConversa, 3000);
    } catch (e) {
      logger.warn("tool:enviar-video", "Erro ao enviar mensagem antes do vídeo:", e);
    }
  }
  try {
    logger.info("tool:enviar-video", "Baixando vídeo de:", VIDEO_PLATAFORMA_URL);
    const res = await fetchComTimeout(VIDEO_PLATAFORMA_URL, { method: "GET", timeout: 60_000 });
    if (!res.ok) throw new Error(`Download falhou: ${res.status}`);

    const resContentType = res.headers.get("content-type") ?? "";
    if (resContentType.includes("text/html")) {
      throw new Error("URL retornou HTML — verifique se o link do Drive é público e direto.");
    }

    const buffer = await res.arrayBuffer();
    const dados = new Uint8Array(buffer);

    logger.info("tool:enviar-video", `Enviando vídeo (${dados.length} bytes)...`);
    await enviarArquivo(idConta, idConversa, dados, "apresentacao-plataforma.mp4", "video/mp4");

    // Pausa com "digitando" para o vídeo carregar antes da próxima mensagem
    await pausaComDigitando(idConta, idConversa, 5000);

    return "Vídeo enviado com sucesso.";
  } catch (e) {
    logger.error("tool:enviar-video", "Erro ao enviar vídeo:", e);
    try {
      const fallback = "O arquivo ficou pesado pra chegar por aqui. Dá uma olhada direto nesse link: https://s3.stkd.site/arquivosclientes/Vestigium%2Fplataforma-entregaveis-walker-falando.mp4";
      await enviarMensagem(idConta, idConversa, fallback);
      logger.info("tool:enviar-video", "Link fallback enviado com sucesso.");
    } catch (fallbackErr) {
      logger.error("tool:enviar-video", "Erro ao enviar fallback:", fallbackErr);
    }
    return "Não consegui enviar o vídeo, mas enviei o link alternativo diretamente para o lead. Continue a conversa normalmente.";
  }
}

export function criarToolEnviarVideo(contexto: ContextoEnviarVideo) {
  return tool(
    async ({ mensagem_antes }: { mensagem_antes?: string }) =>
      enviarVideoPlataforma(contexto.idConta, contexto.idConversa, mensagem_antes),
    {
      name: "Enviar_video_plataforma",
      description:
        "Envia o vídeo de apresentação da plataforma por dentro no WhatsApp do lead. Passe em 'mensagem_antes' a frase que apresenta o vídeo; ela é enviada como texto ANTES do vídeo, garantindo a ordem. Envie o vídeo sozinho, sem outra mídia junto.",
      schema: z.object({
        mensagem_antes: z
          .string()
          .optional()
          .describe(
            "Texto enviado ANTES do vídeo, apresentando-o. Ex: 'Gravei um vídeo mostrando como é nossa plataforma por dentro. Dá uma olhadinha, vou te mandar, confirma se conseguiu abrir.'",
          ),
      }),
    },
  );
}
