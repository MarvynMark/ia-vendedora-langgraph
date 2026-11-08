// O Chatwoot aceita a mensagem do grupo (HTTP 200) e só DEPOIS o Baileys tenta entregar. Quando o
// WhatsApp recusa, a mensagem fica com status "failed" e ninguém percebe: 07/11/2026, o aviso da
// Alessandra Carvalho ficou "O WhatsApp não conseguiu enviar esta mensagem no momento." e o grupo
// nunca soube da venda. Por isso o aviso é conferido alguns segundos depois e reenviado se falhou.
//
// Função PURA e sem I/O (mock.module vaza entre arquivos de teste no bun).

export type SituacaoEntrega = "falhou" | "ok" | "desconhecida";

interface MensagemComStatus {
  id: number;
  status?: string | null;
}

export function situacaoEntrega(mensagens: MensagemComStatus[], idMensagem: number): SituacaoEntrega {
  const m = mensagens.find((x) => x.id === idMensagem);
  if (!m) return "desconhecida";
  return m.status === "failed" ? "falhou" : "ok";
}
