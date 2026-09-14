// Grade das sessões estratégicas. Portada do ia-clinica-theodoro (config/agenda.ts), com a
// diferença que aqui são DUAS agendas (Gusthavo e Pedro) em vez de uma.
//
// Definida pelo Gusthavo em 10/09/2026: segunda a sexta, 9h às 21h, blocos de 1 hora,
// almoço bloqueado das 12h às 13h.
//
// A grade é DELIBERADAMENTE larga. Não existe teto semanal em código: o Gusthavo e o Pedro
// fecham na própria agenda os horários em que não podem atender, e o que sobrar é o que a IA
// oferece. Quem limita é a agenda real, não uma constante aqui.

/** Duração do bloco reservado na agenda. */
export const DURACAO_SESSAO_MIN = 60;

/**
 * Duração ANUNCIADA ao lead. Menor que o bloco de propósito: o bloco de 1h é folga para a
 * conversa passar do tempo sem atropelar a próxima. Prometer 30 e levar 55 queima a primeira
 * impressão, então o roteiro fala em "uns 40 minutos" — o que sobra é margem, não promessa.
 */
export const DURACAO_ANUNCIADA_MIN = 40;

/**
 * Antecedência mínima. ZERO dias de propósito: latência mata momentum. Hoje o lead compra às 23h
 * de domingo; a call já insere atraso, e oferecer "terça" numa sexta perde gente. Se houver vaga
 * hoje, oferece hoje — respeitado o intervalo mínimo abaixo.
 */
export const ANTECEDENCIA_MINIMA_DIAS = 0;

/** Mas nunca daqui a 10 minutos: o lead precisa de tempo para se organizar. */
export const ANTECEDENCIA_MINIMA_MIN = 90;

/** Até quantos dias à frente procurar vaga. */
export const DIAS_A_FRENTE = 14;

/** Quantos horários oferecer por vez. DOIS: escolha fechada converte melhor que cardápio. */
export const MAX_OFERTAS = 2;

/**
 * Antecedência mínima para desmarcar ou remarcar, em horas.
 *
 * Não é burocracia: é o compromisso que faz a pessoa aparecer. Vaga sem custo de desistência é
 * vaga que fica vazia, e cada cadeira vazia é uma hora de closer que não volta.
 *
 * A IA NUNCA abre exceção — ela escala para um humano. Se a IA remarcasse sozinha, a regra viraria
 * teatro e o lead descobriria na primeira tentativa. Se recusasse sozinha, o negócio perderia
 * vendas que uma pessoa recuperaria com uma frase. A exceção existe, só não é decisão de robô.
 */
export const PRAZO_REMARCACAO_H = 3;

/**
 * Grade por dia da semana (0=domingo … 6=sábado). O 12h não existe na lista — é o almoço.
 * Fim de semana fora: sessão é trabalho, e closer cansado fecha mal.
 */
const EXPEDIENTE = [
  "09:00", "10:00", "11:00",                     // manhã
  "13:00", "14:00", "15:00", "16:00", "17:00",   // tarde (12h é almoço)
  "18:00", "19:00", "20:00", "21:00",            // noite
] as const;

export const GRADE_SESSAO: Readonly<Record<number, readonly string[]>> = {
  0: [],          // domingo
  1: EXPEDIENTE,  // segunda
  2: EXPEDIENTE,  // terça
  3: EXPEDIENTE,  // quarta
  4: EXPEDIENTE,  // quinta
  5: EXPEDIENTE,  // sexta
  6: [],          // sábado
};

export function ehDiaDeAtendimento(data: Date): boolean {
  return (GRADE_SESSAO[data.getDay()] ?? []).length > 0;
}

/** Rótulo humano do dia, para a IA escrever "terça (16/09)". */
export function rotularDia(data: Date): string {
  const nomes = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const { mes0, dia, diaSemana } = dataDeParedeSP(data);
  return `${nomes[diaSemana]} (${String(dia).padStart(2, "0")}/${String(mes0 + 1).padStart(2, "0")})`;
}

