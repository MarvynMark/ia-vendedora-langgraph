import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { comRetry } from "../lib/retry.ts";
import { logger } from "../lib/logger.ts";
import { TEMPLATE_META } from "../lib/templates.ts";

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
  // toggle_status fecha a conversa se já estiver aberta — verificar antes de chamar
  const conv = await buscarConversa(accountId, conversationId) as { status?: string };
  if (conv.status === "open") {
    logger.info("chatwoot", "reabrirConversa: conversa já está aberta, ignorando toggle", { conversationId });
    return;
  }
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

// Atualiza campos gerais do contato (name/phone/email/custom_attributes). Diferente de
// atualizarContato (que só mexe em custom_attributes), o objeto vai cru no PATCH — usado pelo fluxo
// de formulário para corrigir o nome de um contato pré-existente que ficou com o telefone como nome.
export async function atualizarContatoDados(
  accountId: string | number,
  contactId: string | number,
  dados: { name?: string; phone_number?: string; email?: string; custom_attributes?: Record<string, unknown> },
) {
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/contacts/${contactId}`,
    { method: "PATCH", headers: headers(), body: JSON.stringify(dados) },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[chatwoot] atualizarContatoDados falhou (${res.status}): ${text}`);
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

// Registro (por conversa) dos textos enviados como "apresentação de mídia" (o mensagem_antes
// dos áudios). O LLM às vezes repete esse mesmo texto no output final, gerando duplicação.
// Guardamos o que já foi enviado para filtrar blocos duplicados no envio de texto.
const textosMidiaPorConversa = new Map<string, string[]>();
function normalizarTextoMidia(s: string): string {
  return (s ?? "").toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, " ").trim();
}
export function registrarTextoMidia(idConversa: string | number, texto: string): void {
  const t = normalizarTextoMidia(texto);
  if (!t) return;
  const chave = String(idConversa);
  const arr = textosMidiaPorConversa.get(chave) ?? [];
  arr.push(t);
  textosMidiaPorConversa.set(chave, arr);
}
export function limparTextosMidia(idConversa: string | number): void {
  textosMidiaPorConversa.delete(String(idConversa));
}
// Retorna true se o bloco de texto já foi enviado como apresentação de mídia nesta conversa
// (está contido em algum mensagem_antes registrado) — ou seja, é uma duplicata a descartar.
export function blocoDuplicaMidia(idConversa: string | number, bloco: string): boolean {
  const arr = textosMidiaPorConversa.get(String(idConversa));
  if (!arr || arr.length === 0) return false;
  const b = normalizarTextoMidia(bloco);
  if (b.length < 5) return false;
  return arr.some(t => t.includes(b));
}

// Retorna true se o bloco é apenas uma NARRAÇÃO de envio de mídia ("vou te mandar o áudio",
// "vou enviar agora", "vou te mandar agora") emitida pelo LLM no output final. A tool de
// áudio/vídeo já enviou a mídia junto com o texto de apresentação (mensagem_antes), então essa
// narração vira uma bolha duplicada. Diferente de blocoDuplicaMidia, pega paráfrases que não
// batem literalmente com o mensagem_antes registrado.
// Só vale quando houve mídia apresentada neste turno (há mensagem_antes registrado) — assim NÃO
// filtra narração legítima em turnos sem mídia (ex.: "vou te passar o link de pagamento agora").
export function blocoNarraEnvioMidia(idConversa: string | number, bloco: string): boolean {
  const arr = textosMidiaPorConversa.get(String(idConversa));
  if (!arr || arr.length === 0) return false;
  const b = normalizarTextoMidia(bloco);
  if (!b) return false;
  const anunciaEnvio =
    /\bvou\b.{0,15}\b(mandar|enviar|passar|mostrar)\b/.test(b) ||
    /\bte (mando|envio|mandarei|enviarei)\b/.test(b);
  if (!anunciaEnvio) return false;
  // Confirma que é narração de MÍDIA: cita áudio/vídeo/imagem, ou é um anúncio curto e sem
  // conteúdo ("vou te mandar agora"). Num turno de mídia, esse tipo de bolha nunca carrega info nova.
  const citaMidia = /[áa]udio|v[íi]deo|imagem/.test(b);
  const soAnuncio = b.split(" ").length <= 6;
  return citaMidia || soAnuncio;
}

