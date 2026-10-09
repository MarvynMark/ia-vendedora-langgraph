// Retorno combinado com o lead numa DATA (decisão do Gusthavo, 09/10/2026).
//
// Conv 9883: a lead disse "na próxima semana", a IA respondeu "então na próxima semana eu te
// chamo" e no dia seguinte saiu o PDF de "comprovante PIX". O antigo marcador "retomar:" só
// trocava o TEXTO do primeiro toque (e só com o contador em 0); a DATA continuava sendo a da
// cadência da etapa, então a régua inteira seguia como se nada tivesse sido combinado.
//
// Agora o combinado vira uma linha com data no card ("📅 - Retomar em: 13/10/2026 ..."), escrita
// pela tool Atualizar_tarefa a partir de uma data ISO validada aqui. O grafo de follow-up lê essa
// linha antes de qualquer toque: data no futuro → não manda nada e reagenda o card pra ela;
// data chegou → manda a retomada do combinado e segue com a cadência curta (sem os toques de
// curiosidade). Ficar no grafo, e não só no due_date, é de propósito: cinco caminhos recalculam o
// prazo pela etapa (guards do main-agent, webhook task_updated, cron) e passariam por cima.

const SP_OFFSET_MS = -3 * 60 * 60 * 1000; // São Paulo, UTC-3 fixo (ver horario-comercial.ts)
const DIA = 24 * 60 * 60 * 1000;
/** Mais longe que isso é "não agora" de verdade — vai pra Nutrir, não pra uma data. */
export const MAX_DIAS_RETOMADA = 120;
// Mesmo horário da reabertura da janela de follow-up (10:05): fora do lote das 08:20.
const HORA_RETOMADA_UTC = 13;
const MINUTO_RETOMADA = 5;

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** Linha do card. Tolerante a quem editou à mão ("retomar em 13/10/2026", sem emoji). */
const RE_LINHA_RETOMADA = /^[^\n]*retomar\s+em:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})[^\n]*$/im;
const RE_LINHAS_RETOMADA = new RegExp(RE_LINHA_RETOMADA.source, "gim");

export interface DiaSP { ano: number; mes: number; dia: number }

function diaSP(instante: Date): DiaSP {
  const sp = new Date(instante.getTime() + SP_OFFSET_MS);
  return { ano: sp.getUTCFullYear(), mes: sp.getUTCMonth() + 1, dia: sp.getUTCDate() };
}

/** Meia-noite UTC do dia civil — só para aritmética de dias e dia da semana. */
function chave(d: DiaSP): number {
  return Date.UTC(d.ano, d.mes - 1, d.dia);
}

function iso(d: DiaSP): string {
  return `${d.ano}-${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`;
}

function deChave(ms: number): DiaSP {
  const d = new Date(ms);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

/**
 * Instante em que a retomada sai: 10:05 de São Paulo no dia combinado. Domingo não tem
 * follow-up (horario-comercial.ts), então cai na segunda.
 */
export function momentoRetomada(d: DiaSP): Date {
  let ms = chave(d);
  if (new Date(ms).getUTCDay() === 0) ms += DIA;
  const alvo = deChave(ms);
  return new Date(Date.UTC(alvo.ano, alvo.mes - 1, alvo.dia, HORA_RETOMADA_UTC, MINUTO_RETOMADA));
}

/**
 * Valida a data que o LLM passou ("AAAA-MM-DD"). Precisa ser um dia real, depois de hoje
 * (em SP) e a no máximo MAX_DIAS_RETOMADA dias. Devolve o momento do disparo ou o erro, em
 * texto que a própria IA lê e corrige.
 */
export function validarRetomarEm(valor: string, agora = new Date()): { momento: Date; dia: DiaSP } | { erro: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((valor ?? "").trim());
  if (!m) return { erro: `retomarEm "${valor}" fora do formato AAAA-MM-DD.` };
  const dia = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
  if (iso(deChave(chave(dia))) !== iso(dia)) return { erro: `retomarEm "${valor}" não é uma data válida.` };
  const dias = Math.round((chave(dia) - chave(diaSP(agora))) / DIA);
  if (dias < 1) return { erro: `retomarEm "${valor}" precisa ser depois de hoje (${iso(diaSP(agora))}).` };
  if (dias > MAX_DIAS_RETOMADA) {
    return { erro: `retomarEm "${valor}" está a mais de ${MAX_DIAS_RETOMADA} dias. Isso é "não agora": mova para Nutrir em vez de marcar data.` };
  }
  return { momento: momentoRetomada(dia), dia };
}

/** Linha do card: "📅 - Retomar em: 13/10/2026 (seg) — vai decidir na próxima semana". */
export function linhaRetomada(dia: DiaSP, contexto = ""): string {
  const ds = DIAS_SEMANA[new Date(chave(dia)).getUTCDay()]!;
  const data = `${String(dia.dia).padStart(2, "0")}/${String(dia.mes).padStart(2, "0")}/${dia.ano}`;
  const ctx = contexto.replace(/\s+/g, " ").trim();
  return `📅 - Retomar em: ${data} (${ds})${ctx ? ` — ${ctx}` : ""}`;
}

/** Lê a retomada do card. null se não houver linha com data. */
export function lerRetomada(descricao: string): { momento: Date; linha: string } | null {
  const m = RE_LINHA_RETOMADA.exec(descricao ?? "");
  if (!m) return null;
  const dia = { ano: Number(m[3]), mes: Number(m[2]), dia: Number(m[1]) };
  if (iso(deChave(chave(dia))) !== iso(dia)) return null;
  return { momento: momentoRetomada(dia), linha: m[0].trim() };
}

export function removerRetomada(descricao: string): string {
  return (descricao ?? "").replace(RE_LINHAS_RETOMADA, "").replace(/\n{2,}/g, "\n").trim();
}

/**
 * Descrição final do card a partir do que o LLM escreveu:
 * - com data nova: troca qualquer linha de retomada pela canônica;
 * - sem data nova: preserva a do card (o LLM reescreve a descrição e costuma derrubar linhas).
 */
export function aplicarRetomada(descricaoNova: string, descricaoAtual: string, nova?: { dia: DiaSP; contexto?: string }): string {
  const base = removerRetomada(descricaoNova);
  const linha = nova ? linhaRetomada(nova.dia, nova.contexto) : lerRetomada(descricaoAtual)?.linha;
  if (!linha) return base;
  return base ? `${base}\n${linha}` : linha;
}

/**
 * Datas de referência para a IA não errar a conta do calendário. Vão na descrição da tool
 * (montada a cada turno), já resolvidas: "semana que vem" = segunda da próxima semana.
 */
export function datasReferenciaRetomada(agora = new Date()): string {
  const hoje = diaSP(agora);
  const kHoje = chave(hoje);
  const dow = new Date(kHoje).getUTCDay();
  const fmt = (d: DiaSP) => `${iso(d)} (${DIAS_SEMANA[new Date(chave(d)).getUTCDay()]})`;
  const amanha = deChave(kHoje + DIA);
  const proximaSegunda = deChave(kHoje + ((8 - dow) % 7 || 7) * DIA);
  const mesQueVem = hoje.mes === 12 ? { ano: hoje.ano + 1, mes: 1, dia: 1 } : { ano: hoje.ano, mes: hoje.mes + 1, dia: 1 };
  return [
    `hoje: ${fmt(hoje)}`,
    `amanhã: ${fmt(amanha)}`,
    `"semana que vem" / "próxima semana": ${fmt(proximaSegunda)}`,
    `"mês que vem": ${fmt(mesQueVem)}`,
  ].join(" | ");
}
