// Cadência de lembretes da sessão estratégica: 24h antes, 1h antes e resgate de no-show.
//
// A AGENDA é a fonte da verdade, não o Kanban — mesma correção que a Clínica Theodoro precisou
// fazer. Se alguém remarcar ou cancelar direto no Google Agenda, os lembretes acompanham sozinhos;
// amarrar no card faria o sistema mandar "te espero às 19h" para uma sessão que já mudou.
//
// Por que isso não é enfeite: o no-show é o vazamento NOVO deste funil. No funil antigo o lead
// sumia depois do preço; aqui ele some na cadeira vazia. Sem lembrete, o piloto mede errado — a
// gente não saberia se a call não converte ou se ninguém apareceu.

import { logger } from "./logger.ts";
import { env } from "../config/env.ts";
import { primeiroNomeSaudacao } from "./nome.ts";
import { PRAZO_REMARCACAO_H, rotularDia, rotularHora } from "../config/agenda.ts";
import {
  agendaConfigurada,
  listarSessoes,
  lembreteJaEnviado,
  marcarLembrete,
  type MarcaLembrete,
} from "../services/google-calendar.ts";
import { enviarMensagem, enviarTemplate } from "../services/chatwoot.ts";
import { CONTEUDO_TEMPLATES } from "./templates.ts";

const MIN_MS = 60 * 1000;
const HORA_MS = 60 * MIN_MS;

/**
 * Templates da Meta que esta cadência precisa. Lembrete quase sempre cai FORA da janela de 24h
 * (o lead agendou ontem, o lembrete é hoje), então texto livre não sai — quem entrega é a Meta.
 * Enquanto não estiverem aprovados e sincronizados no Chatwoot, o envio ao lead é substituído por
 * um aviso ao comercial, para uma pessoa cutucar à mão em vez de o lembrete sumir em silêncio.
 */
export const TEMPLATES_SESSAO: Record<Exclude<MarcaLembrete, never>, string> = {
  lembrete24h: "sessao_lembrete_24h",
  lembrete1h: "sessao_lembrete_1h",
  resgate: "sessao_resgate_noshow",
};

function templateDisponivel(nome: string): boolean {
  return Boolean(CONTEUDO_TEMPLATES[nome]);
}

async function avisarComercial(texto: string): Promise<void> {
  const conversa = env.CHATWOOT_COMERCIAL_CONVERSATION_ID;
  if (!conversa) return;
  try {
    await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, conversa, texto);
  } catch (e) {
    logger.error("lembretes-sessao", "Falha ao avisar o comercial", e);
  }
}

interface Sessao {
  calendarId: string;
  idEvento: string;
  inicio: Date;
  fim: Date;
  nomeLead: string;
  telefone: string;
  idConversa: string;
  meet: string;
  atendente: string;
}

async function disparar(s: Sessao, marca: MarcaLembrete, texto: string): Promise<void> {
  // Marca ANTES de enviar: cair no meio e não mandar é melhor que mandar duas vezes.
  await marcarLembrete(s.calendarId, s.idEvento, marca);

  const template = TEMPLATES_SESSAO[marca];
  if (!templateDisponivel(template)) {
    logger.warn("lembretes-sessao", `Template "${template}" não existe — avisando o comercial`, { telefone: s.telefone });
    await avisarComercial(
      `⏰ LEMBRETE MANUAL (template "${template}" ainda não aprovado)\n` +
        `${s.nomeLead} — sessão ${rotularDia(s.inicio)} às ${rotularHora(s.inicio)} com ${s.atendente}\n` +
        `${s.meet}\nMande você: ${texto}`,
    );
    return;
  }

  if (!s.idConversa) {
    logger.error("lembretes-sessao", "Sessão sem idConversa — não dá para enviar", { idEvento: s.idEvento });
    return;
  }
  await enviarTemplate(env.CHATWOOT_ACCOUNT_ID, s.idConversa, template, texto, {
    "1": primeiroNomeSaudacao(s.nomeLead, "tudo bem"),
  });
  logger.info("lembretes-sessao", `${marca} enviado`, { telefone: s.telefone, idEvento: s.idEvento });
}

