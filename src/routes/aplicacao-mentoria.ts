import { Elysia } from "elysia";
import { z } from "zod";
import { pool } from "../db/pool.ts";
import { logger } from "../lib/logger.ts";
import { env } from "../config/env.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";
import { criarContato, criarConversa, criarKanbanTask, buscarContatoPorQuery, adicionarEtiquetas, atualizarContatoDados } from "../services/chatwoot.ts";

const KANBAN_BOARD_ID = 1;
const KANBAN_STEP_NOVO_LEAD = 1;

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

  // --- Variantes do formulário MÉDICO LEGISTA (perguntas com texto diferente do Perito Criminal).
  // Sem estas, todo lead de Médico Legista perdia concurso/formação/dificuldade/disposição (ficavam
  // null): concurso e trilha errados, sem label "medico". (Ex.: contato Omilto, conv 4394.)
  "Você é?": "area_graduacao",
  "Qual é o concurso de Perito Médico Legista você deseja prestar?": "concurso_desejado",
  "Qual é sua maior dificuldade frente aos estudos para concurso?": "maior_dificuldade",
  "Você está disposto e teria condições de investir cerca de R$ 400 por mês (pagamento em 12x de 400) para ser acompanhado pelo Perito Walker e pela Dra. Natália na Mentoria?": "disposto_investir",
};

const COLUNAS_VALIDAS = new Set(Object.values(CAMPO_MAP));

// Monta a descrição de 3 linhas do card do Kanban a partir do formulário parseado.
// `d` tem as chaves de CAMPO_MAP (ex.: concurso_desejado) — NÃO as dos atributos do Chatwoot
// (qual_concurso), que só são criadas depois em atributosFormulario.
export function montarDescricaoTarefa(d: Record<string, string>): string {
  const dispostoInvestir = (d.disposto_investir ?? "").toLowerCase();
  const emojiAtendimento = (dispostoInvestir.includes("sim") || dispostoInvestir.includes("quero")) ? "🟢" : "🟣";
  const concursoDescricao = d.concurso_desejado ?? "não informado";
  return [
    `${emojiAtendimento} - Concurso: ${concursoDescricao}`,
    "🔁 - Follow-ups: 0",
    "👤 - Descrição: inicio",
  ].join("\n");
}

// True se o nome atual do contato é um "placeholder" que deve ser sobrescrito pelo nome do
// formulário: vazio, ou composto SÓ de dígitos e pontuação de telefone (+ ( ) - espaço). É o caso
// do contato criado pelo Chatwoot a partir do WhatsApp sem nome de perfil (fica o telefone como
// nome). Um nome com qualquer letra NÃO é placeholder — não sobrescrevemos nomes reais.
export function nomeEhPlaceholderContato(nomeAtual: string | null | undefined): boolean {
  const n = (nomeAtual ?? "").trim();
  return !n || /^[\d\s+()\-]+$/.test(n);
}

// Schema aceita qualquer objeto com strings — o parse faz o mapeamento
const formularioSchema = z.record(z.string(), z.string());

function parsearFormulario(raw: Record<string, string>): Record<string, string> {
  const resultado: Record<string, string> = {};
  const naoMapeadas: string[] = [];
  for (const [pergunta, resposta] of Object.entries(raw)) {
    const coluna = CAMPO_MAP[pergunta];
    if (coluna) {
      resultado[coluna] = resposta;
    } else {
      naoMapeadas.push(pergunta);
    }
  }
  // Visibilidade: perguntas do payload que NÃO bateram com nenhuma chave do CAMPO_MAP são
  // descartadas silenciosamente. Se o texto de uma pergunta mudar no formulário, isso avisa
  // (senão o campo viraria null pra todos sem ninguém perceber).
  if (naoMapeadas.length) {
    logger.warn("aplicacao", "Perguntas do formulário SEM mapeamento (campo será descartado):", naoMapeadas);
  }
  // Campos esperados que não vieram no payload (lead deixou em branco ou pergunta ausente).
  const faltando = [...COLUNAS_VALIDAS].filter(c => !(c in resultado));
  if (faltando.length) {
    logger.info("aplicacao", "Campos do formulário ausentes no payload (não respondidos):", faltando);
  }
  return resultado;
}

