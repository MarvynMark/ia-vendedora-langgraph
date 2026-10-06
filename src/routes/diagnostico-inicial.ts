import { Elysia } from "elysia";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";
import { enviarMensagem } from "../services/chatwoot.ts";
import {
  PROMPT_ROTEIRO,
  extrairRespostas,
  montarEntradaIA,
  montarMensagemRoteiro,
  nomeDoAluno,
  separarSaidaIA,
  whatsappDoAluno,
} from "../lib/diagnostico-inicial.ts";

// Conversa de quem recebe o roteiro para gravar. Por ID de conversa, não por telefone: o contato
// do Gusthavo está gravado sem o nono dígito (+556281384100), a busca pelo número com 9 não acha
// ninguém e a criação de conversa nova é recusada (404). Hoje é a conversa 1770 (Gusthavo, #02
// Suporte); quando aprovar, troca no Coolify pela conversa do Walker.
const DESTINO_CONVERSA_ID = Number(process.env["DIAGNOSTICO_DESTINO_CONVERSA_ID"] ?? "1770");

// Body cru dos últimos envios: o formato do webhook do Respondi não é documentado, e o buffer
// geral de /webhook/logs só guarda um resumo e satura com o tráfego do Chatwoot.
const MAX_LOGS = 20;
const logsDiagnostico: Array<{ timestamp: string; resultado: string; bodyRaw: unknown }> = [];

function registrarLog(body: unknown, resultado: string) {
  logsDiagnostico.unshift({ timestamp: new Date().toISOString(), resultado, bodyRaw: body });
  if (logsDiagnostico.length > MAX_LOGS) logsDiagnostico.pop();
}

async function gerarRoteiro(entrada: string): Promise<string> {
  const model = new ChatOpenAI({
    modelName: env.OPENAI_MODEL,
    openAIApiKey: env.OPENAI_API_KEY,
    temperature: 0.5,
    timeout: 60_000,
  });
  const resposta = await model.invoke([
    { role: "system", content: PROMPT_ROTEIRO },
    { role: "user", content: entrada },
  ]);
  return typeof resposta.content === "string" ? resposta.content : "";
}

async function processarDiagnostico(body: unknown) {
  const respostas = extrairRespostas(body);
  const nome = nomeDoAluno(respostas);
  if (!nome) {
    logger.warn("diagnostico", "Payload sem nome do aluno — roteiro não gerado", { perguntas: respostas.map(r => r.pergunta) });
    registrarLog(body, "sem_nome");
    return;
  }

  const { concurso, roteiro } = separarSaidaIA(await gerarRoteiro(montarEntradaIA(respostas)));
  if (!roteiro) throw new Error("IA devolveu roteiro vazio");

  const mensagem = montarMensagemRoteiro({ nome, concurso, whatsapp: whatsappDoAluno(respostas), roteiro });
  const conversationId = DESTINO_CONVERSA_ID;
  await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, conversationId, mensagem);
  logger.info("diagnostico", "Roteiro enviado", { nome, conversationId });
  registrarLog(body, `enviado:conversa_${conversationId}`);
}

export const diagnosticoRouter = new Elysia()
  .post("/webhook/diagnostico-inicial", ({ body }) => {
    registrarWebhook("/webhook/diagnostico-inicial", body, "recebido");
    registrarLog(body, "recebido");
    // Responde na hora: a IA leva alguns segundos e o Respondi pode reenviar se demorar.
    void processarDiagnostico(body).catch(e => {
      logger.error("diagnostico", "Erro ao gerar/enviar roteiro:", e);
      registrarLog(body, `erro:${String(e).slice(0, 300)}`);
    });
    return { status: "ok" };
  })
  .get("/webhook/logs-diagnostico", () => logsDiagnostico);
