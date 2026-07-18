import { pool } from "./pool.ts";

// Dedup persistente e atômico por id_mensagem. Retorna true se é a PRIMEIRA vez que essa
// mensagem é vista (deve processar), false se já foi reivindicada antes (duplicata → ignorar).
// Cross-process e sobrevive a restart, ao contrário do Set em memória do webhook.
export async function reivindicarMensagem(idMensagem: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO mensagens_processadas (id_mensagem) VALUES ($1)
     ON CONFLICT (id_mensagem) DO NOTHING
     RETURNING id_mensagem`,
    [idMensagem],
  );
  return (result.rowCount ?? 0) > 0;
}

// Remove registros antigos de dedup pra tabela não crescer indefinidamente.
export async function limparMensagensProcessadas(): Promise<void> {
  await pool.query(`DELETE FROM mensagens_processadas WHERE criado_em < NOW() - INTERVAL '2 days'`);
}

export async function enfileirarMensagem(
  idMensagem: string,
  telefone: string,
  mensagem: string,
  timestamp: string,
) {
  await pool.query(
    `INSERT INTO n8n_fila_mensagens (id_mensagem, telefone, mensagem, timestamp)
     VALUES ($1, $2, $3, $4)`,
    [idMensagem, telefone, mensagem, timestamp],
  );
}

export async function buscarUltimaMensagem(telefone: string): Promise<{ idMensagem: string; timestamp: Date } | null> {
  const result = await pool.query(
    `SELECT id_mensagem, timestamp FROM n8n_fila_mensagens
     WHERE telefone = $1
     ORDER BY id DESC LIMIT 1`,
    [telefone],
  );
  const row = result.rows[0];
  return row ? { idMensagem: row.id_mensagem, timestamp: row.timestamp } : null;
}

export async function coletarELimparMensagens(telefone: string): Promise<string> {
  const result = await pool.query(
    `DELETE FROM n8n_fila_mensagens
     WHERE id IN (SELECT id FROM n8n_fila_mensagens WHERE telefone = $1 ORDER BY id)
     RETURNING mensagem`,
    [telefone],
  );
  return result.rows.map((r: { mensagem: string }) => r.mensagem).join("\n");
}

export async function limparFila(telefone: string) {
  await pool.query(
    `DELETE FROM n8n_fila_mensagens WHERE telefone = $1`,
    [telefone],
  );
}
