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
}

function resumirBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return { raw: String(body).substring(0, 200) };

  const b = body as Record<string, unknown>;
  return {
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
  };
}

export function obterLogs(limite = 50): WebhookLogEntry[] {
  return logs.slice(0, limite);
}
