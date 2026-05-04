import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { comRetry } from "../lib/retry.ts";
import { logger } from "../lib/logger.ts";

const BASE_URL = env.CHATWOOT_BASE_URL;
const TOKEN = env.CHATWOOT_API_TOKEN;

function headers() {
  return {
    "Content-Type": "application/json",
    api_access_token: TOKEN,
  };
}

function urlConta(accountId: string | number = env.CHATWOOT_ACCOUNT_ID) {
  return `${BASE_URL}/api/v1/accounts/${accountId}`;
}

export async function enviarMensagem(
  accountId: string | number,
  conversationId: string | number,
  content: string,
  options: { private?: boolean; content_type?: string; is_reaction?: boolean; reply_to?: string | number } = {},
) {
  logger.info("chatwoot", "enviarMensagem", { conversationId, contentLen: content.length, private: options.private });
  return comRetry(async () => {
    const body: Record<string, unknown> = {
      content,
      message_type: "outgoing",
      ...options,
    };

    const res = await fetchComTimeout(
      `${urlConta(accountId)}/conversations/${conversationId}/messages`,
      { method: "POST", headers: headers(), body: JSON.stringify(body) },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[chatwoot] enviarMensagem falhou (${res.status}): ${text}`);
    }
    return res.json();
  }, 3, 300);
}

export async function reabrirConversa(
  accountId: string | number,
  conversationId: string | number,
) {
  logger.info("chatwoot", "reabrirConversa", { conversationId });
  return comRetry(async () => {
    const res = await fetchComTimeout(
      `${urlConta(accountId)}/conversations/${conversationId}/toggle_status`,
      { method: "POST", headers: headers(), body: JSON.stringify({ status: "open" }) },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[chatwoot] reabrirConversa falhou (${res.status}): ${text}`);
    }
    return res.json();
  }, 3, 300);
}

export async function enviarArquivo(
  accountId: string | number,
  conversationId: string | number,
  arquivo: Uint8Array,
  nomeArquivo: string,
  content_type: string = "audio/mpeg",
  options: { isRecordedAudio?: boolean; transcribedText?: string } = {},
) {
  logger.info("chatwoot", "enviarArquivo", { conversationId, nomeArquivo, content_type, size: arquivo.length });
  return comRetry(async () => {
    const form = new FormData();
    form.append("attachments[]", new Blob([arquivo], { type: content_type }), nomeArquivo);
    form.append("message_type", "outgoing");
    if (options.isRecordedAudio) {
      form.append("is_recorded_audio", "true");
    }
    if (options.transcribedText) {
      form.append("attachment_metadata", JSON.stringify({ transcribed_text: options.transcribedText }));
    }

    const res = await fetchComTimeout(
      `${urlConta(accountId)}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { api_access_token: TOKEN },
        body: form,
        timeout: 120_000,
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[chatwoot] enviarArquivo falhou (${res.status}): ${text}`);
    }
    return res.json();
  }, 3, 300);
}

async function definirEtiquetas(
  accountId: string | number,
  conversationId: string | number,
  labels: string[],
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations/${conversationId}/labels`,
    { method: "POST", headers: headers(), body: JSON.stringify({ labels }) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] definirEtiquetas falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function adicionarEtiquetas(
  accountId: string | number,
  conversationId: string | number,
  labels: string[],
) {
  const conversa = await buscarConversa(accountId, conversationId) as { labels?: string[] };
  const merged = [...new Set([...(conversa.labels ?? []), ...labels])];
  return definirEtiquetas(accountId, conversationId, merged);
}

export async function listarMensagens(
  accountId: string | number,
  conversationId: string | number,
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations/${conversationId}/messages`,
    { method: "GET", headers: headers() },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] listarMensagens falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function buscarMensagemPorId(
  accountId: string | number,
  conversationId: string | number,
  messageId: string | number,
): Promise<string | null> {
  try {
    // Try direct endpoint first (avoids fetching all messages for long conversations)
    const res = await fetchComTimeout(
      `${urlConta(accountId)}/conversations/${conversationId}/messages/${messageId}`,
      { method: "GET", headers: headers() },
    );
    if (res.ok) {
      const msg = (await res.json()) as { content?: string | null };
      return msg.content ?? null;
    }
    // Fall back to list+find if direct endpoint not available (404 or unsupported)
    const data = await listarMensagens(accountId, conversationId);
    const msgs = (data as { payload?: unknown[] }).payload ?? [];
    const msg = msgs.find((m: unknown) => (m as { id: number }).id === Number(messageId));
    return msg ? ((msg as { content: string | null }).content ?? null) : null;
  } catch (e) {
    logger.error("chatwoot", "buscarMensagemPorId erro:", e);
    return null;
  }
}

