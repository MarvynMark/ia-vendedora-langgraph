// Decide QUAIS horários oferecer ao lead e DE QUEM é a agenda.
//
// Portado do ia-clinica-theodoro (lib/disponibilidade.ts), com a diferença que aqui existem DUAS
// agendas (Gusthavo e Pedro) em vez de uma. Isso muda a pergunta: não é só "o horário está livre?",
// é "está livre para quem?".
//
// Módulo PURO de propósito: recebe os eventos já buscados em vez de ir ao Google. É onde mora o
// risco de oferecer horário ocupado, então precisa rodar em teste sem rede.

import {
  DIAS_A_FRENTE,
  DURACAO_SESSAO_MIN,
  MAX_OFERTAS,
  ANTECEDENCIA_MINIMA_MIN,
  atendePreferencia,
  dataDeParedeSP,
  instanteDeParedeSP,
  slotsDoDia,
  type Preferencia,
} from "../config/agenda.ts";

const MIN_MS = 60 * 1000;
const DIA_MS = 24 * 60 * MIN_MS;

/** Intervalo ocupado numa agenda. `fim` é exclusivo, como no Google Calendar. */
export interface Ocupado {
  inicio: Date;
  fim: Date;
}

/** A agenda de um atendente e o que já está marcado nela. */
export interface AgendaAtendente {
  /** Nome do atendente — só para log e para o card do Kanban; NUNCA é dito ao lead. */
  nome: string;
  calendarId: string;
  ocupados: readonly Ocupado[];
}

/** Um horário oferecível, já com dono definido. */
export interface SlotOferecivel {
  inicio: Date;
  calendarId: string;
  nome: string;
}

/** O slot colide com algum evento desta agenda? Overlap clássico. */
export function slotColide(slot: Date, ocupados: readonly Ocupado[], duracaoMin = DURACAO_SESSAO_MIN): boolean {
  const inicio = slot.getTime();
  const fim = inicio + duracaoMin * MIN_MS;
  return ocupados.some((o) => inicio < o.fim.getTime() && fim > o.inicio.getTime());
}

/**
 * Primeiro instante oferecível.
 *
 * Diferente da Theodoro, que só oferece a partir do dia seguinte: aqui o piso é em MINUTOS, não em
 * dias. Latência mata momentum — hoje o lead compra às 23h de domingo, e a call já insere atraso
 * por si só. Se tem vaga hoje às 16h e o lead falou às 10h, ele é oferecido hoje. Os 90 minutos
 * existem só para o lead conseguir se organizar.
 */
export function inicioDaJanela(agora: Date): Date {
  return new Date(agora.getTime() + ANTECEDENCIA_MINIMA_MIN * MIN_MS);
}

/** Quantas sessões esta agenda já tem naquele dia (hora de parede). */
function sessoesNoDia(dia: Date, ocupados: readonly Ocupado[]): number {
  const { ano, mes0, dia: d } = dataDeParedeSP(dia);
  const ini = instanteDeParedeSP(ano, mes0, d, 0, 0).getTime();
  const fim = ini + DIA_MS;
  return ocupados.filter((o) => o.inicio.getTime() < fim && o.fim.getTime() > ini).length;
}

/**
 * Quem atende este horário, quando mais de um está livre.
 *
 * Desempate em cascata: menos sessões NAQUELE DIA → menos sessões NO PERÍODO TODO → ordem da lista.
 *
 * O segundo critério não é firula. Só com o primeiro, duas agendas vazias empatam sempre e a ordem
 * da lista decide — o que dava TODOS os primeiros horários de TODOS os dias para o Gusthavo
 * (visto no teste ponta a ponta). Comparando também o total do período, quem acabou de receber uma
 * sessão perde o próximo empate, e a distribuição alterna sozinha.
 *
 * Não é concentração de agenda como na Theodoro — lá uma pessoa só prefere fechar uma tarde
 * inteira. Aqui são dois closers, e distribuir evita que um faça oito calls num dia enquanto o
 * outro faz uma. Closer cansado fecha mal.
 */
function escolherAtendente(slot: Date, candidatas: readonly AgendaAtendente[]): AgendaAtendente {
  return [...candidatas].sort((a, b) =>
    sessoesNoDia(slot, a.ocupados) - sessoesNoDia(slot, b.ocupados) ||
    a.ocupados.length - b.ocupados.length,
  )[0]!;
}

export interface OpcoesBusca {
  agora?: Date;
  preferencia?: Preferencia;
  /** Quantos horários devolver. Padrão: MAX_OFERTAS (dois). */
  limite?: number;
  diasAFrente?: number;
  /**
   * Um horário por dia, para o lead escolher entre DIAS diferentes. DESLIGADO por padrão desde
   * 13/09/2026: com ele ligado a segunda opção caía sempre no dia seguinte, e num domingo à noite
   * 5 de 5 leads escolheram a terça com a segunda cheia de buraco. Agora as duas opções vêm do
   * dia mais próximo ("segunda às 14h ou às 16h") e só pulam de dia quando ele não tem duas
   * vagas no período pedido. Latência mata momentum; quem tem o dia travado diz, e a IA sugere
   * de novo.
   */
  umPorDia?: boolean;
}

/**
 * Horários livres para oferecer, na ordem em que devem ser oferecidos.
 *
 * Ordem: mais próximo primeiro. Nada de "concentrar a agenda" — para este funil, atraso custa mais
 * do que buraco na agenda.
 *
 * Devolve MENOS que o limite quando não há vaga — a IA precisa distinguir "só tenho um" de "não
 * tenho nada" para falar a verdade em vez de insistir.
 */
export function slotsLivres(agendas: readonly AgendaAtendente[], opcoes: OpcoesBusca = {}): SlotOferecivel[] {
  const agora = opcoes.agora ?? new Date();
  const preferencia = opcoes.preferencia ?? "qualquer";
  const limite = opcoes.limite ?? MAX_OFERTAS;
  const diasAFrente = opcoes.diasAFrente ?? DIAS_A_FRENTE;
  const umPorDia = opcoes.umPorDia ?? false;
  const minimo = inicioDaJanela(agora).getTime();

  const oferecer: SlotOferecivel[] = [];

  for (let i = 0; i <= diasAFrente; i++) {
    const dia = new Date(agora.getTime() + i * DIA_MS);
    for (const slot of slotsDoDia(dia)) {
      if (slot.getTime() < minimo) continue;
      if (!atendePreferencia(slot, preferencia)) continue;

      const livres = agendas.filter((a) => !slotColide(slot, a.ocupados));
      if (livres.length === 0) continue;

      const dono = escolherAtendente(slot, livres);
      oferecer.push({ inicio: slot, calendarId: dono.calendarId, nome: dono.nome });
      if (oferecer.length >= limite) return oferecer;
      if (umPorDia) break; // o próximo vem de outro dia
    }
  }
  return oferecer;
}

/**
 * Aquele horário exato ainda está livre, e para quem?
 *
 * Guarda de corrida: entre a IA oferecer e o lead responder, o horário pode ter sido tomado.
 * Chamado SEMPRE antes de criar o evento. `null` = não dá mais.
 */
export function quemAtende(
  slot: Date,
  agendas: readonly AgendaAtendente[],
  agora = new Date(),
): AgendaAtendente | null {
  if (slot.getTime() < inicioDaJanela(agora).getTime()) return null;
  const daGrade = slotsDoDia(slot).some((s) => s.getTime() === slot.getTime());
  if (!daGrade) return null;
  const livres = agendas.filter((a) => !slotColide(slot, a.ocupados));
  return livres.length === 0 ? null : escolherAtendente(slot, livres);
}