function extrair(item: Awaited<ReturnType<typeof listarSessoes>>[number]): Sessao | null {
  const e = item.evento;
  const priv = e.extendedProperties?.private ?? {};
  if (!e.id || !e.start?.dateTime || !e.end?.dateTime) return null;
  if (!priv["telefone"]) return null; // não foi a IA que criou — compromisso pessoal, ignora
  return {
    calendarId: item.calendarId,
    idEvento: e.id,
    inicio: new Date(e.start.dateTime),
    fim: new Date(e.end.dateTime),
    nomeLead: (e.summary ?? "").replace(/^Sessão estratégica — /, "").trim(),
    telefone: priv["telefone"]!,
    idConversa: priv["idConversa"] ?? "",
    meet: e.hangoutLink ?? "",
    atendente: item.nomeAtendente,
  };
}

/**
 * Uma passada da cadência. Chamada por cron.
 *
 * As janelas são largas de propósito (não "exatamente 24h antes"): o cron pode atrasar, o processo
 * pode reiniciar. Quem garante o envio único é a marca no evento, não a precisão do relógio.
 */
export async function verificarLembretesSessao(agora = new Date()): Promise<void> {
  if (!agendaConfigurada()) return;

  try {
    // De 6h atrás (para pegar no-show) até 26h à frente (para pegar o lembrete de 24h).
    const itens = await listarSessoes(new Date(agora.getTime() - 6 * HORA_MS), new Date(agora.getTime() + 26 * HORA_MS));

    for (const item of itens) {
      const s = extrair(item);
      if (!s) continue;
      const faltam = s.inicio.getTime() - agora.getTime();
      const passou = agora.getTime() - s.fim.getTime();

      // 24h antes — entre 22h e 26h de antecedência.
      if (faltam > 22 * HORA_MS && faltam <= 26 * HORA_MS && !lembreteJaEnviado(item.evento, "lembrete24h")) {
        await disparar(s, "lembrete24h",
          `Oi, ${primeiroNomeSaudacao(s.nomeLead, "tudo bem")}! Passando pra confirmar nossa conversa de amanhã, ${rotularHora(s.inicio)}. ` +
          `Tá de pé pra você? Se precisar mudar, me avisa até ${PRAZO_REMARCACAO_H}h antes que eu consigo remanejar.`);
        // O lembrete de 24h é o momento CERTO de lembrar do combinado: ainda dá tempo de remarcar
        // dentro do prazo. Cobrar isso 1h antes seria cobrar quando a pessoa já não pode cumprir.
        continue;
      }

      // 1h antes — entre 40 e 80 minutos. Aqui o link vai de novo: é o que mais reduz no-show.
      if (faltam > 40 * MIN_MS && faltam <= 80 * MIN_MS && !lembreteJaEnviado(item.evento, "lembrete1h")) {
        await disparar(s, "lembrete1h",
          `${primeiroNomeSaudacao(s.nomeLead, "Opa")}, nossa conversa é daqui a pouco, ${rotularHora(s.inicio)}. ` +
          `É por aqui: ${s.meet}. Te espero!`);
        continue;
      }

      // Resgate — 2h depois do fim. Não sabemos se apareceu; quem sabe é quem atendeu, e o sinal
      // disso é o card ter saído de "Sessão agendada". Por isso o resgate vai ao COMERCIAL, não
      // ao lead: mandar "não te encontrei" para quem compareceu é pior que não mandar nada.
      if (passou > 2 * HORA_MS && passou <= 8 * HORA_MS && !lembreteJaEnviado(item.evento, "resgate")) {
        await marcarLembrete(s.calendarId, s.idEvento, "resgate");
        await avisarComercial(
          `📋 SESSÃO ENCERRADA — ${s.nomeLead} (${s.telefone}), ${rotularDia(s.inicio)} ${rotularHora(s.inicio)}, com ${s.atendente}\n` +
            `Compareceu? Mova o card. Se foi no-show, responda aqui que eu ofereço remarcar.`,
        );
      }
    }
  } catch (e) {
    logger.error("lembretes-sessao", "Falha na varredura", e);
  }
}
