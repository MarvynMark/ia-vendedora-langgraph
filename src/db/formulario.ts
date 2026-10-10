import { pool } from "./pool.ts";
import { logger } from "../lib/logger.ts";

export async function buscarDadosFormulario(telefone: string): Promise<string> {
  if (!telefone) return "";

  // Normaliza o telefone para comparar (remove +, espaços, traços)
  const telefoneLimpo = telefone.replace(/\D/g, "");
  // Compara pelos últimos 8 dígitos (o número local), que são estáveis mesmo quando
  // o formato varia no 9º dígito do celular brasileiro ou no DDI. Ex: o formulário
  // salva "5562981384100" (com 9) e o contato usa "556281384100" (sem 9) — ambos
  // terminam em "81384100", então o match funciona.
  const ultimos8 = telefoneLimpo.slice(-8);
  if (ultimos8.length < 8) return "";

  try {
    const result = await pool.query<{
      concurso_desejado: string | null;
      area_graduacao: string | null;
      nivel_concurseiro: string | null;
      maior_dificuldade: string | null;
      expectativa_mentoria: string | null;
      motivo_mentoria: string | null;
      disposto_investir: string | null;
      pronto_para_garantir: string | null;
      ja_foi_aluno: string | null;
      plano_b: string | null;
      o_que_faltou: string | null;
      diferenca_com_mentor: string | null;
      idade: string | null;
      quando_pretende_entrar: string | null;
    }>(
      `SELECT concurso_desejado, area_graduacao, nivel_concurseiro,
              maior_dificuldade, expectativa_mentoria, motivo_mentoria,
              disposto_investir, pronto_para_garantir, ja_foi_aluno,
              plano_b, o_que_faltou, diferenca_com_mentor, idade,
              quando_pretende_entrar
       FROM leads_formulario_mentoria
       WHERE RIGHT(REGEXP_REPLACE(whatsapp, '\\D', '', 'g'), 8) = $1
       ORDER BY criado_em DESC
       LIMIT 1`,
      [ultimos8],
    );

    if (result.rows.length === 0) return "";

    const d = result.rows[0]!;
    const partes = [
      d.concurso_desejado    ? `Concurso: ${d.concurso_desejado}` : null,
      d.area_graduacao       ? `Formação: ${d.area_graduacao}` : null,
      d.idade                ? `Idade: ${d.idade}` : null,
      d.nivel_concurseiro    ? `Nível: ${d.nivel_concurseiro}` : null,
      d.ja_foi_aluno         ? `Já foi aluno: ${d.ja_foi_aluno}` : null,
      d.maior_dificuldade    ? `Maior dificuldade: ${d.maior_dificuldade}` : null,
      d.motivo_mentoria      ? `Motivo da mentoria: ${d.motivo_mentoria}` : null,
      d.expectativa_mentoria ? `Expectativa: ${d.expectativa_mentoria}` : null,
      d.o_que_faltou         ? `O que faltou para aprovação: ${d.o_que_faltou}` : null,
      d.diferenca_com_mentor ? `Diferença com o mentor: ${d.diferenca_com_mentor}` : null,
      d.plano_b              ? `Plano B: ${d.plano_b}` : null,
      d.disposto_investir    ? `Disposto a investir: ${d.disposto_investir}` : null,
      d.pronto_para_garantir ? `Pronto para garantir: ${d.pronto_para_garantir}` : null,
      d.quando_pretende_entrar ? `Quando pretende entrar: ${d.quando_pretende_entrar}` : null,
    ].filter(Boolean);

    return partes.join(" | ");
  } catch (e) {
    logger.warn("db-formulario", "Erro ao buscar dados do formulário:", e);
    return "";
  }
}

