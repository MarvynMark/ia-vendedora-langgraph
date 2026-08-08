import { formatarDocumento } from "./documento.ts";

// Monta o alerta que vai para o grupo de suporte quando uma venda é aprovada.
// Função PURA e sem I/O de propósito: é o texto que o time lê para conferir o
// cadastro do aluno, então precisa ser testável sem tocar Chatwoot nem o grafo
// de follow-up (mock.module vaza entre arquivos no bun — ver tests/routes/webhook.test.ts).
export interface DadosAlertaNovoAluno {
  nome: string;
  email?: string;
  telefone?: string;
  cpf?: string;
  /** Nome da oferta/plano já resolvido (oferta > produto > fallback). */
  plano: string;
  /** Plataforma de origem da venda. Ausente = DMGuru. */
  origem?: "dmguru" | "tmb";
}

// Telefone chega em E.164 (+5562999996666) e sai legível para o time: (62) 99999-6666.
export function formatarTelefoneBr(telefone?: string): string {
  if (!telefone) return "(não informado)";
  return telefone.replace(/^\+55/, "").replace(/(\d{2})(\d{4,5})(\d{4})/, "($1) $2-$3");
}

export function montarMensagemNovoAluno(dados: DadosAlertaNovoAluno): string {
  // O sufixo da plataforma existe só aqui, no alerta do grupo: o time trata o
  // boleto parcelado da TMB diferente do cartão da DMGuru. Ele NÃO vai para a
  // descrição do card, que alimenta o prompt do follow-up — de lá o agente
  // poderia acabar citando a plataforma para o próprio aluno.
  const plano = dados.origem === "tmb" ? `${dados.plano} - TMB` : dados.plano;

  return [
    `✅✅ NOVO ALUNO MENTORIA: ${dados.nome}`,
    `Email: ${dados.email ?? "(não informado)"}`,
    `Telefone: ${formatarTelefoneBr(dados.telefone)}`,
    `CPF: ${formatarDocumento(dados.cpf)}`,
    plano,
  ].join("\n");
}
