import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { enviarMensagem } from "../services/chatwoot.ts";
import { reivindicarAlertaGestor, liberarAlertaGestor } from "../db/alertas.ts";
import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";

interface ContextoAlertarGestor {
  telefone: string;
  nome: string;
  idConta: string;
  idConversa: string;
  ultimaMensagem: string;
}

// Alerta o gestor sobre um lead QUENTE (quase certo) SEM pausar a IA — diferente do Escalar_humano,
// aqui a IA CONTINUA conduzindo o atendimento. Cria uma nota privada na conversa do lead (só a
// equipe vê) e avisa no grupo de alertas. Objetivo: nenhuma venda quase fechada esfriar por
// promessa de retorno esquecida (as ~10 "vendas quase certas" do diagnóstico morriam justamente aí).
// O alerta no grupo é enviado UMA ÚNICA VEZ por conversa (trava em alertas_gestor_enviados); a nota
// privada continua sendo criada sempre, porque ela só aparece no histórico do próprio lead.
export function criarToolAlertarGestor(contexto: ContextoAlertarGestor) {
  return tool(
    async (input: { motivo: string }) => {
      const nomeDisplay = contexto.nome || "(sem nome)";

      // 1. Nota PRIVADA na conversa do lead (visível só para a equipe, nunca para o lead).
      try {
        const nota = `⭐ *Lead quente — acompanhar de perto*\n\n*Situação*: ${input.motivo}\n\n*Última mensagem do lead*:\n"${contexto.ultimaMensagem}"`;
        await enviarMensagem(contexto.idConta, contexto.idConversa, nota, { private: true });
      } catch (e) {
        logger.warn("tool:alertar-gestor", "Erro ao criar nota privada:", e);
      }

      // 2. Alerta no grupo interno — só na PRIMEIRA vez. Repetição é ignorada em silêncio, mas o
      // retorno continua "ok" pro modelo não achar que falhou e tentar de novo no turno seguinte.
      let primeiraVez = false;
      try {
        primeiraVez = await reivindicarAlertaGestor(contexto.idConversa, contexto.telefone, input.motivo);
      } catch (e) {
        logger.warn("tool:alertar-gestor", "Erro ao checar trava do alerta, enviando mesmo assim:", e);
        primeiraVez = true;
      }

      if (!primeiraVez) {
        logger.info("tool:alertar-gestor", `Grupo já avisado sobre a conversa ${contexto.idConversa}, ignorando repetição`);
        return JSON.stringify({ resultado: "ok", alertaGrupo: "ja_enviado" });
      }

      try {
        const link = `${env.CHATWOOT_BASE_URL}/app/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations/${contexto.idConversa}`;
        const alerta = `⭐ *Lead quente* — ${nomeDisplay} (${contexto.telefone})\n\n${input.motivo}\n\n*Última mensagem*:\n"${contexto.ultimaMensagem}"\n\n👉 ${link}`;
        await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, env.CHATWOOT_ALERT_CONVERSATION_ID, alerta);
      } catch (e) {
        // Libera a trava pra falha de rede não queimar a única chance de avisar a equipe.
        await liberarAlertaGestor(contexto.idConversa).catch(() => {});
        logger.warn("tool:alertar-gestor", "Erro ao enviar alerta (nota privada já criada):", e);
      }

      return JSON.stringify({ resultado: "ok" });
    },
    {
      name: "Alertar_gestor",
      description:
        "Avisa a equipe UMA ÚNICA VEZ sobre um lead que está COMPRANDO AGORA, SEM pausar seu atendimento (você CONTINUA conduzindo normalmente). Cria uma nota privada no lead e um alerta no grupo interno. Use SÓ quando houver compromisso de PAGAMENTO: o lead recebeu o link e disse que vai pagar, escolheu o plano e está executando o pagamento, mandou comprovante, travou num detalhe operacional do pagamento (virada do cartão, limite, boleto) ou marcou data pra PAGAR. NUNCA use para objeção de preço, 'vou pensar', 'vou analisar' ou retorno só de DECISÃO — nesses casos o follow-up do card já resolve.",
      schema: z.object({
        motivo: z
          .string()
          .describe("Por que o lead está comprando e o que ficou combinado (ex.: 'ia pagar dia 10, travou só na virada do cartão')"),
      }),
    },
  );
}