// Versão estruturada e enxuta pra personalizar follow-ups (concurso/dificuldade). O agente
// principal usa a string completa (buscarDadosFormulario); a camada de follow-up só precisa
// destes campos pra injetar nos textos. Mesmo match por últimos 8 dígitos do WhatsApp.
export async function buscarCamposFormulario(
  telefone: string,
): Promise<{ concurso: string | null; dificuldade: string | null; formacao: string | null } | null> {
  if (!telefone) return null;
  const ultimos8 = telefone.replace(/\D/g, "").slice(-8);
  if (ultimos8.length < 8) return null;
  try {
    const result = await pool.query<{ concurso_desejado: string | null; maior_dificuldade: string | null; area_graduacao: string | null }>(
      `SELECT concurso_desejado, maior_dificuldade, area_graduacao
       FROM leads_formulario_mentoria
       WHERE RIGHT(REGEXP_REPLACE(whatsapp, '\\D', '', 'g'), 8) = $1
       ORDER BY criado_em DESC
       LIMIT 1`,
      [ultimos8],
    );
    const d = result.rows[0];
    if (!d) return null;
    return { concurso: d.concurso_desejado, dificuldade: d.maior_dificuldade, formacao: d.area_graduacao };
  } catch (e) {
    logger.warn("db-formulario", "Erro ao buscar campos do formulário:", e);
    return null;
  }
}

export interface PerfilFormulario {
  concurso: string | null;
  formacao: string | null;
  quandoEntrar: string | null;
  dispostoInvestir: string | null;
}

// Perfil de vários leads numa consulta só (lista quente do relatório diário). Chave do mapa:
// últimos 8 dígitos do telefone, o mesmo match de buscarDadosFormulario.
export async function buscarPerfisPorTelefones(telefones: string[]): Promise<Map<string, PerfilFormulario>> {
  const ultimos8 = [...new Set(telefones.map((t) => t.replace(/\D/g, "").slice(-8)).filter((t) => t.length === 8))];
  const mapa = new Map<string, PerfilFormulario>();
  if (ultimos8.length === 0) return mapa;
  const result = await pool.query<{
    chave: string;
    concurso_desejado: string | null;
    area_graduacao: string | null;
    quando_pretende_entrar: string | null;
    disposto_investir: string | null;
  }>(
    `SELECT DISTINCT ON (chave) chave, concurso_desejado, area_graduacao, quando_pretende_entrar, disposto_investir
     FROM (SELECT RIGHT(REGEXP_REPLACE(whatsapp, '\\D', '', 'g'), 8) AS chave, * FROM leads_formulario_mentoria) f
     WHERE chave = ANY($1)
     ORDER BY chave, criado_em DESC`,
    [ultimos8],
  );
  for (const r of result.rows) {
    mapa.set(r.chave, {
      concurso: r.concurso_desejado,
      formacao: r.area_graduacao,
      quandoEntrar: r.quando_pretende_entrar,
      dispostoInvestir: r.disposto_investir,
    });
  }
  return mapa;
}

export interface Aplicacao {
  concurso: string | null;
  formacao: string | null;
  quandoEntrar: string | null;
  dispostoInvestir: string | null;
  criadoEm: Date;
}

/** Aplicações recebidas no intervalo [inicio, fim) — base do relatório diário do comercial. */
export async function listarAplicacoes(inicio: Date, fim: Date): Promise<Aplicacao[]> {
  const result = await pool.query<{
    concurso_desejado: string | null;
    area_graduacao: string | null;
    quando_pretende_entrar: string | null;
    disposto_investir: string | null;
    criado_em: Date;
  }>(
    `SELECT concurso_desejado, area_graduacao, quando_pretende_entrar, disposto_investir, criado_em
     FROM leads_formulario_mentoria
     WHERE criado_em >= $1 AND criado_em < $2
     ORDER BY criado_em`,
    [inicio, fim],
  );
  return result.rows.map((r) => ({
    concurso: r.concurso_desejado,
    formacao: r.area_graduacao,
    quandoEntrar: r.quando_pretende_entrar,
    dispostoInvestir: r.disposto_investir,
    criadoEm: r.criado_em,
  }));
}