// Retorna true se o bloco narra ao lead uma AÇÃO INTERNA de Kanban/CRM ("vou mover a tarefa
// para Aguardando Pagamento", "vou atualizar o status na descrição", "vou mudar de etapa").
// Mover card / etapa / tarefa / status é controle interno — o lead nunca deve ver isso. O LLM
// às vezes verbaliza a instrução do Atualizar_tarefa em vez de só chamar a ferramenta. Rede de
// segurança determinística (independente do prompt).
export function blocoNarraAcaoInterna(bloco: string): boolean {
  // Nota/resumo em 3ª pessoa sobre o lead vazada como mensagem ("Conversei com Fulana, que está
  // interessada...", "no caso dela"). "Conversei com <Nome próprio>" = a IA falando do lead para
  // terceiros. Casa a frase sem ligar pra maiúscula, mas exige que a palavra seguinte comece com
  // MAIÚSCULA (nome próprio) — distingue de "conversei com o time financeiro".
  const mConversei = bloco.match(/\bconversei com\s+(\S)/i);
  if (mConversei && /[A-ZÀ-Ú]/.test(mConversei[1]!)) return true;
  const b = normalizarTextoMidia(bloco);
  if (!b) return false;
  if (/\bno caso (dela|dele)\b/.test(b)) return true;
  const acao = /\b(mover|movendo|movi|atualiz\w+|incluir|registrar|mudar|mudando)\b/;
  const objeto = /\b(tarefa|o card|no card|do card|a etapa|de etapa|no kanban|na descri\w+|o status|status na descri\w+)\b/;
  if (acao.test(b) && objeto.test(b)) return true;
  // menção ao nome interno da etapa como destino de um movimento
  if (/\bmov\w+\b/.test(b) && /\b(aguardando pagamento|conex[ãa]o|perdido|novo lead|nutrir)\b/.test(b)) return true;
  return false;
}

// Retorna true se o bloco é (ou contém) o NOME LITERAL de uma ferramenta interna. O LLM às vezes
// escreve "Enviar_audio_walker_2" como texto em vez de chamar a tool (conversa 4154). Esses nomes
// com underscore nunca aparecem em conversa real, então basta detectá-los.
const NOMES_TOOLS = /\b(enviar_audio_walker_\d|enviar_video_plataforma|enviar_imagem_entregaveis|atualizar_tarefa|escalar_humano|reagir_mensagem|buscar_contexto_similar)\b/i;
export function blocoEhNomeDeTool(bloco: string): boolean {
  return NOMES_TOOLS.test(bloco);
}

// Retorna true se o bloco contém uma frase de despedida/robótica explicitamente BANIDA pelo
// roteiro ("boa sorte", "à disposição", "fica à vontade", "estou aqui para ajudar", "se precisar
// … me avisa", "qualquer coisa me chama"). O prompt já as proíbe, mas o LLM às vezes as usa no fim
// da conversa (sobretudo na fase de pagamento). Rede de segurança determinística que remove o bloco.
export function blocoTemFraseProibida(bloco: string): boolean {
  const b = normalizarTextoMidia(bloco);
  if (!b) return false;
  const proibidas = [
    /\bboa sorte\b/,
    // "estou/fico à disposição" — ancorado no verbo (o \b não funciona antes de "à", que não é
    // caractere \w) e evita falso-positivo com "a disposição das questões"
    /\b(estou|fico|fica|ficamos|estamos|sigo|seguimos)\s+[àa]\s+disposi[çc][ãa]o\b/,
    /\bfi(ca|que) [àa] vontade\b/, // "fica à vontade", "fique à vontade"
    // "estou aqui/por aqui (para ajudar…)" — sinal de disponibilidade passiva
    /\bestou (aqui|por aqui)\b/,
    /\bconte comigo\b/,
    // Família "se precisar/qualquer dúvida … me avisa / é só me avisar / estou aqui". Exige a
    // ABERTURA passiva + um VERBO DE OFERTA na mesma frase (as frases já vêm divididas). Assim NÃO
    // pega CTAs ativos como "me avisa quando finalizar" (sem abertura passiva) nem respostas
    // legítimas como "se precisar parcelar em mais vezes, dá pra fazer no link" (sem verbo de oferta).
    // Sem \b ao redor do ".*": em JS, "é"/"ú" não são \w, então \b antes de "é só" / depois de
    // "dúvida" falharia. A exigência de abertura passiva + verbo de oferta já evita falso-positivo.
    /\b(se precisar|se tiver (mais )?(alguma )?d[úu]vida|qualquer (coisa|d[úu]vida)).*(me avis|me cham|[ée] s[óo] (me )?(avis|cham|fal)|estou (aqui|por aqui)|conte comigo)/,
  ];
  return proibidas.some((re) => re.test(b));
}

// Calcula um tempo de "digitando" proporcional ao tamanho do texto, simulando a velocidade
// de digitação de um humano. Assim uma mensagem longa demora mais para "ser digitada" que um
// "sim" curto. Limitado entre minMs e maxMs para não ficar instantâneo nem eterno.
export function calcularDelayDigitando(texto: string, minMs = 3000, maxMs = 12000): number {
  const chars = (texto ?? "").length;
  const CHARS_POR_SEGUNDO = 12; // ritmo de digitação humana perceptível (não instantâneo)
  const ms = Math.round((chars / CHARS_POR_SEGUNDO) * 1000);
  return Math.min(Math.max(ms, minMs), maxMs);
}

