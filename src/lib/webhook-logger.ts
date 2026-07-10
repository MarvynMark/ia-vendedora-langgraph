// Log em memória das últimas requisições recebidas nos webhooks
// Útil para debugar se webhooks estão chegando e com quais dados

interface WebhookLogEntry {
  id: number;
  timestamp: string;
  endpoint: string;
  method: string;
  status: string;
  bodyResume: Record<string, unknown>;
  resultado: string;
}

const MAX_ENTRIES = 100;
const logs: WebhookLogEntry[] = [];
let contador = 0;

// Buffer DEDICADO para webhooks de pagamento (TMB, DMGuru). Guarda o body CRU
// completo e não é descartado pelo tráfego intenso do Chatwoot, que satura o
// buffer geral em poucos minutos. Essencial para debugar quais campos cada
// plataforma envia (ex.: qual campo carrega a "Descrição" da oferta na TMB).
interface WebhookPagamentoEntry {
  id: number;
  timestamp: string;
  endpoint: string;
  resultado: string;
  bodyKeys: string[];
  bodyRaw: unknown;
}
const MAX_PAGAMENTO = 50;
const logsPagamento: WebhookPagamentoEntry[] = [];

export function registrarWebhook(
  endpoint: string,
  body: unknown,
  resultado: string,
) {
  const entry: WebhookLogEntry = {
    id: ++contador,
    timestamp: new Date().toISOString(),
    endpoint,
    method: "POST",
    status: "recebido",
    bodyResume: resumirBody(body),
    resultado,
  };

  logs.unshift(entry); // mais recente primeiro
  if (logs.length > MAX_ENTRIES) logs.pop();

  // Além do buffer geral, persistir pagamentos num buffer próprio com o body cru.
  if (endpoint.includes("pagamento")) {
    logsPagamento.unshift({
      id: entry.id,
      timestamp: entry.timestamp,
      endpoint,
      resultado,
      bodyKeys: body && typeof body === "object" ? Object.keys(body as Record<string, unknown>) : [],
      bodyRaw: body,
    });
    if (logsPagamento.length > MAX_PAGAMENTO) logsPagamento.pop();
  }
}

export function obterLogsPagamento(limite = 50): WebhookPagamentoEntry[] {
  return logsPagamento.slice(0, limite);
}

function resumirBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return { raw: String(body).substring(0, 200) };

  const b = body as Record<string, unknown>;
  return {
    // Lista de todos os nomes de campo do topo — útil para descobrir a estrutura
    // de webhooks novos (ex.: TMB) sem precisar dos logs de runtime.
    bodyKeys: Object.keys(b),
    // Campos do Chatwoot / DMGuru
    event: b["event"],
    message_type: b["message_type"],
    content: typeof b["content"] === "string" ? b["content"].substring(0, 100) : b["content"],
    sender: (b["sender"] as Record<string, unknown>)?.["name"] ?? (b["sender"] as Record<string, unknown>)?.["phone_number"],
    conversation_id: (b["conversation"] as Record<string, unknown>)?.["id"],
    customer_name: (b["data"] as Record<string, unknown>)?.["customer"]
      ? ((b["data"] as Record<string, unknown>)["customer"] as Record<string, unknown>)?.["name"]
      : undefined,
    customer_phone: (b["data"] as Record<string, unknown>)?.["customer"]
      ? ((b["data"] as Record<string, unknown>)["customer"] as Record<string, unknown>)?.["phone_number"]
      : undefined,
    product: (b["data"] as Record<string, unknown>)?.["product"]
      ? ((b["data"] as Record<string, unknown>)["product"] as Record<string, unknown>)?.["name"]
      : undefined,
    // Campos da TMB (Webhook Vendas) — payload com os dados no nível do topo
    tmb: b["status_pedido"] !== undefined || b["cliente"] !== undefined
      ? {
          status_pedido: b["status_pedido"],
          cliente: b["cliente"],
          email: b["email"],
          telefone_ativo: b["telefone_ativo"],
          telefones: b["telefones"],
          lancamento: b["lancamento"],
          titulo: b["titulo"],
          pedido: b["pedido"] ?? b["id"],
        }
      : undefined,
  };
}

export function obterLogs(limite = 50): WebhookLogEntry[] {
  return logs.slice(0, limite);
}
