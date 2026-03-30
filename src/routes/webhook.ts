import { Elysia } from "elysia";
import { z } from "zod";
import type { ChatwootWebhookPayload } from "../types/chatwoot.ts";
import { processarMensagem } from "../lib/message-processor.ts";
import { criarGrafoAgenteClinica } from "../graphs/main-agent/graph.ts";
import { limparFila } from "../db/fila.ts";
import { limparLock, liberarLock } from "../db/lock.ts";
import { limparHistorico } from "../db/memoria.ts";
import { buscarDadosFormulario } from "../db/formulario.ts";
import { pool } from "../db/pool.ts";
import {
  adicionarEtiquetas,
  buscarConversa,
  enviarMensagem,
  atualizarContato,
  atualizarAtributosConversa,
  removerEtiquetas,
} from "../services/chatwoot.ts";
import { logger } from "../lib/logger.ts";
import { env } from "../config/env.ts";

const GRUPO_ESPERA_KEYWORDS = ["grupo de espera", "grupo de espero", "acesso ao grupo", "entrar no grupo"];

const webhookPayloadSchema = z.object({
  message_type: z.union([z.number(), z.string()]),
  content: z.string().nullable().optional(),
  conversation: z.object({
    id: z.number(),
    labels: z.array(z.string()),
  }),
  account: z.object({
    id: z.number(),
  }),
  sender: z.object({
    id: z.number(),
    name: z.string(),
    phone_number: z.string().optional(),
  }),
});

let grafo: Awaited<ReturnType<typeof criarGrafoAgenteClinica>> | null = null;
async function obterGrafo() {
  if (!grafo) grafo = await criarGrafoAgenteClinica();
  return grafo;
}

