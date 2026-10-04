// Trava de "mídia UMA vez por conversa" que sobrevive a deploy.
//
// Cada tool de mídia tinha um Set em memória. Um deploy entre dois turnos zerava o Set e a
// segunda chamada passava: conv 9614 (03/10/2026) recebeu o áudio 1 às 18:43 e de novo às 18:50,
// com o deploy das 18:45 no meio. A regra também estava só no prompt, e o modelo chamou a tool de
// novo mesmo vendo "[enviado ao lead: áudio 1 do Walker]" no histórico.
//
// Duas fontes, nesta ordem:
//   1. o histórico do lead: a marca "[enviado ao lead: <rótulo>]" existe desde 01/10, então cobre
//      conversas que já receberam a mídia antes desta tabela existir;
//   2. a tabela midias_enviadas: claim atômico, vale entre processos e depois de restart.
import { pool } from "./pool.ts";
import { logger } from "../lib/logger.ts";
import { MARCA_MIDIA_ENVIADA } from "../services/chatwoot.ts";

// As tools só recebem a conversa; o telefone (chave do histórico) é vinculado no início do turno.
const telefonePorConversa = new Map<string, string>();
export function vincularTelefoneConversa(idConversa: string | number, telefone: string): void {
  if (telefone) telefonePorConversa.set(String(idConversa), telefone);
}

let tabelaPronta: Promise<unknown> | null = null;
function garantirTabela() {
  tabelaPronta ??= pool.query(
    `CREATE TABLE IF NOT EXISTS midias_enviadas (
       conversa_id TEXT NOT NULL,
       midia       TEXT NOT NULL,
       criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (conversa_id, midia)
     )`,
  ).catch((e) => {
    tabelaPronta = null;
    throw e;
  });
  return tabelaPronta;
}

/**
 * true = pode enviar (esta chamada ficou com a mídia); false = já foi enviada nesta conversa.
 * Falha de banco libera o envio: o Set em memória da tool continua segurando dentro do processo,
 * e perder a mídia é pior que o raro envio duplo.
 */
export async function reivindicarMidia(idConversa: string | number, rotulo: string): Promise<boolean> {
  const conversa = String(idConversa);
  try {
    const telefone = telefonePorConversa.get(conversa);
    if (telefone) {
      const h = await pool.query(
        `SELECT 1 FROM n8n_historico_mensagens WHERE session_id = $1 AND type = 'ai' AND content = $2 LIMIT 1`,
        [telefone, `${MARCA_MIDIA_ENVIADA} ${rotulo}]`],
      );
      if ((h.rowCount ?? 0) > 0) {
        logger.warn("midias", `"${rotulo}" já está no histórico da conversa ${conversa} — não reenvia`);
        return false;
      }
    }
    await garantirTabela();
    const r = await pool.query(
      `INSERT INTO midias_enviadas (conversa_id, midia) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
      [conversa, rotulo],
    );
    if ((r.rowCount ?? 0) === 0) {
      logger.warn("midias", `"${rotulo}" já foi enviado na conversa ${conversa} — não reenvia`);
      return false;
    }
    return true;
  } catch (e) {
    logger.warn("midias", `Erro na trava de mídia (${rotulo}, conversa ${conversa}) — liberando o envio:`, e);
    return true;
  }
}

/** Devolve a mídia reivindicada quando o envio falhou, pra uma nova tentativa poder sair. */
export async function liberarMidia(idConversa: string | number, rotulo: string): Promise<void> {
  try {
    await pool.query(`DELETE FROM midias_enviadas WHERE conversa_id = $1 AND midia = $2`, [String(idConversa), rotulo]);
  } catch (e) {
    logger.warn("midias", `Erro ao liberar a trava de mídia (${rotulo}):`, e);
  }
}

/** /reset: a conversa volta a poder receber todas as mídias. */
export async function limparMidiasConversa(idConversa: string | number): Promise<void> {
  try {
    await garantirTabela();
    await pool.query(`DELETE FROM midias_enviadas WHERE conversa_id = $1`, [String(idConversa)]);
  } catch (e) {
    logger.warn("midias", "Erro ao limpar mídias da conversa:", e);
  }
}
