// Estado do "modo correção" de cada conversa do Suporte 1, persistido no Postgres: sobrevive a
// deploy e a webhooks concorrentes (o aluno manda 3 fotos de uma vez → 3 webhooks ao mesmo tempo).
// As tabelas são criadas na primeira chamada, como em db/midias.ts: não depende de rodar /setup.
import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";
import type { Anexo } from "./ia.ts";

export type Etapa = "concurso" | "area" | "enunciado" | "resposta" | "confirmar" | "corrigindo";

export interface Parte {
  texto?: string;
  anexo?: Anexo;
}

export interface Sessao {
  conversaId: string;
  telefone: string;
  etapa: Etapa;
  concurso: string | null;
  area: string | null;
  codigoQuestao: string | null;
  enunciado: string | null;
  partes: Parte[];
  transcricao: string[] | null;
  digitada: boolean;
  linhasEstimadas: boolean;
  atualizadoEm: Date;
}

// Sem resposta do aluno por esse tempo, o modo correção fecha e a conversa volta para a equipe.
// 30 min era pouco: o aluno recebe o enunciado e vai ESCREVER a resposta à mão (conv 10066: a
// resposta chegou 1h20 depois e foi ignorada em silêncio).
export const EXPIRACAO_MIN = 4 * 60;
// "corrigindo" travado por mais que isso é um processo que morreu no meio (deploy): libera.
const EXPIRACAO_CORRIGINDO_MIN = 10;

let tabelasProntas: Promise<unknown> | null = null;
function garantirTabelas() {
  tabelasProntas ??= pool.query(`
    CREATE TABLE IF NOT EXISTS corretor_sessoes (
      conversa_id      TEXT PRIMARY KEY,
      telefone         TEXT NOT NULL,
      etapa            TEXT NOT NULL,
      concurso         TEXT,
      area             TEXT,
      codigo_questao   TEXT,
      enunciado        TEXT,
      partes           JSONB NOT NULL DEFAULT '[]',
      transcricao      JSONB,
      digitada         BOOLEAN NOT NULL DEFAULT FALSE,
      linhas_estimadas BOOLEAN NOT NULL DEFAULT FALSE,
      atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS corretor_alunos (
      telefone      TEXT NOT NULL,
      concurso      TEXT NOT NULL,
      area          TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (telefone, concurso)
    );
    CREATE TABLE IF NOT EXISTS corretor_correcoes (
      id             SERIAL PRIMARY KEY,
      telefone       TEXT NOT NULL,
      conversa_id    TEXT NOT NULL,
      concurso       TEXT NOT NULL,
      area           TEXT,
      codigo_questao TEXT,
      enunciado      TEXT NOT NULL,
      transcricao    JSONB NOT NULL,
      avaliacao      JSONB NOT NULL,
      nota           NUMERIC(6,2) NOT NULL,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_corretor_correcoes_tel ON corretor_correcoes(telefone, criado_em DESC);
  `).catch((e) => {
    tabelasProntas = null;
    throw e;
  });
  return tabelasProntas;
}

type Linha = Record<string, unknown>;

function deLinha(r: Linha): Sessao {
  return {
    conversaId: String(r["conversa_id"]),
    telefone: String(r["telefone"]),
    etapa: r["etapa"] as Etapa,
    concurso: (r["concurso"] as string | null) ?? null,
    area: (r["area"] as string | null) ?? null,
    codigoQuestao: (r["codigo_questao"] as string | null) ?? null,
    enunciado: (r["enunciado"] as string | null) ?? null,
    partes: (r["partes"] as Parte[] | null) ?? [],
    transcricao: (r["transcricao"] as string[] | null) ?? null,
    digitada: Boolean(r["digitada"]),
    linhasEstimadas: Boolean(r["linhas_estimadas"]),
    atualizadoEm: new Date(r["atualizado_em"] as string),
  };
}

/** Sessão ativa da conversa, ou null (inexistente ou expirada — a expirada é apagada). */
export async function buscarSessao(conversaId: string): Promise<Sessao | null> {
  await garantirTabelas();
  const r = await pool.query(`SELECT * FROM corretor_sessoes WHERE conversa_id = $1`, [conversaId]);
  const linha = r.rows[0] as Linha | undefined;
  if (!linha) return null;
  const s = deLinha(linha);
  const limite = s.etapa === "corrigindo" ? EXPIRACAO_CORRIGINDO_MIN : EXPIRACAO_MIN;
  if (Date.now() - s.atualizadoEm.getTime() > limite * 60_000) {
    await apagarSessao(conversaId);
    return null;
  }
  return s;
}