export const webhookRouter = new Elysia()
  .post("/webhook/chatwoot", async ({ body }) => {
    logger.info("webhook", ">>> Webhook recebido", {
      message_type: (body as Record<string, unknown>).message_type,
      content: (body as Record<string, unknown>).content,
      event: (body as Record<string, unknown>).event,
      sender: ((body as Record<string, unknown>).sender as Record<string, unknown>)?.name,
    });

    // Só processar evento message_created (evita duplicatas de message_incoming/message_updated)
    const event = (body as Record<string, unknown>).event;
    if (event !== "message_created") {
      logger.info("webhook", "Ignorado: event =", event);
      return { status: "ignored", reason: "not_message_created" };
    }

    const parsed = webhookPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("webhook", "Schema parse falhou:", parsed.error.issues);
      return { status: "error", reason: "invalid_payload" };
    }
    const payload = body as ChatwootWebhookPayload;

    // Verificar se é mensagem incoming (Chatwoot sends 0 or "incoming")
    const mt = parsed.data.message_type;
    if (mt !== 0 && mt !== "incoming") {
      logger.info("webhook", "Ignorado: message_type =", mt);
      return { status: "ignored", reason: "not_incoming" };
    }

    const labels = parsed.data.conversation?.labels ?? [];
    const content = (parsed.data.content as string | null) ?? "";
    logger.info("webhook", "Mensagem incoming", {
      content: content.substring(0, 100),
      labels,
      conversation_id: parsed.data.conversation.id,
      sender: parsed.data.sender.name,
    });

    // Automação fixa: resposta do grupo de espera (funciona para qualquer conversa)
    const contentLower = content.toLowerCase();
    if (GRUPO_ESPERA_KEYWORDS.some(kw => contentLower.includes(kw))) {
      logger.info("webhook", "Pedido de grupo de espera detectado");
      const idConta = parsed.data.account.id.toString();
      const idConversa = parsed.data.conversation.id.toString();
      await enviarMensagem(idConta, idConversa,
        `Clique no link abaixo para entrar no grupo de espera:\n\n${env.GRUPO_ESPERA_LINK}`
      );
      return { status: "ok", action: "grupo_espera" };
    }

    // Filtro de ativação: só processar conversas com "agente-ativo"
    if (!labels.includes("agente-ativo")) {
      logger.info("webhook", "Ignorado: label agente-ativo ausente");
      return { status: "ignored", reason: "no_agente-ativo" };
    }

    // Comando /reset (apenas se testando-agente ativo)
    if (content.trim() === "/reset") {
      const telefone = payload.sender.phone_number ??
        payload.conversation.contact_inbox?.source_id ?? "";
      const idConta = parsed.data.account.id.toString();
      const idConversa = parsed.data.conversation.id.toString();
      const idContato = parsed.data.sender.id.toString();

      if (telefone) {
        const lockKey = `${payload.conversation.inbox_id}_${telefone}`;
        logger.info("webhook", "/reset para:", telefone);
        await limparFila(telefone);
        await limparLock(lockKey);
        await limparHistorico(telefone);

        // Limpar checkpoint tables
        const threadIds = [telefone, `followup_${telefone}`];
        for (const tid of threadIds) {
          try {
            await pool.query("DELETE FROM checkpoints WHERE thread_id = $1", [tid]);
            await pool.query("DELETE FROM checkpoint_blobs WHERE thread_id = $1", [tid]);
            await pool.query("DELETE FROM checkpoint_writes WHERE thread_id = $1", [tid]);
          } catch (e) {
            logger.warn("webhook", "checkpoint cleanup:", e);
          }
        }

        try {
          await removerEtiquetas(idConta, idConversa, ["retorno", "agente-off"]);
        } catch (e) {
          logger.error("webhook", "Erro ao remover etiquetas:", e);
        }
      }

      // Limpar atributos no Chatwoot
      await atualizarContato(idConta, idContato, {
        concurso_interesse: null,
        plano_oferecido: null,
        nivel_concurseiro: null,
      });
      await atualizarAtributosConversa(idConta, idConversa, { motivo_perda: null });
      await enviarMensagem(idConta, idConversa, "Memória resetada ✅");

      return { status: "ok", action: "reset" };
    }

    // Filtro: não processar se "agente-off" (humano assumiu)
    if (labels.includes("agente-off")) {
      logger.info("webhook", "Ignorado: label agente-off presente");
      return { status: "ignored", reason: "agente-off" };
    }

    // Processar mensagem assincronamente
    logger.info("webhook", ">>> Iniciando processamento async");
    let lockKeyCatch = "";
    const processamento = processarMensagem(payload).then(async (dados) => {
      logger.info("webhook", "processarMensagem OK", {
        telefone: dados.telefone,
        mensagemProcessada: dados.mensagemProcessada.substring(0, 100),
        idConversa: dados.idConversa,
        idInbox: dados.idInbox,
      });
      lockKeyCatch = `${dados.idInbox}_${dados.telefone}`;

      // Buscar dados da tarefa
      let tarefa: Record<string, unknown> = {};
      let funil: Record<string, unknown> = {};
      try {
        const conversa = await buscarConversa(dados.idConta, dados.idConversa) as Record<string, unknown>;
        tarefa = (conversa["kanban_task"] ?? {}) as Record<string, unknown>;
        funil = (conversa["kanban_board"] ?? {}) as Record<string, unknown>;
      } catch (e) {
        logger.error("webhook", "Erro ao buscar conversa:", e);
      }

      const dadosFormulario = await buscarDadosFormulario(dados.telefone);
      if (dadosFormulario) {
        logger.info("webhook", "Dados do formulário encontrados", { telefone: dados.telefone });
      }

      const g = await obterGrafo();
      logger.info("webhook", ">>> Invocando grafo principal", { thread_id: dados.telefone });

      await g.invoke({
        messages: [],
        idMensagem: dados.idMensagem,
        idMensagemReferenciada: dados.idMensagemReferenciada,
        idConta: dados.idConta,
        idConversa: dados.idConversa,
        idContato: dados.idContato,
        idInbox: dados.idInbox,
        telefone: dados.telefone,
        nome: dados.nome,
        mensagem: dados.mensagem,
        mensagemDeAudio: dados.mensagemDeAudio,
        timestamp: dados.timestamp,
        tipoArquivo: dados.tipoArquivo,
        idAnexo: dados.idAnexo,
        urlArquivo: dados.urlArquivo,
        etiquetas: dados.etiquetas,
        atributosContato: dados.atributosContato,
        atributosConversa: dados.atributosConversa,
        dadosFormulario,
        tarefa,
        funil,
        mensagemProcessada: dados.mensagemProcessada,
        mensagemReferenciada: null,
        mensagensAgregadas: "",
        stale: false,
        lockTentativas: 0,
        locked: false,
        erroFatal: false,
        outputAgente: "",
        novasMensagens: false,
        respostaFormatada: "",
        ssml: "",
        audioBuffer: null,
      }, { configurable: { thread_id: dados.telefone } });
      logger.info("webhook", "<<< Grafo principal concluído", { thread_id: dados.telefone });
    }).catch(async (e) => {
      logger.error("webhook", "!!! Erro no processamento:", e);
      if (lockKeyCatch) {
        try { await liberarLock(lockKeyCatch); } catch (e) { logger.error("webhook", "liberarLock fallback erro:", e); }
      }
    });

    // Não esperar - processar em background
    void processamento;

    return { status: "accepted" };
  });
