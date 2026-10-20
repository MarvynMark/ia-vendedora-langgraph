import { Elysia } from "elysia";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";
import { enviarMensagem } from "../services/chatwoot.ts";
import { anexarCadastroAluno, planilhaAlunosConfigurada } from "../services/google-sheets.ts";
import { encaminharFormularioParaCentral } from "../lib/encaminhar-central.ts";
import {
  type Respostas,
  PROMPT_MENSAGEM_DIM,
  extrairRespostas,
  montarEntradaIA,
  montarCabecalhoMensagemDim,
  nomeDoAluno,
  separarBolhas,
  whatsappDoAluno,
} from "../lib/diagnostico-inicial.ts";
import { CONVERSA_WALKER_ID } from "../lib/conversa-walker.ts";

// Body cru dos últimos envios: o formato do webhook do Respondi não é documentado, e o buffer
// geral de /webhook/logs só guarda um resumo e satura com o tráfego do Chatwoot.
const MAX_LOGS = 20;
const logsDiagnostico: Array<{ timestamp: string; resultado: string; bodyRaw: unknown }> = [];

function registrarLog(body: unknown, resultado: string) {
  logsDiagnostico.unshift({ timestamp: new Date().toISOString(), resultado, bodyRaw: body });
  if (logsDiagnostico.length > MAX_LOGS) logsDiagnostico.pop();
}

async function gerarMensagem(entrada: string): Promise<string> {
  const model = new ChatOpenAI({
    modelName: env.OPENAI_MODEL,
    openAIApiKey: env.OPENAI_API_KEY,
    temperature: 0.5,
    timeout: 60_000,
  });
  const resposta = await model.invoke([
    { role: "system", content: PROMPT_MENSAGEM_DIM },
    { role: "user", content: entrada },
  ]);
  return typeof resposta.content === "string" ? resposta.content : "";
}

async function processarDiagnostico(body: unknown, recebidoEm: Date) {
  const respostas = extrairRespostas(body);
  const saidaIA: { concurso: string | null; roteiro: string | null } = { concurso: null, roteiro: null };
  try {
    await gerarEEnviarMensagem(body, respostas, saidaIA);
  } finally {
    // Grava na planilha mesmo se a mensagem falhar: o cadastro do aluno não pode depender da IA.
    await registrarNaPlanilha(body, respostas, saidaIA, recebidoEm);
    encaminharFormularioParaCentral({ respostas, concurso: saidaIA.concurso, recebidoEm });
  }
}

async function gerarEEnviarMensagem(
  body: unknown,
  respostas: Respostas,
  saidaIA: { concurso: string | null; roteiro: string | null },
) {
  const nome = nomeDoAluno(respostas);
  if (!nome) {
    logger.warn("diagnostico", "Payload sem nome do aluno — mensagem não gerada", { perguntas: respostas.map(r => r.pergunta) });
    registrarLog(body, "sem_nome");
    return;
  }

  const { concurso, bolhas } = separarBolhas(await gerarMensagem(montarEntradaIA(respostas)));
  if (bolhas.length === 0) throw new Error("IA devolveu mensagem vazia");
  saidaIA.concurso = concurso;
  // A coluna "Roteiro de boas-vindas (IA)" da planilha guarda a mensagem inteira.
  saidaIA.roteiro = bolhas.join("\n\n");

  // Cabeçalho e depois uma mensagem por bolha, em sequência (await) para manter a ordem: o Walker
  // encaminha cada uma ao aluno como está.
  const conversationId = CONVERSA_WALKER_ID;
  await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, conversationId, montarCabecalhoMensagemDim({ nome, concurso, whatsapp: whatsappDoAluno(respostas) }));
  for (const bolha of bolhas) await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, conversationId, bolha);
  logger.info("diagnostico", "Mensagem do DIM enviada ao Walker", { nome, conversationId, bolhas: bolhas.length });
  registrarLog(body, `enviado:conversa_${conversationId}`);
}

async function registrarNaPlanilha(
  body: unknown,
  respostas: Respostas,
  saidaIA: { concurso: string | null; roteiro: string | null },
  recebidoEm: Date,
) {
  if (!planilhaAlunosConfigurada() || respostas.length === 0) return;
  try {
    await anexarCadastroAluno({ respostas, ...saidaIA, recebidoEm });
    logger.info("diagnostico", "Cadastro gravado na planilha de alunos");
    registrarLog(body, "planilha:ok");
  } catch (e) {
    logger.error("diagnostico", "Erro ao gravar na planilha de alunos:", e);
    registrarLog(body, `planilha:erro:${String(e).slice(0, 300)}`);
  }
}

export const diagnosticoRouter = new Elysia()
  .post("/webhook/diagnostico-inicial", ({ body }) => {
    registrarWebhook("/webhook/diagnostico-inicial", body, "recebido");
    registrarLog(body, "recebido");
    // Responde na hora: a IA leva alguns segundos e o Respondi pode reenviar se demorar.
    void processarDiagnostico(body, new Date()).catch(e => {
      logger.error("diagnostico", "Erro ao gerar/enviar mensagem do DIM:", e);
      registrarLog(body, `erro:${String(e).slice(0, 300)}`);
    });
    return { status: "ok" };
  })
  .get("/webhook/logs-diagnostico", () => logsDiagnostico);
