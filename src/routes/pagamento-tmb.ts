import { Elysia } from "elysia";
import { z } from "zod";
import { processarPagamentoAprovado } from "./pagamento.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { registrarWebhook } from "../lib/webhook-logger.ts";

// Payload do Webhook Vendas da TMB (Tem Mais no Boleto).
// Fonte: portal do produtor > Integrações > Webhook Vendas.
// O corpo é diretamente o objeto do pedido (sem wrapper). A TMB avisa que pode
// adicionar novos atributos no futuro — o Zod ignora campos desconhecidos por
// padrão, então não quebramos ao receber campos extras.
const tmbVendasPayloadSchema = z.object({
  // "Efetivado" = cliente pagou o boleto de entrada (matrícula liberada).
  // "Cancelado" = cliente cancelou após pagar a entrada.
  status_pedido: z.string().optional(),
  cliente: z.string().optional(),
  email: z.string().optional(),
  // Telefone já vem em formato E.164 (ex.: "+5562999999999").
  telefone_ativo: z.string().optional(),
  telefones: z.string().optional(),
  lancamento: z.string().optional(), // nome do produto/lançamento
  titulo: z.string().optional(),      // título da oferta/plano (ex.: "RC - R$ 1.997,00")
  // Identificadores úteis para rastreio/idempotência nos logs
  pedido: z.union([z.number(), z.string()]).optional(),
  id: z.union([z.number(), z.string()]).optional(),
});

// Normaliza o telefone para E.164 com "+". A TMB já envia com "+", mas garantimos
// o prefixo caso venha sem. A busca de contato no Chatwoot gera variantes (com/sem
// 55, com/sem 9º dígito), então não precisamos ser exatos aqui.
function normalizarTelefone(bruto?: string): string | undefined {
  if (!bruto) return undefined;
  const digitos = bruto.replace(/\D/g, "");
  return digitos ? `+${digitos}` : undefined;
}

export const pagamentoTmbRouter = new Elysia()
  .post("/webhook/pagamento-tmb", async ({ body, headers, set }) => {
    logger.info("pagamento-tmb", ">>> Webhook recebido");
    registrarWebhook("/webhook/pagamento-tmb", body, "recebido");

    // Validação opcional por header (campos "Chave"/"Valor" configurados na TMB).
    // Só valida se TMB_WEBHOOK_SECRET estiver definido no ambiente.
    if (env.TMB_WEBHOOK_SECRET) {
      const recebido = headers[env.TMB_WEBHOOK_HEADER];
      if (recebido !== env.TMB_WEBHOOK_SECRET) {
        logger.warn("pagamento-tmb", "Header de autenticação inválido ou ausente", {
          header: env.TMB_WEBHOOK_HEADER,
        });
        set.status = 401;
        return { status: "error", reason: "unauthorized" };
      }
    }

    const parsed = tmbVendasPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("pagamento-tmb", "Payload inválido:", parsed.error.issues);
      return { status: "error", reason: "invalid_payload" };
    }

    const dados = parsed.data;

    // Só processar quando o pagamento da entrada foi efetivado.
    // O Webhook Vendas dispara uma única vez por venda na efetivação, então não
    // há risco de parcelas recorrentes (diferente da DMGuru).
    if (dados.status_pedido !== "Efetivado") {
      logger.info("pagamento-tmb", "Ignorado: status_pedido não é Efetivado", {
        status_pedido: dados.status_pedido,
        pedido: dados.pedido ?? dados.id,
      });
      return { status: "ignored", reason: "not_efetivado" };
    }

    const telefone = normalizarTelefone(dados.telefone_ativo ?? dados.telefones);
    const nomeProduto = dados.lancamento ?? "";
    const nomeOferta = dados.titulo ?? dados.lancamento ?? "";

    if (!telefone && !dados.email) {
      logger.error("pagamento-tmb", "Sem telefone nem email para localizar o contato", {
        pedido: dados.pedido ?? dados.id,
      });
      return { status: "error", reason: "no_contact_data" };
    }

    logger.info("pagamento-tmb", "Venda efetivada:", {
      pedido: dados.pedido ?? dados.id,
      nome: dados.cliente,
      email: dados.email,
      telefone,
      produto: nomeProduto,
      oferta: nomeOferta,
    });

    // Processar em background (mesma lógica compartilhada com a DMGuru).
    void processarPagamentoAprovado({
      nome: dados.cliente,
      email: dados.email,
      telefone,
      nomeProduto,
      nomeOferta,
    });

    return { status: "accepted" };
  });
