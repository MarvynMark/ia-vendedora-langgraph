import { Elysia } from "elysia";
import { z } from "zod";
import { pool } from "../db/pool.ts";
import { logger } from "../lib/logger.ts";
import { env } from "../config/env.ts";
import { criarContato, criarConversa, criarKanbanTask, buscarContatoPorQuery, adicionarEtiquetas } from "../services/chatwoot.ts";

const KANBAN_BOARD_ID = 1;
const KANBAN_STEP_NOVO_LEAD = 1;
const INBOX_ID = 11;

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
      logger.info("aplicacao", "Lead salvo no banco:", { id, nome: d.nome_completo });

      // Lançar no Chatwoot em background (não bloqueia a resposta)
      void lancarNoChatwoot(d).catch(e =>
        logger.error("aplicacao", "Erro ao lançar lead no Chatwoot:", e)
      );

      return { status: "ok", id };
    } catch (e) {
      logger.error("aplicacao", "Erro ao salvar lead:", e);
      return { status: "error", reason: String(e) };
    }
  });

async function lancarNoChatwoot(d: Record<string, string>) {
  const accountId = env.CHATWOOT_ACCOUNT_ID;

  // Formata o número de telefone para E.164
  const telefoneRaw = d.whatsapp ?? "";
  const telefone = telefoneRaw.replace(/\D/g, "");
  const phoneE164 = telefone ? `+${telefone.startsWith("55") ? telefone : `55${telefone}`}` : undefined;

  // Verifica se contato já existe pelo telefone ou email
  let contatoId: number | null = null;
  const queryBusca = phoneE164 ?? d.email ?? d.nome_completo;
  if (queryBusca) {
    const existente = await buscarContatoPorQuery(accountId, queryBusca);
    if (existente) {
      contatoId = existente.id;
      logger.info("aplicacao", "Contato já existe no Chatwoot:", contatoId);
    }
  }

  // Cria contato se não existir
  if (!contatoId) {
    const novoContato = await criarContato(accountId, {
      name: d.nome_completo!,
      ...(phoneE164 ? { phone_number: phoneE164 } : {}),
      ...(d.email ? { email: d.email } : {}),
      custom_attributes: {
        ...(d.concurso_desejado ? { qual_concurso: d.concurso_desejado } : {}),
        ...(d.area_graduacao ? { qual_formacao: d.area_graduacao } : {}),
        ...(d.maior_dificuldade ? { maior_dificuldade: d.maior_dificuldade } : {}),
        ...(d.expectativa_mentoria ? { espera_da_mentoria: d.expectativa_mentoria } : {}),
        ...(d.nivel_concurseiro ? { nivel_concurseiro: d.nivel_concurseiro } : {}),
      },
    });
    contatoId = novoContato.id;
    logger.info("aplicacao", "Contato criado no Chatwoot:", contatoId);
  }

  // Cria conversa na inbox comercial
  const conversa = await criarConversa(accountId, {
    inbox_id: INBOX_ID,
    contact_id: contatoId,
  });
  logger.info("aplicacao", "Conversa criada:", conversa.id);

  // Monta descrição com os dados do formulário
  const linhas = [
    d.concurso_desejado     ? `Concurso: ${d.concurso_desejado}` : null,
    d.area_graduacao        ? `Formação: ${d.area_graduacao}` : null,
    d.nivel_concurseiro     ? `Nível: ${d.nivel_concurseiro}` : null,
    d.maior_dificuldade     ? `Maior dificuldade: ${d.maior_dificuldade}` : null,
    d.motivo_mentoria       ? `Motivo: ${d.motivo_mentoria}` : null,
    d.expectativa_mentoria  ? `Expectativa: ${d.expectativa_mentoria}` : null,
    d.disposto_investir     ? `Disposto a investir: ${d.disposto_investir}` : null,
    d.pronto_para_garantir  ? `Pronto para garantir: ${d.pronto_para_garantir}` : null,
    d.ja_foi_aluno          ? `Já foi aluno: ${d.ja_foi_aluno}` : null,
    d.plano_b               ? `Plano B: ${d.plano_b}` : null,
    d.o_que_faltou          ? `O que faltou: ${d.o_que_faltou}` : null,
    d.diferenca_com_mentor  ? `Diferença com mentor: ${d.diferenca_com_mentor}` : null,
  ].filter(Boolean).join("\n");

  // Cria task no Kanban na etapa "Novo Lead"
  const task = await criarKanbanTask(accountId, {
    board_id: KANBAN_BOARD_ID,
    board_step_id: KANBAN_STEP_NOVO_LEAD,
    title: d.nome_completo!,
    description: linhas,
    conversation_id: conversa.id,
  });
  logger.info("aplicacao", "Kanban task criada:", task.id);

  // Adiciona labels de ativação do agente
  await adicionarEtiquetas(accountId, conversa.id, ["agente-ativo", "lead-formulario"]);
  logger.info("aplicacao", "Labels agente-ativo e lead-formulario adicionadas");

  // Registra conversa para o timer de template (5 minutos)
  await pool.query(
    `INSERT INTO leads_template_pendente (conversation_id, account_id, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (conversation_id) DO NOTHING`,
    [conversa.id, Number(accountId), phoneE164 ?? null],
  );
  logger.info("aplicacao", "Lead registrado no timer de template");
}
