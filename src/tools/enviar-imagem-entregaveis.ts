import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo, enviarMensagem } from "../services/chatwoot.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { logger } from "../lib/logger.ts";

// Imagem com todos os entregáveis e bônus da mentoria — enviada no PASSO 1 da Mensagem 5C
export const IMAGEM_ENTREGAVEIS_URL =
  "https://minio.stkd.site/api/v1/buckets/arquivosclientes/objects/download?preview=true&prefix=Vestigium%2Flista-entregaeis.jpg";

// Texto de fallback caso o envio da imagem falhe
const FALLBACK_ENTREGAVEIS = `Além do planejamento, na prática você vai ter:

✅ Cronograma individual adaptado ao seu tempo e realidade
✅ Direcionamento diário do que estudar, revisar e quais questões resolver
✅ Acompanhamento direto com o Perito Walker pelo WhatsApp
✅ Encontros ao vivo com os mentores
✅ Relatório de desempenho mensal
✅ Simulados exclusivos

E ainda leva de bônus:

🎁 Curso de Medicina Legal e Criminalística
🎁 Cursos de Genética Forense, Balística, Toxicologia e Química
🎁 Encontros de apoio para TAF, temas de discursiva, psicotécnico e análise de edital
🎁 Noções de Direito Penal, Processual Penal e Português`;

const conversasComImagemEnviada = new Set<string>();

interface ContextoEnviarImagem {
  idConta: string;
  idConversa: string;
}

export function criarToolEnviarImagemEntregaveis(contexto: ContextoEnviarImagem) {
  return tool(
    async () => {
      if (conversasComImagemEnviada.has(contexto.idConversa)) {
        return "Imagem já enviada nesta conversa.";
      }
      conversasComImagemEnviada.add(contexto.idConversa);
      try {
        logger.info("tool:enviar-imagem-entregaveis", "Baixando imagem de:", IMAGEM_ENTREGAVEIS_URL);
        const res = await fetchComTimeout(IMAGEM_ENTREGAVEIS_URL, { method: "GET", timeout: 30_000 });
        if (!res.ok) throw new Error(`Download falhou: ${res.status}`);

        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          throw new Error("URL retornou HTML — verifique se o link do MinIO está acessível.");
        }

        const buffer = await res.arrayBuffer();
        const dados = new Uint8Array(buffer);

        logger.info("tool:enviar-imagem-entregaveis", `Enviando imagem (${dados.length} bytes)...`);
        await enviarArquivo(contexto.idConta, contexto.idConversa, dados, "entregaveis-mentoria.jpg", "image/jpeg");

        return "Imagem de entregáveis enviada com sucesso.";
      } catch (e) {
        logger.error("tool:enviar-imagem-entregaveis", "Erro ao enviar imagem — usando fallback em texto:", e);
        try {
          await enviarMensagem(contexto.idConta, contexto.idConversa, FALLBACK_ENTREGAVEIS);
          logger.info("tool:enviar-imagem-entregaveis", "Fallback em texto enviado.");
        } catch (fallbackErr) {
          logger.error("tool:enviar-imagem-entregaveis", "Erro ao enviar fallback:", fallbackErr);
        }
        return "Não consegui enviar a imagem, mas enviei os entregáveis em texto. Continue a conversa normalmente.";
      }
    },
    {
      name: "Enviar_imagem_entregaveis",
      description:
        "Envia a imagem com todos os entregáveis e bônus da mentoria diretamente no WhatsApp do lead. Use no PASSO 1 da Mensagem 5C, antes de fazer a pergunta sobre material de estudo. Não precisa de parâmetros.",
      schema: z.object({}),
    },
  );
}
