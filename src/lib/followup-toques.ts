// Toques curtos de follow-up (decisão do Gusthavo, 30/09/2026).
//
// Os textos fixos eram longos e todos começavam com "Oi [Nome]," — cara de disparo automático
// (conv 9280: o lead recebeu "e se desse pra começar por um caminho mais leve?..." duas horas
// depois de a equipe mandar uma condição especial). A cadência de quem já conversou vira:
//
//   toque 1 — algumas horas depois, DENTRO da janela de 24h: a IA lê a conversa e faz UMA
//             pergunta curta ligada a algo que o lead falou ("você vai fazer só a PCDF ou
//             pretende prestar outros de perito também?")
//   toque 2 — ainda dentro da janela, perto de ela fechar: "Oiii, consegue responder agora?"
//   toque 3 — no dia seguinte, fora da janela: template aprovado na Meta
//   toque 4 — encerramento, 2 dias depois: template aprovado
//
// Os toques 1 e 2 são grátis (texto livre dentro da janela); só o 3 e o 4 pagam template.
//
// 03/10/2026: em Conexão, pós-preço e Primeira mensagem o toque 2 virou DOIS toques de
// curiosidade (áudio mudo + "O que você acha?", depois o PDF de "comprovante PIX"), ver
// lib/followup-curiosidade.ts. O lembrete (link enviado) segue com o toque 2 curto daqui.

import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import { buscarHistorico } from "../db/memoria.ts";
import { logger } from "./logger.ts";
import { criarLangfuseHandler, finalizarLangfuseHandler } from "./langfuse.ts";
import { proximoHorarioComercial, agendarMaximizandoJanela } from "./horario-comercial.ts";

export type EtapaToque = "conexao" | "pos_preco" | "lembrete";

const HORA = 60 * 60 * 1000;

/** Marcadores das posições da sequência que não são template fixo. */
export const TOQUE_IA = "__toque_ia__";
export const TOQUE_PUXAR = "__toque_puxar__";

/** Texto do toque 1 quando a IA falha ou devolve algo fora do padrão. */
export const FALLBACK_TOQUE_1: Record<EtapaToque, string> = {
  conexao: "Ficou alguma dúvida do que a gente conversou? Me fala aqui",
  pos_preco: "Ficou alguma dúvida sobre os planos? Me fala que eu te explico melhor",
  lembrete: "Travou em alguma parte do pagamento? Me fala que eu te ajudo",
};

/** Toque 2: curtinho, de quem voltou a chamar. Varia por conversa pra não virar padrão. */
export const VARIACOES_TOQUE_2 = [
  "Oiii, consegue responder agora?",
  "Oii, tá por aí?",
  "[Nome], conseguiu ver minha mensagem?",
] as const;

export function escolherToque2(idConversa: string | number): string {
  const n = Number(String(idConversa).replace(/\D/g, "")) || 0;
  return VARIACOES_TOQUE_2[n % VARIACOES_TOQUE_2.length]!;
}

/**
 * Quando sai o próximo toque, dado o índice do que ACABOU de sair. `toquesNaJanela` = quantos
 * toques da sequência cabem na janela grátis (2 no lembrete; 3 onde entram os de curiosidade,
 * ver lib/followup-curiosidade.ts).
 * - toque intermediário da janela: ~3h depois (ainda dentro dela)
 * - último toque da janela: perto de ela fechar (ainda grátis); se não couber, segue a régua normal
 * - depois do último da janela: no dia seguinte (já fora → template)
 * - depois desse: encerramento 2 dias depois
 */
export function agendarProximoToque(indiceEnviado: number, msRestantesJanela: number, agora = new Date(), toquesNaJanela = 2): Date {
  const ultimoNaJanela = toquesNaJanela - 1;
  if (indiceEnviado < ultimoNaJanela - 1) {
    // 3h e não "metade da janela": a metade costuma cair de madrugada, o horário comercial empurra
    // pra perto de a janela fechar e não sobra espaço pro último toque grátis.
    return agendarMaximizandoJanela(agora, msRestantesJanela > 0 ? 3 * HORA : 20 * HORA, msRestantesJanela, { minGapMs: HORA });
  }
  if (indiceEnviado < ultimoNaJanela) {
    return agendarMaximizandoJanela(agora, 20 * HORA, msRestantesJanela, { minGapMs: HORA });
  }
  if (indiceEnviado === ultimoNaJanela) return proximoHorarioComercial(agora, 24 * HORA);
  return proximoHorarioComercial(agora, 48 * HORA);
}

/**
 * A mensagem que a IA escreveu serve? Devolve o texto limpo ou null (aí vai o fallback fixo).
 * Tem que ser curta, uma pergunta, sem preço, link, travessão ou marcador esquecido.
 */
