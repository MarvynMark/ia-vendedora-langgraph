// Estado do "modo correção" de cada conversa do Suporte 1, persistido no Postgres: sobrevive a
// deploy e a webhooks concorrentes (o aluno manda 3 fotos de uma vez → 3 webhooks ao mesmo tempo).
// As tabelas são criadas na primeira chamada, como em db/midias.ts: não depende de rodar /setup.
import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";
import type { Anexo } from "./openai.ts";

// pos_correcao: devolutiva entregue; o aluno pode pedir DETALHES/ERROS/MODELO ou fazer o desafio.
// reescrita: o aluno está mandando a reescrita do desafio.
export type Etapa = "concurso" | "area" | "enunciado" | "resposta" | "confirmar" | "corrigindo" | "pos_correcao" | "reescrita";

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
  correcaoId: number | null;        // última correção entregue (para DETALHES/ERROS/MODELO/REESCREVER)
  autoavaliacao: number | null;     // nota que o aluno estimou enquanto a correção rodava
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
    ALTER TABLE corretor_sessoes ADD COLUMN IF NOT EXISTS correcao_id INTEGER;
    ALTER TABLE corretor_sessoes ADD COLUMN IF NOT EXISTS autoavaliacao NUMERIC(5,2);
    ALTER TABLE corretor_correcoes ADD COLUMN IF NOT EXISTS calculo JSONB;
    ALTER TABLE corretor_correcoes ADD COLUMN IF NOT EXISTS autoavaliacao NUMERIC(5,2);
    CREATE TABLE IF NOT EXISTS corretor_reescritas (
      id           SERIAL PRIMARY KEY,
      correcao_id  INTEGER NOT NULL,
      texto        TEXT NOT NULL,
      atingiu      BOOLEAN NOT NULL,
      retorno      JSONB NOT NULL,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS corretor_espelhos (
      chave      TEXT PRIMARY KEY,
      concurso   TEXT NOT NULL,
      enunciado  TEXT NOT NULL,
      itens      JSONB NOT NULL,
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    correcaoId: r["correcao_id"] == null ? null : Number(r["correcao_id"]),
    autoavaliacao: r["autoavaliacao"] == null ? null : Number(r["autoavaliacao"]),
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
       partes = '[]', transcricao = NULL, digitada = FALSE, linhas_estimadas = FALSE,
       correcao_id = NULL, autoavaliacao = NULL, atualizado_em = NOW()`,
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
  correcaoId: "correcao_id",
  autoavaliacao: "autoavaliacao",
};

type Campos = Partial<Pick<Sessao, "etapa" | "concurso" | "area" | "codigoQuestao" | "enunciado" | "transcricao" | "digitada" | "linhasEstimadas" | "correcaoId" | "autoavaliacao">>;

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
  calculo: unknown;
  nota: number;
  autoavaliacao: number | null;
}): Promise<number> {
  await garantirTabelas();
  const r = await pool.query(
    `INSERT INTO corretor_correcoes (telefone, conversa_id, concurso, area, codigo_questao, enunciado, transcricao, avaliacao, calculo, nota, autoavaliacao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [c.telefone, c.conversaId, c.concurso, c.area, c.codigoQuestao, c.enunciado,
      JSON.stringify(c.transcricao), JSON.stringify(c.avaliacao), JSON.stringify(c.calculo), c.nota, c.autoavaliacao],
  );
  return Number((r.rows[0] as Linha)["id"]);
}

export interface CorrecaoSalva {
  id: number;
  concurso: string;
  area: string | null;
  codigoQuestao: string | null;
  enunciado: string;
  transcricao: string[];
  avaliacao: unknown;
  calculo: unknown;
  nota: number;
  autoavaliacao: number | null;
  criadoEm: Date;
}

function correcaoDeLinha(r: Linha): CorrecaoSalva {
  return {
    id: Number(r["id"]),
    concurso: String(r["concurso"]),
    area: (r["area"] as string | null) ?? null,
    codigoQuestao: (r["codigo_questao"] as string | null) ?? null,
    enunciado: String(r["enunciado"]),
    transcricao: (r["transcricao"] as string[]) ?? [],
    avaliacao: r["avaliacao"],
    calculo: r["calculo"],
    nota: Number(r["nota"]),
    autoavaliacao: r["autoavaliacao"] == null ? null : Number(r["autoavaliacao"]),
    criadoEm: new Date(r["criado_em"] as string),
  };
}

export async function buscarCorrecao(id: number): Promise<CorrecaoSalva | null> {
  await garantirTabelas();
  const r = await pool.query(`SELECT * FROM corretor_correcoes WHERE id = $1`, [id]);
  const linha = r.rows[0] as Linha | undefined;
  return linha ? correcaoDeLinha(linha) : null;
}

/** Últimas correções do aluno naquele concurso, da mais recente para a mais antiga. */
export async function ultimasCorrecoes(telefone: string, concurso: string, limite = 5): Promise<CorrecaoSalva[]> {
  await garantirTabelas();
  const r = await pool.query(
    `SELECT * FROM corretor_correcoes WHERE telefone = $1 AND concurso = $2 ORDER BY criado_em DESC LIMIT $3`,
    [telefone, concurso, limite],
  );
  return (r.rows as Linha[]).map(correcaoDeLinha);
}

export async function registrarReescrita(correcaoId: number, texto: string, atingiu: boolean, retorno: unknown): Promise<void> {
  await garantirTabelas();
  await pool.query(
    `INSERT INTO corretor_reescritas (correcao_id, texto, atingiu, retorno) VALUES ($1, $2, $3, $4)`,
    [correcaoId, texto, atingiu, JSON.stringify(retorno)],
  );
}

/** Espelho exigido já montado para este enunciado (mesma questão → mesmo espelho → nota estável). */
export async function buscarEspelhoSalvo(chave: string): Promise<Array<{ elemento: string; comando: string; atendidoSe?: string }> | null> {
  await garantirTabelas();
  const r = await pool.query(`SELECT itens FROM corretor_espelhos WHERE chave = $1`, [chave]);
  return ((r.rows[0] as Linha | undefined)?.["itens"] as Array<{ elemento: string; comando: string; atendidoSe?: string }> | undefined) ?? null;
}

export async function salvarEspelho(chave: string, concurso: string, enunciado: string, itens: unknown): Promise<void> {
  await garantirTabelas();
  await pool.query(
    `INSERT INTO corretor_espelhos (chave, concurso, enunciado, itens) VALUES ($1, $2, $3, $4)
     ON CONFLICT (chave) DO UPDATE SET itens = EXCLUDED.itens, criado_em = NOW()`,
    [chave, concurso, enunciado, JSON.stringify(itens)],
  );
}
