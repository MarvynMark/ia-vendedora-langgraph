// Boas-vindas do Walker (inbox #ALUNOS WALKER, número pessoal — baileys), com agendamento
// PERSISTIDO no banco (sobrevive a reinícios/deploys, ao contrário de setTimeout em memória).
//
// Fluxo: no pagamento, `agendarBoasVindasWalker` grava uma linha em boas_vindas_walker_pendente
// com agendado_para = agora + 15min. O cron `verificarBoasVindasWalkerPendentes` (index.ts, a cada
// 1 min) dispara os pendentes vencidos, mas SÓ dentro da janela 08h-20h (SP) — fora dela, espera
// a janela abrir sem precisar de um setTimeout longo e frágil.
import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";
import { criarConversa, enviarMensagem, enviarArquivo, reabrirConversa } from "../services/chatwoot.ts";
import { fetchComTimeout } from "./fetch-with-timeout.ts";
import { primeiroNomeSaudacao } from "./nome.ts";
import { VIDEO_BOAS_VINDAS_URL } from "../tools/enviar-video.ts";
import { logger } from "./logger.ts";

const INBOX_ALUNOS_WALKER = 15;
const DELAY_ENTRE_MSGS_MS = 30_000;        // 30s entre mensagens (ritmo de quem está digitando)
const DELAY_BOAS_VINDAS_WALKER_MIN = 15;   // dispara 15 min após o pagamento
const MAX_TENTATIVAS = 5;                   // dead-letter após 5 falhas de envio
// URL permanente MinIO — não usar pre-signed URLs (expiram em horas)
const VIDEO_BOAS_VINDAS_WALKER_URL = "https://minio.stkd.site/api/v1/buckets/arquivosclientes/objects/download?preview=true&prefix=Vestigium%2Fvideo-walker-boas-vindas-novo-aluno.mp4";

function detectarGenero(primeiroNome: string): "m" | "f" | "?" {
  const nome = primeiroNome.toLowerCase().trim();
  if (!nome) return "?";
  // Nomes femininos que NÃO terminam em 'a' (senão cairiam como masculino por engano)
  const femininas = new Set([
    "beatriz", "raquel", "ester", "esther", "isabel", "isabelle", "miriam", "míriam", "ruth", "rachel",
    "íris", "iris", "inês", "ines", "mercedes", "lourdes", "solange", "denise", "elaine", "simone", "ivone",
    "viviane", "luciane", "eliane", "cristiane", "adriane", "ariane", "fabiane", "juliane", "tatiane",
    "rosane", "roseane", "silvane", "susane", "josiane", "gabriele", "michele", "daniele", "caroline",
    "alice", "dulce", "meire", "eloíse", "heloíse", "sarah", "abigail", "jael", "sol",
    // terminados em y/i (femininos comuns no BR)
    "marjory", "kelly", "nataly", "sthefany", "emily", "hanny", "mary", "gaby", "any", "dany", "fanny",
    "jenny", "sthefani", "kamili", "emilli", "jheni", "evelyn", "jaqueline", "jacqueline", "nicole",
    "helen", "hellen", "karen", "karin", "liz", "mel", "flor",
  ]);
  // Nomes masculinos que terminam em 'a' — exceções à regra geral
  const masculinas = new Set(["luca", "elias", "tobias", "matias", "thomas", "barba", "sousa", "josua", "noa"]);
  if (femininas.has(nome)) return "f";
  if (masculinas.has(nome)) return "m";
  if (nome.endsWith("a")) return "f";   // terminado em "a" → feminino confiável no BR
  if (nome.endsWith("o")) return "m";   // terminado em "o" → masculino confiável no BR
  return "?";                           // e/i/y/consoante fora das listas → incerto: NÃO arriscar Dr./Dra.
}

