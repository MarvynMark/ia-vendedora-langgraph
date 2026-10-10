// Lista quente: quem o comercial humano deve chamar HOJE, em ordem de prioridade.
//
// Nasceu em scripts/leads-parados.ts (terminal + CSV); veio pra cá para o relatório diário do grupo
// do comercial usar a mesma varredura. As prioridades vêm da análise de 09/10/2026:
//   P1 agir agora     — o lead falou por último (até 30 dias) e ninguém respondeu (6 de 57 morreram
//                       assim), ou recebeu o link há menos de 48h e não pagou.
//   P2 combinado hoje — "Retomar em" do card venceu hoje ou ontem.
//   P3 objeção D+7    — travou no preço há 7 dias: hora do bônus/condição.
//   P4 janela         — ouviu o preço e está de 4 a 14 dias em silêncio: é quando os compradores
//                       que somem voltam (mediana 12,7 dias), e a régua automática já acabou.
// Desempate: "Imediatamente" no formulário (12,5% de conversão) > faixa "Até R$" (6-9%) > resto.

import { env } from "../config/env.ts";
import { listarKanbanTasks, listarMensagens, type KanbanTaskResumo } from "../services/chatwoot.ts";
import { lerRetomada } from "./retomada.ts";
import type { PerfilFormulario } from "../db/formulario.ts";

// Padrões do diagnóstico de ago/26, mais o 246 do Semestral Premium (que veio depois).
export const RE_PRECO = /R\$\s?(3\.997|3\.197|1\.997|997|394|315|246|197)/;
export const RE_SINAL = /(link|pix|pagar|pagamento|comprovante|paguei|cart[ãa]o|boleto|parcel)/i;
export const RE_LINK_PAGTO = /peritowalker\.com\.br\/(mentoria|medicolegista)/i;

export const STEP = {
  novoLead: 1,
  primeiraMensagem: 7,
  conexao: 10,
  sessaoAgendada: 89,
  aguardandoPagamento: 8,
  ganho: 9,
  perdido: 11,
  nutrir: 12,
} as const;

const DIA = 86_400_000;

// O endpoint de tasks ignora o filtro de step e devolve o board inteiro paginado — varremos tudo
// uma vez e filtramos em memória (mesmo padrão do relatorio-semanal.ts).
export async function varrerBoard(): Promise<KanbanTaskResumo[]> {
  const porId = new Map<number, KanbanTaskResumo>();
  for (let page = 1; page <= 400; page++) {
    let tasks: KanbanTaskResumo[] = [];
    for (let tent = 1; tent <= 3; tent++) {
      try {
        tasks = await listarKanbanTasks(env.CHATWOOT_ACCOUNT_ID, env.KANBAN_BOARD_ID, STEP.aguardandoPagamento, page);
        break;
      } catch (erro) {
        if (tent === 3) throw erro;
      }
    }
    for (const t of tasks) if (!porId.has(t.id)) porId.set(t.id, t);
    if (tasks.length === 0) break;
  }
  return [...porId.values()];
}

export type Analise = {
  chegouPreco: boolean;
  sinalCompra: boolean;
  linkEnviado: boolean;
  linkEnviadoEm: number | null;
  ultimaEhIa: boolean;
  ultimaEm: number;
  ultimaLead: string;
  /** A última fala do lead só encerra ("obrigada", "👍", reação) — não está esperando resposta. */
  ultimaLeadEncerra: boolean;
  telefone: string;
};

export type MensagemConversa = {
  message_type: number;
  created_at: number;
  content?: string | null;
  private?: boolean;
  content_attributes?: { is_reaction?: boolean } | null;
  sender?: { phone_number?: string | null } | null;
};

// No primeiro teste com dados reais (09/10) metade do "ninguém respondeu" era "Obrigada!", "❤️" e
// "👍": o lead fechando a conversa, não esperando a gente.
const RE_ENCERRAMENTO = /^(ok(ay)?|obrigad[oa]s?|obg|valeu|vlw|blz|beleza|show|certo|combinado|t[áa] (bom|certo)|perfeito|entendi|sim+( sim)*|ah?m[ée]m|de nada|igualmente)[\s!.,]*$/i;

export function falaSoEncerra(m: MensagemConversa | undefined): boolean {
  if (!m) return false;
  if (m.content_attributes?.is_reaction) return true;
  const t = (m.content ?? "").trim();
  if (!t) return true;
  if (!/[\p{L}\p{N}?]/u.test(t)) return true; // só emoji/pontuação
  return RE_ENCERRAMENTO.test(t.replace(/[^\p{L}\p{N}\s!.,]/gu, "").trim());
}

