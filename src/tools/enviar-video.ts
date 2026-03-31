import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo } from "../services/chatwoot.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

interface ContextoEnviarVideo {
  idConta: string;
  idConversa: string;
}

export function criarToolEnviarVideo(contexto: ContextoEnviarVideo) {
  return tool(
    async () => {
      const url = env.VIDEO_PLATAFORMA_URL;
      if (!url) {
        logger.warn("tool:enviar-video", "VIDEO_PLATAFORMA_URL não configurado");
        return "Vídeo não configurado no momento.";
      }

      try {
        logger.info("tool:enviar-video", "Baixando vídeo de:", url);
        const res = await fetchComTimeout(url, { method: "GET", timeout: 60_000 });
        if (!res.ok) {
          throw new Error(`Download falhou: ${res.status}`);
        }

        // Google Drive às vezes retorna página HTML de confirmação — detecta e aborta
        const resContentType = res.headers.get("content-type") ?? "";
        if (resContentType.includes("text/html")) {
          throw new Error("URL retornou HTML em vez do arquivo. Verifique se VIDEO_PLATAFORMA_URL é um link de download direto.");
        }

        const buffer = await res.arrayBuffer();
        const dados = new Uint8Array(buffer);

        // Detecta extensão e content-type pela URL
        const urlLower = url.toLowerCase();
        const isWebm = urlLower.endsWith(".webm");
        const isMov = urlLower.endsWith(".mov");
        const contentType = isWebm ? "video/webm" : isMov ? "video/quicktime" : "video/mp4";
        const extensao = isWebm ? ".webm" : isMov ? ".mov" : ".mp4";
        const nomeArquivo = `apresentacao-plataforma${extensao}`;

        logger.info("tool:enviar-video", `Enviando vídeo (${dados.length} bytes, ${contentType})...`);
        await enviarArquivo(contexto.idConta, contexto.idConversa, dados, nomeArquivo, contentType);

        return "Vídeo enviado com sucesso.";
      } catch (e) {
        logger.error("tool:enviar-video", "Erro ao enviar vídeo:", e);
        return "Não consegui enviar o vídeo agora. Continue a conversa normalmente.";
      }
    },
    {
      name: "Enviar_video_plataforma",
      description:
        "Envia o vídeo de apresentação da plataforma diretamente no WhatsApp do lead. Use imediatamente após enviar a lista de bônus (Etapa 6, Mensagem 2). Não precisa de parâmetros.",
      schema: z.object({}),
    },
  );
}
