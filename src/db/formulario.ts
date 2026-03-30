import { pool } from "./pool.ts";
import { logger } from "../lib/logger.ts";

export async function buscarDadosFormulario(telefone: string): Promise<string> {
  if (!telefone) return "";

  // Normaliza o telefone para comparar (remove +, espaços, traços)
  const telefoneLimpo = telefone.replace(/\D/g, "");

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
    }>(
      `SELECT concurso_desejado, area_graduacao, nivel_concurseiro,
              maior_dificuldade, expectativa_mentoria, motivo_mentoria,
              disposto_investir, pronto_para_garantir, ja_foi_aluno
       FROM leads_formulario_mentoria
       WHERE REGEXP_REPLACE(whatsapp, '\\D', '', 'g') LIKE $1
       ORDER BY criado_em DESC
       LIMIT 1`,
      [`%${telefoneLimpo}`],
    );

    if (result.rows.length === 0) return "";

    const d = result.rows[0]!;
    const partes = [
      d.concurso_desejado    ? `Concurso: ${d.concurso_desejado}` : null,
      d.area_graduacao       ? `Formação: ${d.area_graduacao}` : null,
      d.nivel_concurseiro    ? `Nível: ${d.nivel_concurseiro}` : null,
      d.maior_dificuldade    ? `Dificuldade: ${d.maior_dificuldade}` : null,
      d.expectativa_mentoria ? `Expectativa: ${d.expectativa_mentoria}` : null,
      d.motivo_mentoria      ? `Motivo: ${d.motivo_mentoria}` : null,
      d.disposto_investir    ? `Disposto a investir: ${d.disposto_investir}` : null,
      d.pronto_para_garantir ? `Pronto para garantir: ${d.pronto_para_garantir}` : null,
      d.ja_foi_aluno         ? `Já foi aluno: ${d.ja_foi_aluno}` : null,
    ].filter(Boolean);

    return partes.join(" | ");
  } catch (e) {
    logger.warn("db-formulario", "Erro ao buscar dados do formulário:", e);
    return "";
  }
}