export const aplicacaoRouter = new Elysia()
  .post("/webhook/cadastrar-lead-formulario-mentoria", async ({ body }) => {
    registrarWebhook("/webhook/cadastrar-lead-formulario-mentoria", body, "recebido");

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
  logger.debug("aplicacao", `Iniciando lançamento no Chatwoot — nome: ${d.nome_completo}, whatsapp: ${d.whatsapp}, email: ${d.email}`);

  // Formata o número de telefone para E.164
  const telefoneRaw = d.whatsapp ?? "";
  const telefone = telefoneRaw.replace(/\D/g, "");
  const phoneE164 = telefone ? `+${telefone.startsWith("55") ? telefone : `55${telefone}`}` : undefined;
  logger.debug("aplicacao", `Telefone formatado: raw="${telefoneRaw}" limpo="${telefone}" E.164="${phoneE164}"`);

  // Verifica se contato já existe pelo telefone ou email
  let contatoId: number | null = null;
  let contatoExistente: Awaited<ReturnType<typeof buscarContatoPorQuery>> = null;
  const queryBusca = phoneE164 ?? d.email ?? d.nome_completo;
  if (queryBusca) {
    contatoExistente = await buscarContatoPorQuery(accountId, queryBusca);
    if (contatoExistente) {
      contatoId = contatoExistente.id;
      logger.info("aplicacao", "Contato já existe no Chatwoot:", contatoId);
    }
  }

  // Atributos do formulário para salvar no contato
  const atributosFormulario = {
    ...(d.concurso_desejado   ? { qual_concurso: d.concurso_desejado } : {}),
    ...(d.area_graduacao      ? { qual_formacao: d.area_graduacao } : {}),
    ...(d.maior_dificuldade   ? { maior_dificuldade: d.maior_dificuldade } : {}),
    ...(d.expectativa_mentoria ? { espera_da_mentoria: d.expectativa_mentoria } : {}),
    ...(d.nivel_concurseiro   ? { nivel_concurseiro: d.nivel_concurseiro } : {}),
    ...(d.motivo_mentoria     ? { motivo_mentoria: d.motivo_mentoria } : {}),
    ...(d.disposto_investir   ? { disposto_investir: d.disposto_investir } : {}),
    ...(d.pronto_para_garantir ? { pronto_para_garantir: d.pronto_para_garantir } : {}),
    ...(d.ja_foi_aluno        ? { ja_foi_aluno: d.ja_foi_aluno } : {}),
  };

  // Cria contato se não existir, ou atualiza atributos do existente
  if (!contatoId) {
    const novoContato = await criarContato(accountId, {
      name: d.nome_completo!,
      ...(phoneE164 ? { phone_number: phoneE164 } : {}),
      ...(d.email ? { email: d.email } : {}),
      custom_attributes: atributosFormulario,
    });
    contatoId = novoContato.id;
    logger.info("aplicacao", "Contato criado no Chatwoot:", contatoId);
  } else {
    // Contato pré-existente (criado antes, ex.: pelo Chatwoot a partir do WhatsApp). Atualiza os
    // atributos do formulário e, se o nome ficou como placeholder (o telefone / só dígitos / vazio),
    // corrige com o nome_completo do formulário. Sem isso, o contato fica com o telefone como nome
    // (bug da conv 4442 — contato "5521992887269" em vez de "Monique G H Ferraz").
    const dados: { name?: string; custom_attributes: Record<string, unknown> } = { custom_attributes: atributosFormulario };
    if (nomeEhPlaceholderContato(contatoExistente?.name) && d.nome_completo) {
      dados.name = d.nome_completo;
      logger.info("aplicacao", `Corrigindo nome placeholder do contato ${contatoId}: "${contatoExistente?.name}" -> "${d.nome_completo}"`);
    }
    await atualizarContatoDados(accountId, contatoId, dados);
    logger.info("aplicacao", `Contato atualizado (atributos${dados.name ? " + nome" : ""}):`, contatoId);
  }

  // Cria conversa na inbox comercial
  const conversa = await criarConversa(accountId, {
    inbox_id: env.CHATWOOT_INBOX_ID,
    contact_id: contatoId,
  });
  logger.info("aplicacao", "Conversa criada:", conversa.id);

  // Descrição no novo formato de 3 linhas
  const descricaoTarefa = montarDescricaoTarefa(d);

  // Cria task no Kanban na etapa "Novo Lead"
  const task = await criarKanbanTask(accountId, {
    board_id: KANBAN_BOARD_ID,
    board_step_id: KANBAN_STEP_NOVO_LEAD,
    title: d.nome_completo!,
    description: descricaoTarefa,
    conversation_id: conversa.id,
  });
  logger.info("aplicacao", "Kanban task criada:", task.id);

  // Monta lista de etiquetas dinâmicas com base nas respostas do formulário
  const etiquetas: string[] = [];

  // medico: formação em Medicina (excluindo Biomedicina e Medicina Veterinária)
  const area = (d.area_graduacao ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ehMedico = area.includes("medic") && !area.includes("biomedic") && !area.includes("veterin");
  if (ehMedico) etiquetas.push("medico");

  // agente-on é adicionado SEMPRE — a IA atende TODOS os leads novos, inclusive quando o
  // formulário vem incompleto (sem a resposta de "disposto a investir"). Antes o agente-on só
  // era aplicado nos branches sim/não, então aplicação incompleta (disposto_investir vazio)
  // ficava SEM automação (bug do contato Omilto, conv 4394).
  etiquetas.push("agente-on");

  // sim / nao: qualificação adicional pela disposição para investir (não gateia a automação)
  const disposto = (d.disposto_investir ?? "").toLowerCase();
  if (disposto.includes("sim") || disposto.includes("quero")) {
    etiquetas.push("sim");
  } else if (disposto.includes("nao") || disposto.includes("não") || disposto.includes("talvez")) {
    etiquetas.push("nao");
  }

  await adicionarEtiquetas(accountId, conversa.id, etiquetas);
  logger.info("aplicacao", "Etiquetas adicionadas:", etiquetas);

  // Registra conversa para o timer de template (5 minutos)
  logger.debug("aplicacao", `Registrando no timer de template: conversation_id=${conversa.id} account_id=${accountId} phone=${phoneE164 ?? "null"}`);
  // ON CONFLICT DO UPDATE reativa o timer quando o lead preenche a aplicação novamente
  // (o criarConversa reusa a mesma conversa, então a chave conversation_id colide).
  // Reseta template_enviado/criado_em para reengajar; o verificar-templates já protege
  // contra spam pulando o envio se o lead já tiver respondido (contarMensagensIncoming > 0).
  await pool.query(
    `INSERT INTO leads_template_pendente (conversation_id, account_id, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (conversation_id) DO UPDATE
       SET template_enviado = FALSE, criado_em = NOW(), phone = EXCLUDED.phone`,
    [conversa.id, Number(accountId), phoneE164 ?? null],
  );
  logger.info("aplicacao", "Lead registrado no timer de template");
}
