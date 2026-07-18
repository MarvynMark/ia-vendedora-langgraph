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

// Retorna true se a IA mandou alguma mensagem (type='ai') nos últimos `minutos`. Usado pra
// evitar re-disparar a intro quando a conversa está ATIVA agora, sem bloquear leads que voltam
// depois de muito tempo (histórico antigo não conta como "conversa em andamento").
export async function houveAiRecente(sessionId: string, minutos: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM n8n_historico_mensagens
     WHERE session_id = $1 AND type = 'ai' AND created_at > NOW() - ($2 || ' minutes')::interval
     LIMIT 1`,
    [sessionId, minutos],
  );
  return (result.rowCount ?? 0) > 0;
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