// Mantém o status "digitando" visível durante TODO o intervalo `ms`, renovando a presença
// periodicamente (o WhatsApp expira o status após ~10s). NÃO desliga no fim: o "digitando"
// some sozinho quando a próxima mensagem/mídia é enviada. Serve como intervalo natural entre
// mensagens e para dar tempo de uma mídia (áudio/vídeo/imagem) carregar antes da próxima.
export async function pausaComDigitando(
  accountId: string | number,
  conversationId: string | number,
  ms = 5000,
) {
  let restante = ms;
  const intervalo = 4000; // renova o "digitando" antes de expirar
  while (restante > 0) {
    try {
      await atualizarPresenca(accountId, conversationId, true);
    } catch { /* se a presença falhar, ainda respeita o delay */ }
    const espera = Math.min(restante, intervalo);
    await new Promise(r => setTimeout(r, espera));
    restante -= espera;
  }
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
  processedParams?: Record<string, string>,
) {
  // Idioma e cabeçalho de mídia vêm do mapa TEMPLATE_META (default: pt_BR, sem mídia).
  const meta = TEMPLATE_META[templateName];
  const language = meta?.language ?? "pt_BR";
  const bodyParams = processedParams ?? {};
  // Sem mídia: params do corpo na raiz ({ "1": "João" }). Com cabeçalho de mídia, o Chatwoot
  // exige o formato estruturado { body: {...}, header: { media_url, media_type } }.
  const processedParamsFinal = meta?.mediaUrl
    ? { body: bodyParams, header: { media_url: meta.mediaUrl, media_type: meta.mediaType ?? "image" } }
    : bodyParams;

  const payload = {
    message_type: "outgoing",
    content_type: "text",
    content: conteudo ?? " ",
    template_params: {
      name: templateName,
      category: "MARKETING",
      language,
      // Variáveis do corpo do template Meta (posicionais): { "1": "João" } → {{1}}
      processed_params: processedParamsFinal,
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

// Palavras do gatilho de "grupo de espera" (mensagem inicial de anúncio, NÃO uma resposta real).
const GRUPO_ESPERA_KEYWORDS_MSG = ["grupo de espera", "grupo de espero", "acesso ao grupo", "entrar no grupo"];

export async function contarMensagensIncoming(
  accountId: string | number,
  conversationId: string | number,
  opts?: { ignorarGrupoEspera?: boolean },
): Promise<number> {
  const data = await listarMensagens(accountId, conversationId) as {
    payload?: Array<{ message_type: number; content?: string | null; content_attributes?: { deleted?: boolean } }>;
  };
  const msgs = data.payload ?? [];
  return msgs.filter(m => {
    if (m.message_type !== 0) return false;
    // Ignora mensagens excluídas (soft-delete do Chatwoot).
    if (m.content_attributes?.deleted === true) return false;
    // Ignora o "quero acesso ao grupo de espera": é o gatilho do anúncio, não resposta do lead.
    // Sem isso, TODO lead de anúncio conta como "já respondeu" e a sequência de follow-up nunca dispara.
    if (opts?.ignorarGrupoEspera) {
      const c = (m.content ?? "").toLowerCase();
      if (GRUPO_ESPERA_KEYWORDS_MSG.some(k => c.includes(k))) return false;
    }
    return true;
  }).length;
}

// Retorna true se a última mensagem real da conversa foi do lead (type 0)
// Ignora mensagens de atividade (type 2). Usado para detectar se o lead
// respondeu APÓS a última mensagem do agente — caso contrário o follow-up deve ser enviado.
export async function verificarLeadRespondeuUltimo(
  accountId: string | number,
  conversationId: string | number,
): Promise<boolean> {
  const data = await listarMensagens(accountId, conversationId) as { payload?: Array<{ message_type: number; created_at: number }> };
  const msgs = (data.payload ?? []).filter(m => m.message_type === 0 || m.message_type === 1);
  if (msgs.length === 0) return false;
  const ultima = msgs.sort((a, b) => b.created_at - a.created_at)[0]!;
  return ultima.message_type === 0;
}

// Conteúdo da última mensagem ENVIADA pelo agente (outgoing, type 1) na conversa.
// Usado para evitar reenviar um follow-up idêntico ao último (ex.: template de fallback
// repetido em posições consecutivas fora da janela de 24h). Retorna "" se não houver.
export async function ultimaMensagemAgente(
  accountId: string | number,
  conversationId: string | number,
): Promise<string> {
  try {
    const data = await listarMensagens(accountId, conversationId) as {
      payload?: Array<{ message_type: number; content?: string | null; created_at: number }>;
    };
    const outs = (data.payload ?? []).filter(m => m.message_type === 1 && (m.content ?? "").trim() !== "");
    if (outs.length === 0) return "";
    return outs.sort((a, b) => b.created_at - a.created_at)[0]!.content ?? "";
  } catch (e) {
    logger.warn("chatwoot", "ultimaMensagemAgente erro:", e);
    return "";
  }
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

// Quanto tempo (ms) ainda resta da janela grátis de 24h, a partir da última mensagem
// do lead. Retorna <= 0 se a janela já fechou ou o lead nunca escreveu (envio exige
// template pago). Usado para "espremer" follow-ups pra dentro da janela e economizar
// envios pagos à Meta.
export async function msRestantesJanela24h(
  accountId: string | number,
  conversationId: string | number,
): Promise<number> {
  try {
    const data = await listarMensagens(accountId, conversationId) as {
      payload?: Array<{ message_type: number; created_at: number }>;
    };
    const incomings = (data.payload ?? []).filter(m => m.message_type === 0);
    if (incomings.length === 0) return 0;
    const ultima = incomings.sort((a, b) => b.created_at - a.created_at)[0]!;
    const fechamentoMs = (ultima.created_at + 24 * 60 * 60) * 1000;
    return fechamentoMs - Date.now();
  } catch (e) {
    logger.warn("chatwoot", "msRestantesJanela24h erro:", e);
    return 0;
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

// Resolve o source_id (wa_id) de um contato numa inbox de WhatsApp a partir dos contact_inboxes
// já existentes. Um mesmo contato pode ter VÁRIOS contact_inboxes na mesma inbox (ex: um wa_id
// numérico real "5562981384100" e um gerado "BR.xxxx"); preferimos o puramente numérico, que é
// o único que o Chatwoot aceita ao criar conversa em inbox WhatsApp sem ambiguidade.
export async function buscarSourceIdWhatsapp(
  accountId: string | number,
  contactId: number,
  inboxId: number,
): Promise<string | null> {
  try {
    const res = await fetchComTimeout(
      `${urlConta(accountId)}/contacts/${contactId}`,
      { method: "GET", headers: headers() },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      payload?: { contact_inboxes?: Array<{ source_id?: string; inbox?: { id?: number } }> };
    };
    const vinculos = (data.payload?.contact_inboxes ?? []).filter(
      ci => ci.inbox?.id === Number(inboxId) && ci.source_id,
    );
    // Prefere o source_id puramente numérico (wa_id real)
    const numerico = vinculos.find(ci => /^\d{1,20}(-\d{1,20})?$/.test(ci.source_id!));
    return numerico?.source_id ?? vinculos[0]?.source_id ?? null;
  } catch (e) {
    logger.warn("source-id-whatsapp", `Erro ao resolver source_id do contato ${contactId}:`, e);
    return null;
  }
}

export async function vincularContatoInbox(
  accountId: string | number,
  contactId: number,
  inboxId: number,
  sourceId?: string,
): Promise<void> {
  logger.debug("vincular-inbox", `Vinculando contato ${contactId} ao inbox ${inboxId} (account ${accountId})...`);
  const body: Record<string, unknown> = { inbox_id: inboxId };
  if (sourceId) body.source_id = sourceId;
  const res = await fetchComTimeout(
    `${urlConta(accountId)}/contacts/${contactId}/contact_inboxes`,
    { method: "POST", headers: headers(), body: JSON.stringify(body) },
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
  dados: { inbox_id: number; contact_id: number; source_id?: string },
): Promise<{ id: number }> {
  logger.debug("criar-conversa", `Criando conversa: contact_id=${dados.contact_id} inbox_id=${dados.inbox_id} account=${accountId}`);

  // Resolve o source_id: usa o fornecido ou busca o wa_id válido dos vínculos existentes.
  // Inboxes WhatsApp exigem source_id numérico válido ao criar conversa — sem ele, o Chatwoot
  // rejeita com 422 quando o contato tem vínculos ambíguos.
  let sourceId = dados.source_id;
  if (!sourceId) {
    sourceId = (await buscarSourceIdWhatsapp(accountId, dados.contact_id, dados.inbox_id)) ?? undefined;
  }

  // Para inboxes WhatsApp o contato precisa estar vinculado antes (com o source_id quando disponível)
  await vincularContatoInbox(accountId, dados.contact_id, dados.inbox_id, sourceId);

  const body = JSON.stringify({
    inbox_id: dados.inbox_id,
    contact_id: dados.contact_id,
    ...(sourceId ? { source_id: sourceId } : {}),
  });
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