// Persiste o agendamento no banco. Chamado no fluxo de pagamento; sobrevive a reinícios.
export async function agendarBoasVindasWalker(
  accountId: number,
  contatoId: number,
  nomeAluno: string,
  customAttributes: Record<string, unknown> = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO boas_vindas_walker_pendente (account_id, contact_id, nome_aluno, custom_attributes, agendado_para)
       VALUES ($1, $2, $3, $4::jsonb, NOW() + ($5 || ' minutes')::interval)`,
      [accountId, contatoId, nomeAluno, JSON.stringify(customAttributes ?? {}), DELAY_BOAS_VINDAS_WALKER_MIN],
    );
    logger.info("bv-walker", `Boas-vindas Walker agendada (contato ${contatoId}, ${nomeAluno}, +${DELAY_BOAS_VINDAS_WALKER_MIN}min)`);
  } catch (e) {
    logger.error("bv-walker", "Erro ao agendar boas-vindas Walker no banco:", e);
  }
}

// Envia a sequência de fato (criar conversa + 3 msgs + 2 vídeos + aviso ao grupo). Lança em falha
// crítica (falha ao criar conversa) para o cron contar como tentativa.
async function enviarBoasVindasWalker(
  accountId: number,
  contatoId: number,
  nomeAluno: string,
  customAttributes: Record<string, unknown>,
): Promise<void> {
  logger.info("bv-walker", "Enviando boas-vindas do Walker (inbox #ALUNOS WALKER) para:", nomeAluno);

  let conversationId: number;
  try {
    const conversa = await criarConversa(accountId, { inbox_id: INBOX_ALUNOS_WALKER, contact_id: contatoId });
    conversationId = conversa.id;
  } catch (e) {
    logger.error("bv-walker", "Erro ao criar conversa no inbox ALUNOS WALKER:", e);
    throw e; // falha crítica: deixa o cron registrar a tentativa e reprocessar depois
  }

  const primeiroNome = primeiroNomeSaudacao(nomeAluno);
  const genero = detectarGenero(primeiroNome);
  const isMedico = String(customAttributes.qual_formacao ?? "").toLowerCase().includes("medicina");
  // Dr./Dra. só para médicos, com nome válido E gênero CERTO. Na dúvida ("?"), não arrisca.
  const tratamento = (isMedico && primeiroNome && genero !== "?") ? (genero === "f" ? "Dra. " : "Dr. ") : "";
  const nomeFormatado = primeiroNome ? `${tratamento}${primeiroNome}` : "";
  const saudacao = nomeFormatado ? `Oi ${nomeFormatado}!` : "Oi!";
  const espera = () => new Promise(r => setTimeout(r, DELAY_ENTRE_MSGS_MS));

  try {
    await enviarMensagem(accountId, conversationId, `${saudacao} É o Walker de novo, agora te falando do meu número pessoal. É por aqui que vou te acompanhar mais de perto agora que você tá oficialmente na mentoria.`);
  } catch (e) { logger.error("bv-walker", "Erro ao enviar msg 1:", e); }
  await espera();

  try {
    await enviarMensagem(accountId, conversationId, `Quero te dar as boas-vindas de verdade à Vestigium. Fico muito feliz de ter você comigo nessa caminhada rumo à sua aprovação. 🚀`);
  } catch (e) { logger.error("bv-walker", "Erro ao enviar msg 2:", e); }
  await espera();

  try {
    await enviarMensagem(accountId, conversationId, `Pra gente começar com o pé direito, gravei um vídeo rápido com 3 recados importantes desse seu início na mentoria. Assiste com calma e, o que precisar, é só me chamar por aqui, combinado?`);
  } catch (e) { logger.error("bv-walker", "Erro ao enviar msg 3:", e); }
  await espera();

  // Vídeo do celular do Walker
  try {
    const res = await fetchComTimeout(VIDEO_BOAS_VINDAS_WALKER_URL, { method: "GET", timeout: 60_000 });
    if (!res.ok) throw new Error(`Download do vídeo falhou: ${res.status}`);
    await enviarArquivo(accountId, conversationId, new Uint8Array(await res.arrayBuffer()), "video-walker-boas-vindas.mp4", "video/mp4");
  } catch (e) {
    logger.error("bv-walker", "Erro ao enviar vídeo Walker:", e);
    try { await enviarMensagem(accountId, conversationId, `Acesse diretamente por esse link:\n${VIDEO_BOAS_VINDAS_WALKER_URL}`); } catch { /* noop */ }
  }
  await espera();

  // Vídeo de onboarding da plataforma
  try {
    const res = await fetchComTimeout(VIDEO_BOAS_VINDAS_URL, { method: "GET", timeout: 60_000 });
    if (!res.ok) throw new Error(`Download do vídeo de onboarding falhou: ${res.status}`);
    await enviarArquivo(accountId, conversationId, new Uint8Array(await res.arrayBuffer()), "onboarding-plataforma.mp4", "video/mp4");
  } catch (e) {
    logger.error("bv-walker", "Erro ao enviar vídeo de onboarding:", e);
    try { await enviarMensagem(accountId, conversationId, `Acesse diretamente por esse link:\n${VIDEO_BOAS_VINDAS_URL}`); } catch { /* noop */ }
  }

  // Avisa o grupo que a boas-vindas do Walker foi enviada.
  try {
    await enviarMensagem(accountId, env.CHATWOOT_ALERT_CONVERSATION_ID, `✅ Boas-vindas do Walker enviada para: ${nomeAluno}`);
    await reabrirConversa(accountId, env.CHATWOOT_ALERT_CONVERSATION_ID);
  } catch (e) { logger.warn("bv-walker", "Falha ao avisar grupo sobre boas-vindas Walker:", e); }
}

// Cron: dispara os pendentes vencidos, SÓ dentro da janela 08h-20h (SP). Roda a cada 1 min.
export async function verificarBoasVindasWalkerPendentes(): Promise<void> {
  if (env.MODO_TESTE) return;
  // Janela 08h-20h (SP): fora dela, não envia agora — o próprio pendente dispara quando abrir.
  const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
  const hora = new Date(Date.now() + SP_OFFSET_MS).getUTCHours();
  if (hora < 8 || hora >= 20) return;

  let rows: Array<{ id: number; account_id: number; contact_id: number; nome_aluno: string; custom_attributes: Record<string, unknown> | null }> = [];
  try {
    const r = await pool.query(
      `SELECT id, account_id, contact_id, nome_aluno, custom_attributes
       FROM boas_vindas_walker_pendente
       WHERE enviado = FALSE AND tentativas < $1 AND agendado_para <= NOW()
       ORDER BY agendado_para LIMIT 5`,
      [MAX_TENTATIVAS],
    );
    rows = r.rows;
  } catch (e) {
    logger.error("bv-walker", "Erro ao buscar boas-vindas Walker pendentes:", e);
    return;
  }

  for (const row of rows) {
    try {
      await enviarBoasVindasWalker(row.account_id, row.contact_id, row.nome_aluno, row.custom_attributes ?? {});
      await pool.query(`UPDATE boas_vindas_walker_pendente SET enviado = TRUE WHERE id = $1`, [row.id]);
      logger.info("bv-walker", `Boas-vindas Walker enviada (pendente ${row.id}, ${row.nome_aluno})`);
    } catch (e) {
      await pool.query(`UPDATE boas_vindas_walker_pendente SET tentativas = tentativas + 1 WHERE id = $1`, [row.id]).catch(() => {});
      logger.error("bv-walker", `Falha no envio da boas-vindas pendente ${row.id} (tentativa registrada):`, e);
    }
  }
}
