/**
 * Extrai as intervenções do Gusthavo e do Pedro nas conversas que viraram venda.
 *
 * Uso: bun run src/scripts/extrair-intervencoes.ts [desde=2026-07-01]
 *
 * Venda = atividade "<alguém> adicionou ... mentoria" (a etiqueta que o webhook de pagamento põe).
 * Só contam as mensagens humanas ANTES desse momento (até 14 dias antes): depois é boas-vindas e
 * suporte, e muito antes é outra compra.
 *
 * Cada intervenção é uma janela: contexto (até 6 mensagens), a fala do lead que a disparou, o
 * bloco do humano (até a próxima fala do lead) e a reação do lead. A saída vai para
 * dados-locais/intervencoes/ (fora do git: o repo é público e isso é conversa de lead) e alimenta
 * o destilar-intervencoes.ts.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { env } from "../config/env.ts";
import { listarConversasComLabel, listarTodasMensagens } from "../services/chatwoot.ts";

const ACCOUNT_ID = env.CHATWOOT_ACCOUNT_ID;
const ID_IA = Number(env.CHATWOOT_AGENT_USER_ID ?? 3);
// Quem fecha venda (decisão do Gusthavo, 03/10/2026): o resto da equipe é suporte.
const HUMANOS: Record<number, string> = { 1: "Gusthavo", 5: "Pedro" };
const DIR_SAIDA = "dados-locais/intervencoes";
// A etiqueta "mentoria" às vezes é readicionada meses depois (renovação, cobrança de aluno antigo):
// intervenção longe da venda não é a que vendeu.
const MAX_HORAS_ATE_VENDA = 14 * 24;

const RE_VENDA = /adicionou\b.*\bmentoria\b|added\b.*\bmentoria\b/i;
const RE_PRECO = /R\$\s?\d|\d+\s?x\s?(de\s)?R?\$?\s?\d|parcel|à vista|a vista/i;
const RE_FECHAMENTO = /https?:\/\/|\bpix\b|\bcupom\b|\blink\b|cart[ãa]o|boleto|checkout/i;

export interface Mensagem {
  id: number;
  content: string | null;
  message_type: number;
  created_at: number;
  private?: boolean;
  sender?: { id?: number; name?: string; type?: string } | null;
  content_attributes?: { deleted?: boolean };
  attachments?: Array<{ file_type?: string; transcribed_text?: string; data_url?: string }>;
}

export type Autor = "LEAD" | "IA" | "Gusthavo" | "Pedro" | "EQUIPE" | "INCERTO";

export interface Intervencao {
  conversa: number;
  autores: string[];
  fase: "antes_do_preco" | "pos_preco" | "fechamento";
  data: string;
  horas_ate_venda: number;
  contexto: string[];
  gatilho: string[];
  resposta: string[];
  reacao: string[];
}

export function autorDe(m: Mensagem): Autor | null {
  if (m.message_type === 0) return "LEAD";
  if (m.message_type !== 1 || m.private) return null; // atividade, template de sistema, nota interna
  const id = m.sender?.id;
  if (id === undefined || id === null) return "INCERTO"; // enviada do celular, sem autor no Chatwoot
  if (id === ID_IA) return "IA";
  return HUMANOS[id] ? (HUMANOS[id] as Autor) : "EQUIPE";
}

export function textoDe(m: Mensagem): string {
  const partes: string[] = [];
  if (m.content?.trim()) partes.push(m.content.trim());
  for (const a of m.attachments ?? []) {
    if (a.file_type === "audio") partes.push(a.transcribed_text?.trim() ? `[áudio] ${a.transcribed_text.trim()}` : "[áudio sem transcrição]");
    else if (a.file_type === "image") partes.push("[imagem]");
    else if (a.file_type === "video") partes.push("[vídeo]");
    else partes.push("[arquivo]");
  }
  return partes.join(" ");
}

const ehHumano = (a: Autor | null) => a === "Gusthavo" || a === "Pedro" || a === "INCERTO";
const linha = (a: Autor, m: Mensagem) => `${a}: ${textoDe(m).slice(0, 700)}`;

/** Recorta as intervenções humanas de uma conversa, só até o momento da venda. */
export function recortarIntervencoes(conversa: number, msgs: Mensagem[], tsVenda: number): Intervencao[] {
  const uteis = msgs
    .filter((m) => m.created_at <= tsVenda && !m.content_attributes?.deleted)
    .map((m) => ({ m, a: autorDe(m) }))
    .filter((x): x is { m: Mensagem; a: Autor } => x.a !== null && textoDe(x.m) !== "");

  const out: Intervencao[] = [];
  let precoJaApareceu = false;
  let i = 0;
  while (i < uteis.length) {
    const { m, a } = uteis[i]!;
    if (!ehHumano(a)) {
      if (a !== "LEAD" && RE_PRECO.test(textoDe(m))) precoJaApareceu = true;
      i++;
      continue;
    }
    // Bloco: do primeiro humano até a próxima fala do lead (inclui IA no meio, se houver).
    let fim = i;
    while (fim + 1 < uteis.length && uteis[fim + 1]!.a !== "LEAD") fim++;
    const bloco = uteis.slice(i, fim + 1);
    // Gatilho: a sequência de falas do lead logo antes do bloco.
    let iniGatilho = i;
    while (iniGatilho - 1 >= 0 && uteis[iniGatilho - 1]!.a === "LEAD" && i - iniGatilho < 4) iniGatilho--;
    const gatilho = uteis.slice(iniGatilho, i);
    const contexto = uteis.slice(Math.max(0, iniGatilho - 6), iniGatilho);
    const reacao = uteis.slice(fim + 1, fim + 4);

    const textoBloco = bloco.map((x) => textoDe(x.m)).join(" ");
    out.push({
      conversa,
      autores: [...new Set(bloco.filter((x) => ehHumano(x.a)).map((x) => x.a))],
      fase: RE_FECHAMENTO.test(textoBloco) ? "fechamento" : precoJaApareceu || RE_PRECO.test(textoBloco) ? "pos_preco" : "antes_do_preco",
      data: new Date(m.created_at * 1000).toISOString(),
      horas_ate_venda: Math.round(((tsVenda - m.created_at) / 3600) * 10) / 10,
      contexto: contexto.map((x) => linha(x.a, x.m)),
      gatilho: gatilho.map((x) => linha(x.a, x.m)),
      resposta: bloco.map((x) => linha(x.a, x.m)),
      reacao: reacao.map((x) => linha(x.a, x.m)),
    });
    if (RE_PRECO.test(textoBloco)) precoJaApareceu = true;
    i = fim + 1;
  }
  return out;
}