/** Começa (ou recomeça do zero) o modo correção da conversa. */
export async function iniciarSessao(s: Pick<Sessao, "conversaId" | "telefone" | "etapa" | "concurso" | "area" | "codigoQuestao" | "enunciado">): Promise<void> {
  await garantirTabelas();
  await pool.query(
    `INSERT INTO corretor_sessoes (conversa_id, telefone, etapa, concurso, area, codigo_questao, enunciado)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conversa_id) DO UPDATE SET
       telefone = EXCLUDED.telefone, etapa = EXCLUDED.etapa, concurso = EXCLUDED.concurso,
       area = EXCLUDED.area, codigo_questao = EXCLUDED.codigo_questao, enunciado = EXCLUDED.enunciado,
       partes = '[]', transcricao = NULL, digitada = FALSE, linhas_estimadas = FALSE, atualizado_em = NOW()`,
    [s.conversaId, s.telefone, s.etapa, s.concurso, s.area, s.codigoQuestao, s.enunciado],
  );
}

const COLUNAS: Record<string, string> = {
  etapa: "etapa",
  concurso: "concurso",
  area: "area",
  codigoQuestao: "codigo_questao",
  enunciado: "enunciado",
  transcricao: "transcricao",
  digitada: "digitada",
  linhasEstimadas: "linhas_estimadas",
};

type Campos = Partial<Pick<Sessao, "etapa" | "concurso" | "area" | "codigoQuestao" | "enunciado" | "transcricao" | "digitada" | "linhasEstimadas">>;

/**
 * Atualiza a sessão. Com `deEtapa`, só atualiza se ela ainda estiver nessa etapa (claim atômico:
 * dois "CORRIGIR" seguidos não disparam duas correções). Retorna se atualizou.
 */
export async function atualizarSessao(conversaId: string, campos: Campos, deEtapa?: Etapa): Promise<boolean> {
  const sets: string[] = [];
  const valores: unknown[] = [conversaId];
  for (const [chave, valor] of Object.entries(campos)) {
    const coluna = COLUNAS[chave];
    if (!coluna) continue;
    valores.push(chave === "transcricao" && valor !== null ? JSON.stringify(valor) : valor);
    sets.push(`${coluna} = $${valores.length}`);
  }
  sets.push("atualizado_em = NOW()");
  let where = "conversa_id = $1";
  if (deEtapa) {
    valores.push(deEtapa);
    where += ` AND etapa = $${valores.length}`;
  }
  const r = await pool.query(`UPDATE corretor_sessoes SET ${sets.join(", ")} WHERE ${where}`, valores);
  return (r.rowCount ?? 0) > 0;
}

/** Junta uma parte da resposta (texto ou anexo) e devolve quantas partes já existem. */
export async function adicionarParte(conversaId: string, parte: Parte): Promise<number> {
  const r = await pool.query(
    `UPDATE corretor_sessoes SET partes = partes || $2::jsonb, atualizado_em = NOW()
     WHERE conversa_id = $1 RETURNING jsonb_array_length(partes) AS n`,
    [conversaId, JSON.stringify([parte])],
  );
  return Number((r.rows[0] as Linha | undefined)?.["n"] ?? 0);
}

export async function apagarSessao(conversaId: string): Promise<void> {
  await pool.query(`DELETE FROM corretor_sessoes WHERE conversa_id = $1`, [conversaId]);
}

/** Área de formação lembrada do aluno naquele concurso. */
export async function areaDoAluno(telefone: string, concurso: string): Promise<string | null> {
  await garantirTabelas();
  const r = await pool.query(`SELECT area FROM corretor_alunos WHERE telefone = $1 AND concurso = $2`, [telefone, concurso]);
  return ((r.rows[0] as Linha | undefined)?.["area"] as string | null) ?? null;
}

export async function salvarAreaDoAluno(telefone: string, concurso: string, area: string): Promise<void> {
  await garantirTabelas();
  await pool.query(
    `INSERT INTO corretor_alunos (telefone, concurso, area) VALUES ($1, $2, $3)
     ON CONFLICT (telefone, concurso) DO UPDATE SET area = EXCLUDED.area, atualizado_em = NOW()`,
    [telefone, concurso, area],
  );
}

/** Correções feitas hoje (fuso do app) por este telefone — para o limite diário. */
export async function correcoesHoje(telefone: string): Promise<number> {
  await garantirTabelas();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM corretor_correcoes
     WHERE telefone = $1 AND (criado_em AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`,
    [telefone, env.TZ],
  );
  return Number((r.rows[0] as Linha | undefined)?.["n"] ?? 0);
}

export async function registrarCorrecao(c: {
  telefone: string;
  conversaId: string;
  concurso: string;
  area: string | null;
  codigoQuestao: string | null;
  enunciado: string;
  transcricao: string[];
  avaliacao: unknown;
  nota: number;
}): Promise<void> {
  await garantirTabelas();
  await pool.query(
    `INSERT INTO corretor_correcoes (telefone, conversa_id, concurso, area, codigo_questao, enunciado, transcricao, avaliacao, nota)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [c.telefone, c.conversaId, c.concurso, c.area, c.codigoQuestao, c.enunciado,
      JSON.stringify(c.transcricao), JSON.stringify(c.avaliacao), c.nota],
  );
}