/** A parte pura da análise — testável sem rede. Ignora notas privadas (o lead não as vê). */
export function analisarMensagens(payload: MensagemConversa[]): Analise | null {
  const msgs = payload.filter((m) => (m.message_type === 0 || m.message_type === 1) && !m.private);
  if (msgs.length === 0) return null;

  const precoEm = msgs.find((m) => m.message_type === 1 && RE_PRECO.test(m.content ?? ""))?.created_at;
  const ultima = msgs[msgs.length - 1]!;
  const doLead = msgs.filter((m) => m.message_type === 0);
  const links = msgs.filter((m) => m.message_type === 1 && RE_LINK_PAGTO.test(m.content ?? ""));

  return {
    chegouPreco: precoEm !== undefined,
    sinalCompra: doLead.some(
      (m) => RE_SINAL.test(m.content ?? "") && (precoEm === undefined || m.created_at >= precoEm),
    ),
    linkEnviado: links.length > 0,
    linkEnviadoEm: links.length > 0 ? links[links.length - 1]!.created_at : null,
    ultimaEhIa: ultima.message_type === 1,
    ultimaEm: ultima.created_at,
    ultimaLead: (doLead[doLead.length - 1]?.content ?? "").replace(/\s+/g, " ").slice(0, 90),
    // "Sim" depois de "posso gerar o link?" é o lead que escolheu e ficou sem link (convs 9622,
    // 9514) — só conta como encerramento se a nossa última fala não era uma pergunta.
    ultimaLeadEncerra:
      ultima.message_type === 0 &&
      falaSoEncerra(ultima) &&
      !/\?\s*$/.test(msgs.filter((m) => m.message_type === 1).pop()?.content?.trim() ?? ""),
    telefone: doLead.find((m) => m.sender?.phone_number)?.sender?.phone_number ?? "",
  };
}

// message_type: 0 = entrada (lead), 1 = saída (IA/atendente).
// Atenção: o endpoint de mensagens é indexado pelo display_id da conversa (o mesmo número que
// aparece em conversation_ids e na URL do CRM), NÃO pelo `id` interno que vem em conversations[].
export async function analisarConversa(displayId: number): Promise<Analise | null> {
  try {
    const r = (await listarMensagens(env.CHATWOOT_ACCOUNT_ID, displayId)) as { payload?: MensagemConversa[] };
    return analisarMensagens(r.payload ?? []);
  } catch {
    return null;
  }
}

export function displayIdDoCard(card: KanbanTaskResumo): number | undefined {
  return card.conversation_ids?.[0] ?? card.conversations?.[0]?.display_id;
}

export interface ItemListaQuente {
  prioridade: 1 | 2 | 3 | 4;
  nome: string;
  displayId: number;
  motivo: string;
  perfil: PerfilFormulario | null;
}

/** 2 = "Imediatamente", 1 = faixa "Até R$", 0 = resto. */
export function pesoDoPerfil(perfil: PerfilFormulario | null | undefined): number {
  if (perfil?.quandoEntrar && /imediat/i.test(perfil.quandoEntrar)) return 2;
  if (perfil?.dispostoInvestir && /at[ée]\s*r\$/i.test(perfil.dispostoInvestir)) return 1;
  return 0;
}

const diasEntre = (antes: number, agora: number) => Math.floor((agora - antes) / DIA);

/**
 * Classifica um card. `objecaoPrecoEm` = quando o lead travou no preço (trava `objecao:*:preco`).
 * null = não entra na lista de hoje.
 */
export function classificarCard(d: {
  card: KanbanTaskResumo;
  analise: Analise;
  perfil: PerfilFormulario | null;
  objecaoPrecoEm: Date | null;
  agora: Date;
}): ItemListaQuente | null {
  const { card, analise: a, agora } = d;
  const displayId = displayIdDoCard(card);
  if (!displayId) return null;
  const agoraMs = agora.getTime();
  const base = { nome: card.title, displayId, perfil: d.perfil };

  const silencio = diasEntre(a.ultimaEm * 1000, agoraMs);
  if (!a.ultimaEhIa && !a.ultimaLeadEncerra && silencio <= 30) {
    const fala = a.ultimaLead ? `: "${a.ultimaLead.slice(0, 60)}"` : "";
    const quando = silencio === 0 ? "hoje" : `há ${silencio}d`;
    return { ...base, prioridade: 1, motivo: `mandou mensagem ${quando} e ninguém respondeu${fala}` };
  }
  if (a.linkEnviadoEm !== null && agoraMs - a.linkEnviadoEm * 1000 < 2 * DIA) {
    return { ...base, prioridade: 1, motivo: "recebeu o link e não pagou" };
  }

  const retomada = lerRetomada(card.description ?? "");
  if (retomada) {
    const atraso = agoraMs - retomada.momento.getTime();
    if (atraso >= -12 * 60 * 60 * 1000 && atraso < 2 * DIA) {
      return { ...base, prioridade: 2, motivo: "retorno combinado para hoje" };
    }
  }

  if (d.objecaoPrecoEm && diasEntre(d.objecaoPrecoEm.getTime(), agoraMs) === 7) {
    return { ...base, prioridade: 3, motivo: "travou no preço há 7 dias — hora do bônus/condição" };
  }

  if (a.chegouPreco && silencio >= 4 && silencio <= 14) {
    return { ...base, prioridade: 4, motivo: `ouviu o preço, ${silencio} dias em silêncio` };
  }
  return null;
}

export function ordenarListaQuente(itens: ItemListaQuente[]): ItemListaQuente[] {
  return [...itens].sort((x, y) => x.prioridade - y.prioridade || pesoDoPerfil(y.perfil) - pesoDoPerfil(x.perfil));
}
