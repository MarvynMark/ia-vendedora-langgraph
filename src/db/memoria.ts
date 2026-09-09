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

/** Grava só se a MESMA fala não tiver entrado nos últimos `janelaMinutos`.
 *
 *  Existe porque a mesma mensagem pode chegar por dois caminhos: o painel de disparo
 *  avisando pelo /webhook/registrar-mensagem e o webhook do Chatwoot vendo a mesma
 *  mensagem sair. Sem esta guarda o histórico do lead ganharia a fala repetida, e
 *  repetição no histórico faz o modelo achar que insistiu e mudar de assunto.
 *
 *  Retorna true se gravou. */
export async function salvarMensagemSeNova(
  sessionId: string,
  mensagem: MensagemHistorico,
  janelaMinutos = 10,
): Promise<boolean> {
  const jaTem = await pool.query(
    `SELECT 1 FROM n8n_historico_mensagens
     WHERE session_id = $1 AND type = $2 AND content = $3
       AND created_at > NOW() - ($4 || ' minutes')::interval
     LIMIT 1`,
    [sessionId, mensagem.type, mensagem.content, janelaMinutos],
  );
  if ((jaTem.rowCount ?? 0) > 0) return false;
  await salvarMensagem(sessionId, mensagem);
  return true;
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
