import { pool } from "./pool.ts";
import { env } from "../config/env.ts";

export async function verificarLock(telefone: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT lock_conversa FROM n8n_status_atendimento WHERE session_id = $1`,
    [telefone],
  );
  const row = result.rows[0];
  return row ? row.lock_conversa === true : false;
}

export async function adquirirLock(telefone: string) {
  await pool.query(
    `INSERT INTO n8n_status_atendimento (session_id, lock_conversa, updated_at)
     VALUES ($1, true, NOW())
     ON CONFLICT (session_id)
     DO UPDATE SET lock_conversa = true, updated_at = NOW()`,
    [telefone],
  );
}

export async function liberarLock(telefone: string) {
  await pool.query(
    `INSERT INTO n8n_status_atendimento (session_id, lock_conversa, updated_at)
     VALUES ($1, false, NOW())
     ON CONFLICT (session_id)
     DO UPDATE SET lock_conversa = false, updated_at = NOW()`,
    [telefone],
  );
}

export async function limparLock(telefone: string) {
  await pool.query(
    `DELETE FROM n8n_status_atendimento WHERE session_id = $1`,
    [telefone],
  );
}

export async function tentarAdquirirLock(telefone: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO n8n_status_atendimento (session_id, lock_conversa, updated_at)
     VALUES ($1, true, NOW())
     ON CONFLICT (session_id)
     DO UPDATE SET lock_conversa = true, updated_at = NOW()
     WHERE n8n_status_atendimento.lock_conversa = false
        OR n8n_status_atendimento.updated_at < NOW() - INTERVAL '1 minute' * $2
     RETURNING session_id`,
    [telefone, env.LOCK_TTL_MINUTES],
  );
  return result.rows.length > 0;
}
