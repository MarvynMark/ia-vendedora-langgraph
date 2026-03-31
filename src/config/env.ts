const obrigatorias = [
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "CHATWOOT_BASE_URL",
  "CHATWOOT_API_TOKEN",
  "CHATWOOT_ACCOUNT_ID",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "CHATWOOT_INBOX_ID",
  "CHATWOOT_ALERT_INBOX_ID",
  "CHATWOOT_ALERT_CONVERSATION_ID",
] as const;

for (const variavel of obrigatorias) {
  if (!process.env[variavel]) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${variavel}`);
  }
}

export const env = {
  PORT: Number(process.env["PORT"] ?? "3000"),
  DATABASE_URL: process.env["DATABASE_URL"]!,

  OPENAI_API_KEY: process.env["OPENAI_API_KEY"]!,
  OPENAI_MODEL: process.env["OPENAI_MODEL"] ?? "gpt-5.2",
  OPENAI_MODEL_MINI: process.env["OPENAI_MODEL_MINI"] ?? "gpt-4.1-mini",

  CHATWOOT_BASE_URL: process.env["CHATWOOT_BASE_URL"]!,
  CHATWOOT_API_TOKEN: process.env["CHATWOOT_API_TOKEN"]!,
  CHATWOOT_ACCOUNT_ID: process.env["CHATWOOT_ACCOUNT_ID"]!,
  CHATWOOT_INBOX_ID: Number(process.env["CHATWOOT_INBOX_ID"]!),
  CHATWOOT_ALERT_INBOX_ID: process.env["CHATWOOT_ALERT_INBOX_ID"]!,
  CHATWOOT_ALERT_CONVERSATION_ID: process.env["CHATWOOT_ALERT_CONVERSATION_ID"]!,

  ELEVENLABS_API_KEY: process.env["ELEVENLABS_API_KEY"]!,
  ELEVENLABS_VOICE_ID: process.env["ELEVENLABS_VOICE_ID"]!,

  TZ: process.env["TZ"] ?? "America/Sao_Paulo",

  DEBOUNCE_DELAY_MS: Number(process.env["DEBOUNCE_DELAY_MS"] ?? "16000"),
  LOCK_MAX_RETRIES: Number(process.env["LOCK_MAX_RETRIES"] ?? "5"),
  LOCK_RETRY_DELAY_MS: Number(process.env["LOCK_RETRY_DELAY_MS"] ?? "16000"),
  LOCK_TTL_MINUTES: Number(process.env["LOCK_TTL_MINUTES"] ?? "5"),

  LANGFUSE_SECRET_KEY: process.env["LANGFUSE_SECRET_KEY"] ?? "",
  LANGFUSE_PUBLIC_KEY: process.env["LANGFUSE_PUBLIC_KEY"] ?? "",
  LANGFUSE_BASEURL: process.env["LANGFUSE_BASEURL"] ?? "https://cloud.langfuse.com",

  GRUPO_ESPERA_LINK: process.env["GRUPO_ESPERA_LINK"] ?? "https://chat.whatsapp.com/BFRcUIZD4tp85KfF1rNCHU",
  TEMPLATE_DELAY_MS: Number(process.env["TEMPLATE_DELAY_MS"] ?? "300000"), // 5 minutos
  VIDEO_PLATAFORMA_URL: process.env["VIDEO_PLATAFORMA_URL"] ?? "",
} as const;
