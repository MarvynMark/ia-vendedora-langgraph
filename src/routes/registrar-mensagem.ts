import { Elysia } from "elysia";
import { z } from "zod";
import { salvarMensagemSeNova } from "../db/memoria.ts";
import { logger } from "../lib/logger.ts";

// Registra na MEMÓRIA DA IA uma mensagem que foi entregue ao lead por fora do app.
//
// Por que isto existe: a memória do agente é a tabela n8n_historico_mensagens
// (src/db/memoria.ts), NÃO o histórico do Chatwoot. E o webhook descarta tudo que
// não veio do lead (webhook-filtros.ts:22, "agent_message"). Então mensagem que sai
// pela campanha do Chatwoot, pelo painel de disparo ou pela mão de um atendente
// fica invisível: quando o lead responde, a IA retoma de onde ela parou e ignora o
// que foi dito no meio.
//
// O `telefone` DEVE ser o mesmo session_id que o webhook usa, que é o phone_number
// do contato no Chatwoot — atenção que em número brasileiro ele às vezes está sem
// o 9 (ver o contato 13309, +556281384100, cujo wa_id é 5562981384100).

const corpoSchema = z.object({
  telefone: z.string().min(8),
  conteudo: z.string().min(1),
  // Só para o log: de onde veio (painel-disparo, atendente, campanha...).
  origem: z.string().optional(),
  template: z.string().optional(),
});

const TOKEN = process.env.TOKEN_REGISTRO_MENSAGEM ?? "";

export const registrarMensagemRouter = new Elysia().post(
  "/webhook/registrar-mensagem",
  async ({ body, headers, set }) => {
    if (TOKEN && headers["x-token"] !== TOKEN) {
      set.status = 401;
      return { ok: false, erro: "token inválido" };
    }

    const parsed = corpoSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { ok: false, erro: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }

    const { telefone, conteudo, origem, template } = parsed.data;

    // Idempotente: com o webhook já registrando as saídas externas, a mesma mensagem
    // chega por dois caminhos (o aviso do painel e o message_created do Chatwoot).
    // Quem chegar depois é descartado.
    const gravou = await salvarMensagemSeNova(telefone, {
      type: "ai",
      content: conteudo,
      tool_calls: [],
      // Marca a procedência para dar pra auditar depois o que não saiu do agente.
      additional_kwargs: { origem: origem ?? "externo", ...(template ? { template } : {}) },
      response_metadata: {},
      invalid_tool_calls: [],
    });

    logger.info("registrar-mensagem", gravou
      ? "Mensagem externa registrada na memória da IA"
      : "Mensagem externa ignorada (já estava no histórico)", {
      telefone, origem: origem ?? "externo", template, tamanho: conteudo.length,
    });

    return { ok: true, gravou };
  },
);
