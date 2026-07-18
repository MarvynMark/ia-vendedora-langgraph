import { Elysia } from "elysia";
import { z } from "zod";
import type { ChatwootWebhookPayload } from "../types/chatwoot.ts";
import { processarMensagem } from "../lib/message-processor.ts";
import { criarGrafoAgenteClinica } from "../graphs/main-agent/graph.ts";
import { limparFila } from "../db/fila.ts";
import { limparLock, liberarLock } from "../db/lock.ts";
import { estaEncerrando, rastrear } from "../lib/processamentos-ativos.ts";
import { limparHistorico } from "../db/memoria.ts";
import { buscarDadosFormulario } from "../db/formulario.ts";
import { pool } from "../db/pool.ts";
import {
  adicionarEtiquetas,
  buscarConversa,
  enviarMensagem,
  listarMensagens,
  atualizarContato,
  atualizarAtributosConversa,
  removerEtiquetas,
} from "../services/chatwoot.ts";
import { agendarIntroPendente } from "../lib/intro-pendente.ts";
import { logger } from "../lib/logger.ts";
import { env } from "../config/env.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";

const GRUPO_ESPERA_KEYWORDS = ["grupo de espera", "grupo de espero", "acesso ao grupo", "entrar no grupo"];

// Deduplicação: evita processar a mesma mensagem duas vezes (Chatwoot dispara message_created + message_incoming)
const mensagensProcessadas = new Set<string>();
function jaProcessou(idMensagem: string): boolean {
  if (mensagensProcessadas.has(idMensagem)) return true;
  mensagensProcessadas.add(idMensagem);
  // Limpa após 5 minutos para não crescer indefinidamente
  setTimeout(() => mensagensProcessadas.delete(idMensagem), 5 * 60 * 1000);
  return false;
}


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
  .post("/webhook/chatwoot", async ({ body, set }) => {
    // Desligamento gracioso em andamento: recusa novos turnos para não morrer no meio.
    // A rede de segurança no boot reprocessa o que ficar sem resposta após o restart.
    if (estaEncerrando()) {
      set.status = 503;
      logger.warn("webhook", "Recusando webhook: desligamento em andamento");
      return { status: "unavailable", reason: "shutting_down" };
    }
    logger.info("webhook", ">>> Webhook recebido", {
      message_type: (body as Record<string, unknown>).message_type,
      content: (body as Record<string, unknown>).content,
      event: (body as Record<string, unknown>).event,
      sender: ((body as Record<string, unknown>).sender as Record<string, unknown>)?.name,
    });

    // Registrar chegada do webhook para debug
    const event = (body as Record<string, unknown>).event;
    registrarWebhook("/webhook/chatwoot", body, event !== "message_created" ? `ignored:${event}` : "processing");

    // Só processar evento message_created (evita duplicatas de message_incoming/message_updated)
    if (event !== "message_created") {
      logger.info("webhook", "Ignorado: event =", event);
      return { status: "ignored", reason: "not_message_created" };
    }

    // Deduplicação pelo ID da mensagem
    const idMensagemRaw = String((body as Record<string, unknown>).id ?? "");
    if (idMensagemRaw && jaProcessou(idMensagemRaw)) {
      logger.info("webhook", "Ignorado: mensagem duplicada id =", idMensagemRaw);
      return { status: "ignored", reason: "duplicate" };
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

    // Ignorar mensagens enviadas pelo bot/agente:
    // Chatwoot dispara message_created com message_type:0 para mensagens do bot também.
    // O sender do contato tem id == contact_inbox.contact_id.
    // O sender do agente/bot tem id diferente do contact_id.
    const senderId = parsed.data.sender.id;
    const contactId = payload.conversation?.contact_inbox?.contact_id;
    if (contactId !== undefined && senderId !== contactId) {
      logger.info("webhook", "Ignorado: sender não é o contato da conversa (mensagem do bot/agente)");
      return { status: "ignored", reason: "agent_message" };
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

      // Verificar se o link já foi enviado nessa conversa nos últimos 10 minutos — funciona cross-process (não usa Map in-memory)
      const msgsChatwoot = await listarMensagens(idConta, idConversa) as {
        payload?: Array<{ message_type: number; content?: string | null; created_at?: number }>;
      };
      const agora = Date.now() / 1000;
      const linkJaEnviado = (msgsChatwoot.payload ?? []).some(
        m => m.message_type !== 0
          && (m.content ?? "").includes("grupo de espera")
          && (m.created_at === undefined || agora - m.created_at < 600)
      );
      if (linkJaEnviado) {
        logger.info("webhook", "Link do grupo já enviado nesta conversa nos últimos 10min — ignorado");
        return { status: "ignored", reason: "grupo_espera_duplicado" };
      }

      await enviarMensagem(idConta, idConversa,
        `Clique no link abaixo para entrar no grupo de espera:\n\n${env.GRUPO_ESPERA_LINK}`
      );

      // Para leads de formulário (sim OU nao): agendar intro da IA (dispara ~2min depois pelo cron).
      // A IA atende ambos os grupos — a intro inicia o roteiro do Walker. PERSISTIDA no banco
      // (não é mais setTimeout em memória, que morria em deploy/crash e deixava o lead só com o
      // link do grupo, sem apresentação — bug da conv 4413).
      if (labels.includes("nao") || labels.includes("sim")) {
        logger.info("webhook", "Lead de formulário detectado (sim/nao): agendando intro (+2min, persistida)");
        await agendarIntroPendente({
          idConta,
          idConversa,
          idContato: parsed.data.sender.id.toString(),
          idInbox: String((payload.conversation as unknown as Record<string, unknown>).inbox_id ?? env.CHATWOOT_INBOX_ID),
          telefone: parsed.data.sender.phone_number ?? "",
          nome: parsed.data.sender.name,
          labels,
        });
      }

      return { status: "ok", action: "grupo_espera" };
    }

    // Filtro de ativação: só processar conversas com "agente-on"
    if (!labels.includes("agente-on")) {
      logger.info("webhook", "Ignorado: label agente-on ausente");
      return { status: "ignored", reason: "no_agente-on" };
    }

    // (Filtro de qualificação sim/nao REMOVIDO: a IA agora atende AMBOS os grupos.
    // A ativação é controlada apenas pelo label "agente-on" acima — o humano assume
    // uma conversa removendo esse label.)

    // Modo teste: só processa conversas com "teste-agente"
    if (env.MODO_TESTE && !labels.includes("teste-agente")) {
      logger.info("webhook", "Modo teste ativo — ignorado: label teste-agente ausente");
      return { status: "ignored", reason: "modo_teste" };
    }

    // Comando /reset
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

        // Limpar checkpoint tables. O thread_id do grafo principal agora é `telefone_idMensagem`
        // (único por invocação), então cobrimos o telefone exato, os por-mensagem e o followup.
        for (const tbl of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
          try {
            await pool.query(
              `DELETE FROM ${tbl} WHERE thread_id = $1 OR thread_id LIKE $2 OR thread_id = $3`,
              [telefone, `${telefone}_%`, `followup_${telefone}`],
            );
          } catch (e) {
            logger.warn("webhook", "checkpoint cleanup:", e);
          }
        }

        try {
          await removerEtiquetas(idConta, idConversa, ["retorno"]);
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

    // Filtro: não processar se "agente-on" foi removido (humano assumiu)
    // (a ausência de agente-on já foi checada acima)

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
      // thread_id ÚNICO por mensagem: invocações concorrentes (lead dando "enter" várias vezes) no
      // mesmo thread corrompiam o estado uma da outra no checkpointer, quebrando o debounce/stale que
      // agrupa as mensagens. O histórico real vem de buscarHistorico, então o checkpoint é transitório.
      const threadIdUnico = `${dados.telefone}_${dados.idMensagem}`;
      logger.info("webhook", ">>> Invocando grafo principal", { thread_id: threadIdUnico });

      try {
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
        }, { configurable: { thread_id: threadIdUnico } });
      } finally {
        // Checkpoint do grafo é transitório — limpa o thread desta mensagem para não acumular lixo
        try {
          await pool.query("DELETE FROM checkpoints WHERE thread_id = $1", [threadIdUnico]);
          await pool.query("DELETE FROM checkpoint_blobs WHERE thread_id = $1", [threadIdUnico]);
          await pool.query("DELETE FROM checkpoint_writes WHERE thread_id = $1", [threadIdUnico]);
        } catch (e) { logger.warn("webhook", "cleanup checkpoint:", e); }
      }
      logger.info("webhook", "<<< Grafo principal concluído", { thread_id: threadIdUnico });
    }).catch(async (e) => {
      logger.error("webhook", "!!! Erro no processamento:", e);
      if (lockKeyCatch) {
        try { await liberarLock(lockKeyCatch); } catch (e) { logger.error("webhook", "liberarLock fallback erro:", e); }
      }
    });

    // Não esperar - processar em background, mas RASTREAR para o desligamento gracioso
    // conseguir aguardar este turno terminar antes de encerrar o processo.
    void rastrear(processamento);

    return { status: "accepted" };
  });
