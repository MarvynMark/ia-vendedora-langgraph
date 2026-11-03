// Convites da Black e contatos duplicados no Chatwoot.
//
// Muita gente tem DOIS contatos: um com o 9 (+55 64 99289-7607) e outro sem (+55 64 9289-7607).
// O disparo de 02–03/11 às vezes mandou o convite pelo contato sem o 9; a Meta entrega no mesmo
// WhatsApp, mas a resposta volta pelo wa_id do contato verdadeiro e cai em OUTRA conversa — sem
// convite nenhum. Aí o "Quero meu acesso" ia para a IA (alertas falsos de "Lead quente" / "IA
// pausada", conv 4700 e 3352) e o lead não recebia o link.
//
// Aqui, quando a conversa da resposta não tem convite, procura o convite nas conversas dos
// duplicados do mesmo telefone (mesmo DDD + últimos 8 dígitos) e devolve as mensagens juntas.

import { env } from "../config/env.ts";
import { fetchComTimeout } from "./fetch-with-timeout.ts";
import { buscarConversasDoContato, listarMensagens } from "../services/chatwoot.ts";
import { conviteBlackRecente } from "../routes/webhook-filtros.ts";

export interface MensagemComConvite {
  id?: number;
  message_type: number;
  private?: boolean;
  content?: string | null;
  created_at?: number;
  additional_attributes?: { template_params?: { name?: string } } | null;
}

/** DDD + últimos 8 dígitos: casa o celular com e sem o 9. */
export const chaveTelefone = (tel: string) => {
  const d = (tel ?? "").replace(/\D/g, "").replace(/^55/, "");
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : "";
};

async function mensagens(idConta: string, idConversa: string | number): Promise<MensagemComConvite[]> {
  return (((await listarMensagens(idConta, String(idConversa))) as { payload?: MensagemComConvite[] }).payload) ?? [];
}

/**
 * Mensagens da conversa atual; se nela não houver convite da Black, junta as das conversas dos
 * contatos duplicados que tiverem convite. Ordenadas por data. Em erro, devolve só as da atual.
 */
export async function mensagensComConviteDeDuplicatas(
  idConta: string,
  idConversa: string,
  telefone: string,
  idInbox: number,
): Promise<MensagemComConvite[]> {
  const proprias = await mensagens(idConta, idConversa);
  const agora = Date.now() / 1000;
  const chave = chaveTelefone(telefone);
  if (conviteBlackRecente(proprias, agora) || !chave) return proprias;
  try {
    const res = await fetchComTimeout(
      `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${idConta}/contacts/search?q=${chave.slice(-8)}`,
      { headers: { api_access_token: env.CHATWOOT_API_TOKEN }, timeout: 15_000 },
    );
    if (!res.ok) return proprias;
    const contatos = (((await res.json()) as { payload?: Array<{ id: number; phone_number?: string }> }).payload ?? [])
      .filter((c) => c.phone_number && chaveTelefone(c.phone_number) === chave);
    const extras: MensagemComConvite[] = [];
    for (const c of contatos.slice(0, 4)) {
      const convs = (await buscarConversasDoContato(idConta, c.id).catch(() => []))
        .filter((v) => v.inbox_id === idInbox && String(v.id) !== String(idConversa));
      for (const v of convs.slice(0, 3)) {
        const ms = await mensagens(idConta, v.id).catch(() => []);
        if (conviteBlackRecente(ms, agora)) extras.push(...ms);
      }
    }
    return [...proprias, ...extras].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  } catch {
    return proprias;
  }
}
