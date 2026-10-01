import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarArquivo, pausaComDigitando, registrarMidiaEnviada } from "../services/chatwoot.ts";
import { enviarMensagemAntes } from "./mensagem-antes.ts";
import { buscarCamposFormulario } from "../db/formulario.ts";
import { escolherCaso } from "../lib/prova-social.ts";
import { logger } from "../lib/logger.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";

// Print de um aprovado da MESMA graduação do lead (ver lib/prova-social.ts). A escolha e a legenda
// são determinísticas: o modelo só decide o momento de chamar.

const conversasComProvaSocial = new Set<string>();

interface ContextoProvaSocial {
  idConta: string;
  idConversa: string;
  telefone: string;
}

export async function enviarProvaSocial(ctx: ContextoProvaSocial): Promise<string> {
  if (conversasComProvaSocial.has(ctx.idConversa)) return "O print de aprovado já foi enviado nesta conversa. Não envie de novo.";

  const campos = await buscarCamposFormulario(ctx.telefone);
  const caso = escolherCaso(campos?.formacao, ctx.idConversa);
  if (!caso) {
    return "Não tenho print de aprovado da graduação deste lead. Siga sem o print: use a prova social do roteiro (93% no RS) e não comente que faltou.";
  }
  conversasComProvaSocial.add(ctx.idConversa);

  try {
    // Baixa TUDO antes de mandar a legenda: se o MinIO falhar, o lead não fica com um "Olha a
    // Beatriz..." apontando pra uma imagem que nunca chega.
    const imagens: Uint8Array[] = [];
    for (const url of caso.urls) {
      const res = await fetchComTimeout(url, { method: "GET", timeout: 30_000 });
      if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
        throw new Error(`Download do print falhou: ${res.status} ${res.headers.get("content-type")} ${url}`);
      }
      imagens.push(new Uint8Array(await res.arrayBuffer()));
    }
    await enviarMensagemAntes(ctx.idConta, ctx.idConversa, caso.legenda, "tool:enviar-prova-social");
    for (const [i, dados] of imagens.entries()) {
      await enviarArquivo(ctx.idConta, ctx.idConversa, dados, `aprovado-${caso.id}-${i + 1}.jpg`, "image/jpeg");
    }
    registrarMidiaEnviada(ctx.idConversa, "print de aprovado");
    await pausaComDigitando(ctx.idConta, ctx.idConversa, 5000);
    logger.info("tool:enviar-prova-social", "Print enviado", { caso: caso.id, formacao: campos?.formacao });
    return `Print enviado com a legenda: "${caso.legenda}". NÃO repita a legenda nem descreva o print; siga com a sua próxima frase.`;
  } catch (e) {
    logger.error("tool:enviar-prova-social", "Erro ao enviar o print do aprovado:", e);
    return "Não consegui enviar o print. Siga sem ele e não comente a falha.";
  }
}

export function criarToolEnviarProvaSocial(ctx: ContextoProvaSocial) {
  return tool(async () => enviarProvaSocial(ctx), {
    name: "Enviar_prova_social",
    description:
      "Envia ao lead o print de um aluno APROVADO da mesma graduação dele, com uma legenda pronta (nome, formação e resultado). Não recebe parâmetros. Use UMA vez, no momento indicado no roteiro. Se não houver caso da graduação dele, a ferramenta avisa e você segue sem o print.",
    schema: z.object({}),
  });
}
