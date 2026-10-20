import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { enviarMensagem } from "./chatwoot.ts";
import { buscarAplicacaoAluno } from "../db/formulario.ts";
import { CONVERSA_WALKER_ID } from "../lib/conversa-walker.ts";
import {
  PROMPT_ROTEIRO_VIDEO,
  montarEntradaVideo,
  montarMensagemRoteiroVideo,
  separarSaidaIA,
} from "../lib/roteiro-video-compra.ts";

/**
 * Gera o roteiro do vídeo de boas-vindas a partir da aplicação da mentoria e manda para o Walker.
 * Chamado pelo webhook de pagamento só em compra nova (renovação não ganha vídeo de boas-vindas).
 */
export async function enviarRoteiroVideoCompra(dados: {
  nome: string;
  plano: string;
  telefone?: string;
  email?: string;
}): Promise<void> {
  const aplicacao = await buscarAplicacaoAluno(dados.telefone, dados.email);

  const model = new ChatOpenAI({
    modelName: env.OPENAI_MODEL,
    openAIApiKey: env.OPENAI_API_KEY,
    temperature: 0.5,
    timeout: 60_000,
  });
  const resposta = await model.invoke([
    { role: "system", content: PROMPT_ROTEIRO_VIDEO },
    { role: "user", content: montarEntradaVideo({ nome: dados.nome, plano: dados.plano, aplicacao }) },
  ]);
  const { concurso, roteiro } = separarSaidaIA(typeof resposta.content === "string" ? resposta.content : "");
  if (!roteiro) throw new Error("IA devolveu roteiro de vídeo vazio");

  const mensagem = montarMensagemRoteiroVideo({
    nome: dados.nome,
    plano: dados.plano,
    concurso,
    telefone: dados.telefone,
    roteiro,
    aplicacaoEm: aplicacao?.criadoEm ?? null,
  });
  await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, CONVERSA_WALKER_ID, mensagem);
  logger.info("roteiro-video", "Roteiro de vídeo enviado ao Walker", { nome: dados.nome, comAplicacao: !!aplicacao });
}
