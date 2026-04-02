import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo } from "../services/chatwoot.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { logger } from "../lib/logger.ts";

export const VIDEO_PLATAFORMA_URL = "https://minio.stkd.site/api/v1/buckets/arquivosclientes/objects/download?preview=true&prefix=Vestigium%2Fmentoria-mentoria-por-dentro_.mp4";

interface ContextoEnviarVideo {
  idConta: string;
  idConversa: string;
}

export function criarToolEnviarVideo(contexto: ContextoEnviarVideo) {
  return tool(
    async () => {
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
        await enviarArquivo(contexto.idConta, contexto.idConversa, dados, "apresentacao-plataforma.mp4", "video/mp4");

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
