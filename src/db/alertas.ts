import { pool } from "./pool.ts";

// Trava PERMANENTE de "já avisei o grupo sobre esse lead". Sem ela o modelo re-chama o
// Alertar_gestor a cada turno (o contexto que motivou o alerta continua no histórico) e o grupo
// interno recebe o mesmo lead 3, 4 vezes em poucos minutos. Diferente de mensagens_processadas,
// aqui NÃO há rotina de limpeza: o alerta é uma vez por conversa, para sempre.
const chaveDe = (idConversa: string) => `alertar-gestor:${idConversa}`;

// Chave do alerta de objeção: uma vez por TIPO por conversa. O lead que trava no preço avisa uma
// vez; se depois adiar a decisão, avisa de novo — são travamentos diferentes, e o time precisa ver
// a evolução. O que não pode é o mesmo motivo repetir a cada turno.
export const chaveObjecao = (idConversa: string, tipo: string) => `objecao:${idConversa}:${tipo}`;

// true = primeira vez (pode avisar o grupo); false = já avisado antes (ignorar em silêncio).
// Atômico e cross-process, mesmo padrão de reivindicarMensagem (db/fila.ts).
export async function reivindicarAlerta(
  chave: string,
  telefone: string,
  motivo: string,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO alertas_gestor_enviados (chave, telefone, motivo) VALUES ($1, $2, $3)
     ON CONFLICT (chave) DO NOTHING
     RETURNING chave`,
    [chave, telefone, motivo],
  );
  return (result.rowCount ?? 0) > 0;
}

// Desfaz a reivindicação quando o envio ao grupo falha — senão uma falha de rede queimaria
// a única chance de avisar a equipe sobre aquele lead.
export async function liberarAlerta(chave: string): Promise<void> {
  await pool.query(`DELETE FROM alertas_gestor_enviados WHERE chave = $1`, [chave]);
}

export async function reivindicarAlertaGestor(
  idConversa: string,
  telefone: string,
  motivo: string,
): Promise<boolean> {
  return reivindicarAlerta(chaveDe(idConversa), telefone, motivo);
}

export async function liberarAlertaGestor(idConversa: string): Promise<void> {
  await liberarAlerta(chaveDe(idConversa));
}