export async function buscarKanbanBoard(
  accountId: string | number,
  boardId: string | number,
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/kanban/boards/${boardId}`,
    { method: "GET", headers: headers() },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] buscarKanbanBoard falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function atualizarKanbanTask(
  accountId: string | number,
  taskId: string | number,
  dados: { board_step_id?: number; title?: string; description?: string; due_date?: string },
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/kanban/tasks/${taskId}`,
    { method: "PATCH", headers: headers(), body: JSON.stringify(dados) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] atualizarKanbanTask falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function moverKanbanTask(
  accountId: string | number,
  taskId: string | number,
  stepId: number,
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/kanban/tasks/${taskId}/move`,
    { method: "POST", headers: headers(), body: JSON.stringify({ board_step_id: stepId }) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] moverKanbanTask falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function atualizarContato(
  accountId: string | number,
  contactId: string | number,
  custom_attributes: Record<string, unknown>,
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/contacts/${contactId}`,
    { method: "PATCH", headers: headers(), body: JSON.stringify({ custom_attributes }) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] atualizarContato falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function buscarConversa(
  accountId: string | number,
  conversationId: string | number,
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations/${conversationId}`,
    { method: "GET", headers: headers() },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] buscarConversa falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function marcarComoLida(
  accountId: string | number,
  conversationId: string | number,
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations/${conversationId}/update_last_seen`,
    { method: "POST", headers: headers(), body: JSON.stringify({}) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] marcarComoLida falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function atualizarPresenca(
  accountId: string | number,
  conversationId: string | number,
  typing: boolean | "recording",
) {
  const typing_status = typing === "recording" ? "recording" : typing ? "on" : "off";
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations/${conversationId}/toggle_typing_status`,
    { method: "POST", headers: headers(), body: JSON.stringify({ typing_status }) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] atualizarPresenca falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function atualizarAtributosConversa(
  accountId: string | number,
  conversationId: string | number,
  custom_attributes: Record<string, unknown>,
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations/${conversationId}`,
    { method: "PATCH", headers: headers(), body: JSON.stringify({ custom_attributes }) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] atualizarAtributosConversa falhou (${res.status}): ${text}`);
  }
  return res.json();
}

export async function buscarContatoPorQuery(
  accountId: string | number,
  query: string,
): Promise<{ id: number; name: string; phone_number?: string; email?: string; custom_attributes?: Record<string, unknown> } | null> {
  const url = `${urlConta(accountId)}/contacts/search?q=${encodeURIComponent(query)}&include_contacts=true`;
  const res = await fetchComTimeout(url, { method: "GET", headers: headers() });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] buscarContatoPorQuery falhou (${res.status}): ${text}`);
  }

  const data = await res.json() as { payload: Array<{ id: number; name: string; phone_number?: string; email?: string; custom_attributes?: Record<string, unknown> }> };
  return data.payload?.[0] ?? null;
}

export async function buscarConversasDoContato(
  accountId: string | number,
  contactId: number,
): Promise<Array<{ id: number; inbox_id: number; kanban_task?: Record<string, unknown> }>> {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/contacts/${contactId}/conversations`,
    { method: "GET", headers: headers() },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] buscarConversasDoContato falhou (${res.status}): ${text}`);
  }

  const data = await res.json() as { payload: Array<{ id: number; inbox_id: number; kanban_task?: Record<string, unknown> }> };
  return data.payload ?? [];
}

export async function enviarTemplate(
  accountId: string | number,
  conversationId: string | number,
  templateName: string,
  conteudo?: string,
) {
  const payload = {
    message_type: "outgoing",
    content_type: "text",
    content: conteudo ?? " ",
    template_params: {
      name: templateName,
      category: "MARKETING",
      language: "pt_BR",
      processed_params: {},
    },
  };
  logger.debug("enviar-template", `Enviando template "${templateName}" para conversa ${conversationId} (account ${accountId})`);
  logger.debug("enviar-template", `POST body=${JSON.stringify(payload)}`);

  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    logger.error("enviar-template", `Falha ao enviar template: status=${res.status} body=${text}`);
    throw new Error(`[chatwoot] enviarTemplate falhou (${res.status}): ${text}`);
  }
  const result = await res.json();
  logger.debug("enviar-template", `Template enviado com sucesso: ${JSON.stringify(result)}`);
  return result;
}

export async function contarMensagensIncoming(
  accountId: string | number,
  conversationId: string | number,
): Promise<number> {
  const data = await listarMensagens(accountId, conversationId) as { payload?: Array<{ message_type: number }> };
  const msgs = data.payload ?? [];
  return msgs.filter(m => m.message_type === 0).length;
}

// Verifica se o lead enviou mensagem nas últimas 24h (janela ativa do WhatsApp)
export async function verificarJanela24h(
  accountId: string | number,
  conversationId: string | number,
): Promise<boolean> {
  try {
    const data = await listarMensagens(accountId, conversationId) as {
      payload?: Array<{ message_type: number; created_at: number }>;
    };
    const msgs = data.payload ?? [];
    const incomings = msgs.filter(m => m.message_type === 0);
    if (incomings.length === 0) return false;
    const ultima = incomings.sort((a, b) => b.created_at - a.created_at)[0]!;
    const agoraSegundos = Date.now() / 1000;
    return (agoraSegundos - ultima.created_at) < 24 * 60 * 60;
  } catch (e) {
    logger.warn("chatwoot", "verificarJanela24h erro:", e);
    return false;
  }
}

