import { Elysia } from "elysia";
import { z } from "zod";
import { pool } from "../db/pool.ts";
import { logger } from "../lib/logger.ts";

// Mapeamento: chave do formulário → coluna da tabela
const CAMPO_MAP: Record<string, string> = {
  "Qual é o seu nome completo?": "nome_completo",
  "Qual é o seu WhatsApp?": "whatsapp",
  "Qual é o seu e-mail?": "email",
  "Qual é a sua idade?": "idade",
  "Qual é a sua área de graduação/curso de formação superior?": "area_graduacao",
  "Qual é o concurso de Perito Criminal você deseja prestar?": "concurso_desejado",
  "Você já foi aluno do Perito Walker?": "ja_foi_aluno",
  "Você estuda para concursos há muito tempo? Qual é o seu nível de concurseiro?": "nivel_concurseiro",
  "Qual é sua maior dificuldade frente aos estudos para concurso para Perito Criminal?": "maior_dificuldade",
  "O que te fez dar o primeiro passo em busca de uma mentoria?": "motivo_mentoria",
  "O que você espera que essa mentoria te traga em relação aos seus estudos?": "expectativa_mentoria",
  "Você tem um plano B caso a aprovação não venha logo de imediato?": "plano_b",
  "O que você acredita que faltou para você ser aprovado em um concurso até agora?": "o_que_faltou",
  "O você acha que seria diferente na sua preparação caso tenha o perito Walker como mentor?": "diferenca_com_mentor",
  "Você está disposto e teria condições de investir cerca de R$ 197 por mês (12x de 197) para ser acompanhado pelo Perito Walker?": "disposto_investir",
  "Por fim: se sua aplicação for aprovada, você estaria pronto para garantir sua vaga hoje?": "pronto_para_garantir",
};

const COLUNAS_VALIDAS = new Set(Object.values(CAMPO_MAP));

// Schema aceita qualquer objeto com strings — o parse faz o mapeamento
const formularioSchema = z.record(z.string(), z.string());

function parsearFormulario(raw: Record<string, string>): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const [pergunta, resposta] of Object.entries(raw)) {
    const coluna = CAMPO_MAP[pergunta];
    if (coluna) {
      resultado[coluna] = resposta;
    }
  }
  return resultado;
}

export const aplicacaoRouter = new Elysia()
  .post("/webhook/cadastrar-lead-formulario-mentoria", async ({ body }) => {
    const parsed = formularioSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("aplicacao", "Payload inválido:", parsed.error.issues);
      return { status: "error", reason: "invalid_payload", issues: parsed.error.issues };
    }

    const d = parsearFormulario(parsed.data);

    if (!d.nome_completo) {
      logger.warn("aplicacao", "Campo nome_completo não encontrado no payload");
      return { status: "error", reason: "missing_nome_completo" };
    }

    // Montar INSERT dinâmico apenas com colunas presentes
    const colunas = Object.keys(d).filter(c => COLUNAS_VALIDAS.has(c));
    const valores = colunas.map(c => d[c]!);
    const placeholders = colunas.map((_, i) => `$${i + 1}`);

    try {
      const result = await pool.query(
        `INSERT INTO leads_formulario_mentoria (${colunas.join(", ")})
         VALUES (${placeholders.join(", ")})
         RETURNING id`,
        valores,
      );

      const id = result.rows[0]?.id;
      logger.info("aplicacao", "Lead salvo:", { id, nome: d.nome_completo });
      return { status: "ok", id };
    } catch (e) {
      logger.error("aplicacao", "Erro ao salvar lead:", e);
      return { status: "error", reason: String(e) };
    }
  });