async function main() {
  const desdeIso = process.argv[2] ?? "2026-07-01";
  const desde = Date.parse(`${desdeIso}T00:00:00-03:00`) / 1000;

  const convs = await listarConversasComLabel(ACCOUNT_ID, "mentoria");
  const candidatas = convs.filter((c) => (c.last_activity_at ?? 0) >= desde);
  console.log(`[extrair] ${convs.length} conversas com "mentoria", ${candidatas.length} com atividade desde ${desdeIso}`);

  const intervencoes: Intervencao[] = [];
  const stats = {
    desde: desdeIso,
    conversas_analisadas: 0,
    sem_marca_de_venda: 0,
    venda_antes_do_periodo: 0,
    compradores: 0,
    compradores_com_intervencao: 0,
    por_autor: {} as Record<string, number>,
    por_fase: {} as Record<string, number>,
    audios_sem_transcricao: 0,
    erros: 0,
  };

  for (const [n, c] of candidatas.entries()) {
    if (n % 25 === 0) console.log(`[extrair] ${n}/${candidatas.length}`);
    let msgs: Mensagem[];
    try {
      msgs = await listarTodasMensagens<Mensagem>(ACCOUNT_ID, c.id);
    } catch (e) {
      stats.erros++;
      console.warn(`[extrair] conv ${c.id}: ${(e as Error).message}`);
      continue;
    }
    stats.conversas_analisadas++;
    const venda = msgs.find((m) => m.message_type === 2 && RE_VENDA.test(m.content ?? ""));
    if (!venda) { stats.sem_marca_de_venda++; continue; }
    if (venda.created_at < desde) { stats.venda_antes_do_periodo++; continue; }
    stats.compradores++;

    const daConversa = recortarIntervencoes(c.id, msgs, venda.created_at)
      .filter((it) => Date.parse(it.data) / 1000 >= desde && it.horas_ate_venda <= MAX_HORAS_ATE_VENDA);
    if (daConversa.length > 0) stats.compradores_com_intervencao++;
    for (const it of daConversa) {
      for (const a of it.autores) stats.por_autor[a] = (stats.por_autor[a] ?? 0) + 1;
      stats.por_fase[it.fase] = (stats.por_fase[it.fase] ?? 0) + 1;
      stats.audios_sem_transcricao += it.resposta.filter((l) => l.includes("[áudio sem transcrição]")).length;
    }
    intervencoes.push(...daConversa);
  }

  mkdirSync(DIR_SAIDA, { recursive: true });
  writeFileSync(`${DIR_SAIDA}/intervencoes.jsonl`, intervencoes.map((x) => JSON.stringify(x)).join("\n") + "\n");
  writeFileSync(`${DIR_SAIDA}/estatisticas.json`, JSON.stringify({ ...stats, intervencoes: intervencoes.length }, null, 2));
  console.log(JSON.stringify({ ...stats, intervencoes: intervencoes.length }, null, 2));
}

if (import.meta.main) await main();
