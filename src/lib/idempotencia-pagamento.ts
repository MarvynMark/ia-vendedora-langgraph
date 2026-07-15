// Chave de idempotência para webhooks de pagamento.
//
// Plataformas de pagamento (DMGuru, TMB) reenviam o mesmo evento de aprovação —
// às vezes 2x em poucos segundos. Usada com o lock atômico (db/lock.ts), esta
// chave garante que só a 1ª execução de `processarPagamentoAprovado` prossiga.
//
// O prefixo "pagamento:" é ESSENCIAL: o lock do agente principal usa o telefone
// puro como session_id na MESMA tabela (n8n_status_atendimento). Sem o prefixo,
// o lock de pagamento colidiria com o de conversa e um bloquearia o outro.
export function montarChaveIdempotenciaPagamento(dados: {
  telefone?: string;
  email?: string;
  nome?: string;
}): string {
  return `pagamento:${dados.telefone ?? dados.email ?? dados.nome ?? "desconhecido"}`;
}
