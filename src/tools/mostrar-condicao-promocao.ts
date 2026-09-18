import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarMensagem, pausaComDigitando } from "../services/chatwoot.ts";
import { enviarMensagemAntes } from "./mensagem-antes.ts";
import { salvarMensagem } from "../db/memoria.ts";
import { tabelaPromocao } from "../lib/promocao.ts";
import { logger } from "../lib/logger.ts";

// A tabela da promoção do Dia do Cliente vai por ESTA tool, nunca pelo texto do modelo.
//
// No teste das 12:32 (conv 3896) o modelo copiou o bloco do prompt para o lead ("Isto SUBSTITUI a
// apresentação de preço normal...") e o formatador de bolhas, que divide por frase e junta em três,
// picotou a tabela: sobrou a linha do Anual e um "Só a mentoria" vazio. Mandando a tabela pronta,
// como bolha própria, direto no Chatwoot, a formatação (~riscado~, *negrito*, quatro linhas) chega
// inteira e nenhuma instrução interna passa pelo modelo.
//
// Mesmo padrão das tools de mídia: `mensagem_antes` sai primeiro, o output que acompanha a tool
// call é descartado (TOOLS_QUE_ENVIAM_TEXTO_AO_LEAD), e o que o modelo escrever DEPOIS é o
// fechamento — recomendação e pergunta.

const conversasComTabela = new Set<string>();

interface ContextoPromocao {
  idConta: string;
  idConversa: string;
  telefone: string;
}

export function criarToolMostrarCondicaoPromocao(ctx: ContextoPromocao) {
  return tool(
    async ({ mensagem_antes }) => {
      if (conversasComTabela.has(ctx.idConversa)) {
        return "A tabela JÁ foi enviada nesta conversa. Não repita os valores: responda o que o lead perguntou e leve para a escolha do plano.";
      }
      conversasComTabela.add(ctx.idConversa);
      try {
        await enviarMensagemAntes(ctx.idConta, ctx.idConversa, mensagem_antes, "tool:mostrar-condicao-promocao");
        const tabela = tabelaPromocao();
        await pausaComDigitando(ctx.idConta, ctx.idConversa, 2500);
        await enviarMensagem(ctx.idConta, ctx.idConversa, tabela);
        // Na memória como fala da IA: no próximo turno o modelo sabe que o lead viu os quatro
        // valores e não os reapresenta.
        await salvarMensagem(ctx.telefone, {
          type: "ai", content: tabela, tool_calls: [], invalid_tool_calls: [], response_metadata: {},
          additional_kwargs: { origem: "tool:mostrar-condicao-promocao" },
        });
        logger.info("tool:mostrar-condicao-promocao", "Tabela da promoção enviada", { idConversa: ctx.idConversa });
        return [
          "Tabela da promoção enviada ao lead (ele já está vendo os quatro valores com o desconto).",
          "Agora escreva NO MÁXIMO 2 bolhas curtas: a recomendação (o Anual, e por quê, em uma frase) e UMA pergunta sobre qual plano faz sentido pra ele.",
          "NÃO repita nenhum valor da tabela e NÃO mande link.",
        ].join("\n");
      } catch (e) {
        conversasComTabela.delete(ctx.idConversa);
        logger.error("tool:mostrar-condicao-promocao", "Falha ao enviar a tabela", e);
        return "Não consegui enviar a tabela agora. Diga ao lead que já volta com os valores e use Escalar_humano.";
      }
    },
    {
      name: "Mostrar_condicao_dia_cliente",
      description:
        "Envia ao lead a tabela pronta da promoção do Dia do Cliente (os 4 planos com o valor antigo riscado, o de hoje e o desconto). Use assim que o lead responder ao disparo ou pedir valor. É a ÚNICA forma de apresentar os preços de hoje: nunca escreva os valores você mesmo.",
      schema: z.object({
        mensagem_antes: z.string().optional()
          .describe("Uma frase curta de contexto que vai ANTES da tabela (ex.: 'Que bom que você voltou. Vou direto ao ponto: hoje, e só hoje, a mentoria está no menor valor que já teve.'). Sem valores."),
      }),
    },
  );
}