/** Rótulo humano da hora: "14h" em vez de "14:00" — é como se fala no WhatsApp. */
export function rotularHora(data: Date): string {
  const sp = new Date(data.getTime() + SP_OFFSET_MS);
  const h = sp.getUTCHours(), m = sp.getUTCMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Capacidade teórica da grade, por semana. Só para conferência — quem limita é a agenda real. */
export const SLOTS_POR_SEMANA_POR_PESSOA = EXPEDIENTE.length * 5;

/**
 * Período do dia que o lead prefere. Perguntar isso ANTES de oferecer horário evita o pior
 * desperdício da conversa: sugerir 10h para quem só pode à noite, ouvir "não posso" e ter que
 * recomeçar. Uma pergunta de três opções custa um turno e salva vários.
 */
export type Preferencia = "manha" | "tarde" | "noite" | "qualquer";

const FAIXAS: Record<Exclude<Preferencia, "qualquer">, [number, number]> = {
  manha: [0, 11],    // até 11h59 — o 12h não existe na grade
  tarde: [13, 17],
  noite: [18, 23],
};

/** O horário cai no período que o lead pediu? */
export function atendePreferencia(data: Date, pref: Preferencia): boolean {
  if (pref === "qualquer") return true;
  const [min, max] = FAIXAS[pref];
  const h = horaDeParedeSP(data);
  return h >= min && h <= max;
}

/** Classifica o que o lead escreveu. `null` = não deu para saber, aí pergunte de novo. */
export function classificarPreferencia(texto: string): Preferencia | null {
  const t = (texto ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // "qualquer" primeiro: "qualquer horario de manha" é preferência de manhã, mas "tanto faz" não.
  if (/tanto faz|qualquer (um|hora|horario)?$|pode ser qualquer|indiferente|voce escolhe|vc escolhe/.test(t)) return "qualquer";
  if (/manha|de manha|cedo|antes do almoco/.test(t)) return "manha";
  if (/tarde|depois do almoco/.test(t)) return "tarde";
  if (/noite|a noite|fim do dia|depois do trabalho|depois das 18|apos as 18/.test(t)) return "noite";
  return null;
}

// ── Helpers de hora de parede (America/Sao_Paulo) ────────────────────────────────────────────
// Mesma convenção do lib/horario-comercial.ts: SP = UTC − 3h. Duplicado aqui de propósito para
// este módulo continuar PURO (sem depender de nada que faça rede), que é o que permite testar o
// miolo do agendamento — onde mora o risco de oferecer horário ocupado — sem mock nenhum.
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

export function instanteDeParedeSP(ano: number, mes0: number, dia: number, hora: number, minuto = 0): Date {
  return new Date(Date.UTC(ano, mes0, dia, hora, minuto) - SP_OFFSET_MS);
}

export function dataDeParedeSP(date: Date): { ano: number; mes0: number; dia: number; diaSemana: number } {
  const sp = new Date(date.getTime() + SP_OFFSET_MS);
  return { ano: sp.getUTCFullYear(), mes0: sp.getUTCMonth(), dia: sp.getUTCDate(), diaSemana: sp.getUTCDay() };
}

export function horaDeParedeSP(date: Date): number {
  return new Date(date.getTime() + SP_OFFSET_MS).getUTCHours();
}

// ── Código do horário que a IA devolve ao confirmar ──────────────────────────────────────────
// É hora DE PAREDE ("2026-09-14 14:00"), nunca ISO em UTC. O ISO com "Z" era o formato antigo e
// foi a causa de duas sessões erradas em 11/09 (conv 7436 e 7261): a sugestão dizia "14h |
// iso: 2026-09-14T17:00:00.000Z", o modelo "traduziu" e devolveu "2026-09-14T14:00:00.000Z" —
// que é 11h de Brasília. O modelo pensa em hora local; o código tem que falar a língua dele,
// senão a conversão vira ponto de falha em toda confirmação.

/** "2026-09-14 14:00" — o que a IA copia da sugestão e devolve na confirmação. */
export function codigoDoHorario(data: Date): string {
  const sp = new Date(data.getTime() + SP_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${sp.getUTCFullYear()}-${p(sp.getUTCMonth() + 1)}-${p(sp.getUTCDate())} ${p(sp.getUTCHours())}:${p(sp.getUTCMinutes())}`;
}

/**
 * Lê o código de volta. Aceita só hora de parede sem fuso ("2026-09-14 14:00" ou com "T").
 * Qualquer coisa com "Z" ou offset é recusada de propósito: é exatamente o formato em que o
 * modelo erra. `null` = formato inválido, peça a sugestão de novo.
 */
export function lerCodigoDoHorario(texto: string): Date | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*$/.exec(texto ?? "");
  if (!m) return null;
  const [, ano, mes, dia, hora, minuto] = m.map(Number) as [unknown, number, number, number, number, number];
  const data = instanteDeParedeSP(ano, mes - 1, dia, hora, minuto);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Todos os horários da grade naquele dia, como instantes. */
export function slotsDoDia(data: Date): Date[] {
  const { ano, mes0, dia, diaSemana } = dataDeParedeSP(data);
  return (GRADE_SESSAO[diaSemana] ?? []).map((hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return instanteDeParedeSP(ano, mes0, dia, h!, m!);
  });
}