export function validarToque(bruto: string): string | null {
  const texto = (bruto ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").trim();
  if (!texto || texto.length > 180) return null;
  if (!texto.includes("?")) return null;
  if (/[—–]|https?:\/\/|www\.|R\$|\[|\]|\{|\}/i.test(texto)) return null;
  if (/faz sentido|o que achou|garant(e|ir) (sua|tua) vaga|últimas vagas|expira/i.test(texto)) return null;
  return texto;
}

/**
 * Tira o nome do começo ("Lucas, qual matéria...?" → "Qual matéria...?"). O modelo abre com o
 * nome mesmo com o prompt proibindo, e toda mensagem começando pelo nome é cara de disparo.
 */
export function tirarNomeDoInicio(texto: string, nome?: string): string {
  if (!nome) return texto;
  const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const semNome = texto.replace(new RegExp(`^(oi+|olá|e aí)?[\\s,!]*${escapado}\\s*[,!.]\\s*`, "i"), "");
  if (semNome === texto || !semNome) return texto;
  return semNome.charAt(0).toUpperCase() + semNome.slice(1);
}

const CONTEXTO_ETAPA: Record<EtapaToque, string> = {
  conexao: "O lead conversou com você sobre a preparação dele e parou de responder antes de ver os planos.",
  pos_preco: "O lead já viu os valores dos planos da mentoria e parou de responder.",
  lembrete: "O lead recebeu o link de pagamento e ainda não finalizou.",
};

function montarPrompt(etapa: EtapaToque): string {
  return `Você é o Perito Walker, mentor de concursos de Perito Criminal, conversando pelo WhatsApp.
${CONTEXTO_ETAPA[etapa]}

Escreva UMA mensagem curta pra ele voltar a responder. Regras:
- Uma pergunta só, de no máximo 140 caracteres, fácil de responder.
- Ligue a pergunta a algo CONCRETO que o lead falou na conversa (o concurso, a rotina, a matéria, a dúvida, o plano que ele comentou). Exemplos de tom: "Você vai fazer só a PCDF ou pretende prestar outros de perito também?", "E física e química, você tá estudando por onde hoje?", "Ficou entre o Anual e o Semestral?".
- Se não houver nada concreto, pergunte se travou em alguma parte ou ficou alguma dúvida.
- Tom de gente no WhatsApp: informal, sem formalidade.
- NUNCA comece com o nome do lead nem com "Oi"/"Olá": abrir tudo com o nome é o que denuncia mensagem automática. Na maioria das vezes, não use o nome; se usar, só no meio ou no fim.
- Proibido: preço, valor, parcela, link, travessão, emoji, "faz sentido", "o que achou", pressão ou escassez.
- Responda SÓ com o texto da mensagem, sem aspas.`;
}

/**
 * Toque 1 personalizado. Nunca lança: qualquer falha devolve o fallback fixo da etapa.
 */
export async function gerarToque1(opts: { etapa: EtapaToque; telefone?: string; nome?: string }): Promise<string> {
  const fallback = FALLBACK_TOQUE_1[opts.etapa];
  if (!opts.telefone) return fallback;

  const handler = criarLangfuseHandler("follow-up-toque", {
    sessionId: opts.telefone,
    userId: opts.telefone,
    tags: ["follow-up", `toque-${opts.etapa}`],
  });
  try {
    const historico = await buscarHistorico(opts.telefone, 30);
    const conversa = historico
      .filter((m) => (m.type === "human" || m.type === "ai") && m.content?.trim() && !m.content.startsWith("[SISTEMA:"))
      .map((m) => `${m.type === "human" ? "LEAD" : "WALKER"}: ${m.content.trim().slice(0, 600)}`)
      .join("\n");
    if (!conversa) return fallback;

    const model = new ChatOpenAI({
      modelName: env.OPENAI_MODEL_MINI,
      openAIApiKey: env.OPENAI_API_KEY,
      temperature: 0.7,
      timeout: 20_000,
    });
    const resposta = await model.invoke(
      [
        { role: "system", content: montarPrompt(opts.etapa) },
        { role: "user", content: `Nome do lead: ${opts.nome || "(desconhecido)"}\n\nConversa:\n${conversa}` },
      ],
      { callbacks: handler ? [handler] : [] },
    );
    const texto = validarToque(typeof resposta.content === "string" ? resposta.content : "");
    if (!texto) {
      logger.warn("follow-up", "Toque 1 da IA fora do padrão — usando o fixo", { devolvido: String(resposta.content).slice(0, 200) });
      return fallback;
    }
    return tirarNomeDoInicio(texto, opts.nome);
  } catch (e) {
    logger.warn("follow-up", "Erro ao gerar toque 1 personalizado — usando o fixo", e);
    return fallback;
  } finally {
    await finalizarLangfuseHandler(handler);
  }
}