export async function criarContato(
  accountId: string | number,
  dados: { name: string; phone_number?: string; email?: string; custom_attributes?: Record<string, unknown> },
): Promise<{ id: number; name: string }> {
  logger.debug("criar-contato", `Criando contato: ${JSON.stringify(dados)} (account ${accountId})`);
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/contacts`,
    { method: "POST", headers: headers(), body: JSON.stringify(dados) },
  );

  if (!res.ok) {
    const text = await res.text();
    logger.error("criar-contato", `Falha ao criar contato: status=${res.status} body=${text}`);
    throw new Error(`[chatwoot] criarContato falhou (${res.status}): ${text}`);
  }
  const raw = await res.json();
  logger.debug("criar-contato", `Resposta criarContato: ${JSON.stringify(raw)}`);
  // API pode retornar { payload: { contact: { id, name } } } ou { id, name } direto
  const contato = (raw as { payload?: { contact?: { id: number; name: string } } }).payload?.contact ?? raw as { id: number; name: string };
  logger.debug("criar-contato", `Contato extraído: id=${contato.id} name=${contato.name}`);
  return contato;
}

export async function vincularContatoInbox(
  accountId: string | number,
  contactId: number,
  inboxId: number,
): Promise<void> {
  logger.debug("vincular-inbox", `Vinculando contato ${contactId} ao inbox ${inboxId} (account ${accountId})...`);
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/contacts/${contactId}/contact_inboxes`,
    { method: "POST", headers: headers(), body: JSON.stringify({ inbox_id: inboxId }) },
  );
  // Ignorar erro 422 (já vinculado)
  if (res.status === 422) {
    logger.debug("vincular-inbox", `Contato ${contactId} já vinculado ao inbox ${inboxId} (422 ignorado)`);
    return;
  }
  if (!res.ok) {
    const text = await res.text();
    logger.error("vincular-inbox", `Falha ao vincular contato ${contactId} ao inbox ${inboxId}: status=${res.status} body=${text}`);
    throw new Error(`[chatwoot] vincularContatoInbox falhou (${res.status}): ${text}`);
  }
  logger.debug("vincular-inbox", `Contato ${contactId} vinculado ao inbox ${inboxId} com sucesso (status ${res.status})`);
}

export async function criarConversa(
  accountId: string | number,
  dados: { inbox_id: number; contact_id: number },
): Promise<{ id: number }> {
  logger.debug("criar-conversa", `Criando conversa: contact_id=${dados.contact_id} inbox_id=${dados.inbox_id} account=${accountId}`);

  // Para inboxes WhatsApp o contato precisa estar vinculado antes
  await vincularContatoInbox(accountId, dados.contact_id, dados.inbox_id);

  const body = JSON.stringify(dados);
  logger.debug("criar-conversa", `POST /conversations body=${body}`);
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/conversations`,
    { method: "POST", headers: headers(), body },
  );

  if (!res.ok) {
    const text = await res.text();
    logger.error("criar-conversa", `Falha ao criar conversa: status=${res.status} body=${text}`);
    throw new Error(`[chatwoot] criarConversa falhou (${res.status}): ${text}`);
  }
  const result = await res.json() as { id: number };
  logger.debug("criar-conversa", `Conversa criada com sucesso: id=${result.id}`);
  return result;
}

export interface KanbanTaskResumo {
  id: number;
  board_step_id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  date_status: "overdue" | "due_soon" | null;
  conversation_ids: number[];
  conversations: Array<{
    id: number;
    display_id: number;
    status: string;
    inbox: { id: number; name: string };
    contact: { id: number; name: string };
  }>;
}

export async function listarKanbanTasks(
  accountId: string | number,
  boardId: number,
  stepId: number,
  page = 1,
): Promise<KanbanTaskResumo[]> {
  const url = `${urlConta(accountId)}/kanban/tasks?board_id=${boardId}&step_id=${stepId}&page=${page}`;
  const res = await fetchComTimeout(url, { method: "GET", headers: headers() });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] listarKanbanTasks falhou (${res.status}): ${text}`);
  }

  const data = await res.json() as { tasks: KanbanTaskResumo[]; meta: { has_more: boolean } };
  return data.tasks ?? [];
}

export async function criarKanbanTask(
  accountId: string | number,
  dados: { board_id: number; board_step_id: number; title: string; description?: string; conversation_id?: number },
): Promise<{ id: number }> {
  const { conversation_id, ...rest } = dados;
  const body = {
    ...rest,
    ...(conversation_id ? { conversation_ids: [conversation_id] } : {}),
  };
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/kanban/tasks`,
    { method: "POST", headers: headers(), body: JSON.stringify(body) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] criarKanbanTask falhou (${res.status}): ${text}`);
  }
  return res.json() as Promise<{ id: number }>;
}

export async function removerEtiquetas(
  accountId: string | number,
  conversationId: string | number,
  labelsARemover: string[],
) {
  const conversa = await buscarConversa(accountId, conversationId) as { labels?: string[] };
  const restantes = (conversa.labels ?? []).filter(l => !labelsARemover.includes(l));
  return definirEtiquetas(accountId, conversationId, restantes);
}
