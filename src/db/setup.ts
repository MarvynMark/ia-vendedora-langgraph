import { pool } from "./pool.ts";
import { logger } from "../lib/logger.ts";

export async function criarTabelas() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS n8n_fila_mensagens (
        id SERIAL PRIMARY KEY,
        id_mensagem TEXT NOT NULL,
        telefone TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_fila_telefone ON n8n_fila_mensagens(telefone);
      CREATE INDEX IF NOT EXISTS idx_fila_timestamp ON n8n_fila_mensagens(timestamp DESC);

      CREATE TABLE IF NOT EXISTS n8n_status_atendimento (
        session_id TEXT PRIMARY KEY,
        lock_conversa BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS n8n_historico_mensagens (
        id SERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB DEFAULT '[]',
        additional_kwargs JSONB DEFAULT '{}',
        response_metadata JSONB DEFAULT '{}',
        invalid_tool_calls JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_historico_session ON n8n_historico_mensagens(session_id);
      CREATE INDEX IF NOT EXISTS idx_historico_created ON n8n_historico_mensagens(created_at DESC);

      CREATE TABLE IF NOT EXISTS leads_formulario_mentoria (
        id                          SERIAL PRIMARY KEY,
        nome_completo               VARCHAR(255)    NOT NULL,
        whatsapp                    VARCHAR(20),
        email                       VARCHAR(255),
        idade                       TEXT,
        area_graduacao              VARCHAR(255),
        concurso_desejado           TEXT,
        ja_foi_aluno                VARCHAR(100),
        nivel_concurseiro           VARCHAR(100),
        maior_dificuldade           TEXT,
        motivo_mentoria             TEXT,
        expectativa_mentoria        TEXT,
        plano_b                     TEXT,
        o_que_faltou                TEXT,
        diferenca_com_mentor        TEXT,
        disposto_investir           VARCHAR(50),
        pronto_para_garantir        VARCHAR(50),
        criado_em                   TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em               TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS leads_template_pendente (
        id                SERIAL PRIMARY KEY,
        conversation_id   INTEGER NOT NULL UNIQUE,
        account_id        INTEGER NOT NULL,
        phone             TEXT,
        template_enviado  BOOLEAN NOT NULL DEFAULT FALSE,
        criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_template_pendente_enviado ON leads_template_pendente(template_enviado, criado_em);
    `);
    logger.info("db", "Tabelas criadas com sucesso");
  } finally {
    client.release();
  }
}

// Run when executed directly
if (import.meta.main) {
  await criarTabelas();
  await pool.end();
}
