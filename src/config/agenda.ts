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
  const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${dias[data.getDay()]} (${dia}/${mes})`;
}

/** Rótulo humano da hora: "14h" em vez de "14:00" — é como se fala no WhatsApp. */
export function rotularHora(data: Date): string {
  const h = data.getHours();
  const m = data.getMinutes();
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
  const h = data.getHours();
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
