import { pool } from "./pool.ts";

export interface MensagemHistorico {
  type: string;
  content: string;
  tool_calls: unknown[];
  additional_kwargs: Record<string, unknown>;
  response_metadata: Record<string, unknown>;
  invalid_tool_calls: unknown[];
}

export async function buscarHistorico(sessionId: string, limite: number = 50): Promise<MensagemHistorico[]> {
  const result = await pool.query(
    `SELECT type, content, tool_calls, additional_kwargs, response_metadata, invalid_tool_calls
     FROM n8n_historico_mensagens
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limite],
  );
  return result.rows.reverse();
}

export async function salvarMensagem(
  sessionId: string,
  mensagem: MensagemHistorico,
) {
  await pool.query(
    `INSERT INTO n8n_historico_mensagens (session_id, type, content, tool_calls, additional_kwargs, response_metadata, invalid_tool_calls)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      mensagem.type,
      mensagem.content,
      JSON.stringify(mensagem.tool_calls),
      JSON.stringify(mensagem.additional_kwargs),
      JSON.stringify(mensagem.response_metadata),
      JSON.stringify(mensagem.invalid_tool_calls),
    ],
  );
}

export async function limparHistorico(sessionId: string) {
  await pool.query(
    `DELETE FROM n8n_historico_mensagens WHERE session_id = $1`,
    [sessionId],
  );
}
