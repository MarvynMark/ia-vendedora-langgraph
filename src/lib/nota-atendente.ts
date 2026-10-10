// Nota privada pro atendente humano (decisão do Gusthavo, 09/10/2026).
//
// Quando o lead trava (objeção) ou some (fim da régua de follow-up), a conversa ganha uma nota
// privada dizendo POR QUE travou, QUANDO o humano deve entrar e O QUE falar. Antes o grupo do
// comercial recebia só "lead esbarrou em objeção" e o atendente abria a conversa sem saber por
// onde começar.
//
// O "quando abordar" é regra fixa, não palpite do modelo — vem da análise de 09/10 (57 conversas
// perdidas × 39 compradores): quem some volta entre D+4 e D+14 (mediana 12,7 dias), e a régua
// automática acaba em 1 a 5 dias. O modelo só escreve o porquê e a mensagem pronta.

import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { env } from "../config/env.ts";
import { enviarMensagem, listarMensagens } from "../services/chatwoot.ts";
import { buscarDadosFormulario } from "../db/formulario.ts";
import { reivindicarAlerta, liberarAlerta, listarAlertasDesde } from "../db/alertas.ts";
import { ehMedicoPorFormacao, formacaoDoFormulario } from "./medico.ts";
import { lerRetomada } from "./retomada.ts";
import type { TipoObjecao } from "./objecoes.ts";
import { logger } from "./logger.ts";

export type MotivoTravamento =
  | "sem_resposta"
  | "escolheu_sem_link"
  | "link_sem_pagamento"
  | "forma_pagamento"
  | "adiou"
  | "duvida_produto"
  | "preco"
  | "sumiu_pos_pitch"
  | "sumiu_conexao";

export const ROTULO_MOTIVO: Record<MotivoTravamento, string> = {
  sem_resposta: "mandou mensagem e ninguém respondeu",
  escolheu_sem_link: "escolheu o plano e ficou sem link",
  link_sem_pagamento: "recebeu o link e não pagou",
  forma_pagamento: "travou na forma de pagamento",
  adiou: "adiou a decisão",
  duvida_produto: "dúvida sobre a mentoria não resolvida",
  preco: "travou no preço / orçamento",
  sumiu_pos_pitch: "sumiu depois do preço",
  sumiu_conexao: "sumiu antes do preço",
};

/**
 * Bônus que o atendente pode oferecer a quem travou no preço. Vazio = a nota sugere "um bônus
 * extra ou condição exclusiva" sem nomear qual (decisão do Gusthavo: a nota só sugere, quem
 * decide é o atendente). NUNCA cupom ou desconto aqui.
 */
export const BONUS_SUGERIDOS: readonly string[] = [];

const DIA = 24 * 60 * 60 * 1000;
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

function rotuloDia(d: Date): string {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  const dd = String(sp.getUTCDate()).padStart(2, "0");
  const mm = String(sp.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm} (${DIAS_SEMANA[sp.getUTCDay()]})`;
}

/** Soma dias e empurra domingo pra segunda — ninguém do comercial aborda lead no domingo. */
function diasDepois(agora: Date, dias: number): Date {
  const alvo = new Date(agora.getTime() + dias * DIA);
  const diaSemana = new Date(alvo.getTime() + SP_OFFSET_MS).getUTCDay();
  return diaSemana === 0 ? new Date(alvo.getTime() + DIA) : alvo;
}

/** Quando o humano deve entrar, por motivo. Regra da análise de 09/10/2026. */
export function quandoAbordar(
  motivo: MotivoTravamento,
  agora: Date,
  retomada: Date | null = null,
): { quando: Date; regra: string } {
  switch (motivo) {
    case "sem_resposta":
      return { quando: agora, regra: "hoje, em até 2h — o lead está esperando a gente" };
    case "escolheu_sem_link":
      return { quando: agora, regra: "agora — gerar o link" };
    case "link_sem_pagamento":
      return { quando: agora, regra: "hoje e de novo amanhã — descobrir o que travou no pagamento" };
    case "forma_pagamento":
      return { quando: agora, regra: "hoje — resolver cartão/boleto/PIX na hora" };
    case "duvida_produto":
      return { quando: agora, regra: "hoje — a IA não resolveu a dúvida" };
    case "adiou":
      if (retomada && retomada.getTime() > agora.getTime()) {
        return { quando: retomada, regra: "no dia combinado com o lead; se a data é de pagamento, boleto com vencimento" };
      }
      return { quando: diasDepois(agora, 3), regra: "D+3 — retomar o que ele disse que ia decidir" };
    case "preco":
      return { quando: diasDepois(agora, 7), regra: "D+7 com bônus/condição; se não voltar, nova tentativa em D+14 a D+21" };
    case "sumiu_pos_pitch":
      return { quando: diasDepois(agora, 5), regra: "D+5 a D+7 — mensagem pessoal, é quando os compradores voltam" };
    case "sumiu_conexao":
      return { quando: diasDepois(agora, 7), regra: "D+7 — reaquecer pelo concurso dele" };
  }
}

export function motivoDaObjecao(tipo: TipoObjecao): MotivoTravamento {
  if (tipo === "preco") return "preco";
  if (tipo === "pagamento") return "forma_pagamento";
  return "adiou";
}

/** Lê um campo da string "Campo: Valor | Campo: Valor" de buscarDadosFormulario. */
export function campoDoFormulario(dados: string, campo: string): string {
  const re = new RegExp(`(?:^|\\|)\\s*${campo}:\\s*([^|]+)`, "i");
  return re.exec(dados)?.[1]?.trim() ?? "";
}

export interface ConteudoNota {
  porQueTravou: string;
  comoAbordar: string[];
  oQueEvitar: string;
}

export function formatarNota(d: {
  motivo: MotivoTravamento;
  quando: { quando: Date; regra: string };
  conteudo: ConteudoNota | null;
  dadosFormulario: string;
}): string {
  const f = d.dadosFormulario;
  const concurso = campoDoFormulario(f, "Concurso") || "concurso não informado";
  const cargo = ehMedicoPorFormacao(formacaoDoFormulario(f)) ? "médico legista" : "perito";
  const quer = campoDoFormulario(f, "Quando pretende entrar") || "—";
  const investe = campoDoFormulario(f, "Disposto a investir") || "—";

  const linhas = [`🧭 NOTA PRO ATENDENTE — ${ROTULO_MOTIVO[d.motivo]}`];
  if (d.conteudo) linhas.push(`Por que travou: ${d.conteudo.porQueTravou}`);
  linhas.push(`Quando abordar: ${rotuloDia(d.quando.quando)} — ${d.quando.regra}`);
  if (d.conteudo && d.conteudo.comoAbordar.length > 0) {
    linhas.push(`Como abordar:\n${d.conteudo.comoAbordar.map((m) => `"${m}"`).join("\n")}`);
  }
  if (d.motivo === "preco") {
    linhas.push(
      BONUS_SUGERIDOS.length > 0
        ? `Condição: vale oferecer um destes bônus — ${BONUS_SUGERIDOS.join(", ")}. Decisão sua.`
        : "Condição: vale oferecer um bônus extra ou uma condição exclusiva. Decisão sua.",
    );
  }
  if (d.conteudo?.oQueEvitar) linhas.push(`Evitar: ${d.conteudo.oQueEvitar}`);
  linhas.push(`Perfil: ${concurso} · ${cargo} · quer entrar: ${quer} · investe: ${investe}`);
  return linhas.join("\n");
}

const SchemaNota = z.object({
  motivo: z
    .enum(["sem_resposta", "escolheu_sem_link", "link_sem_pagamento", "forma_pagamento", "adiou", "duvida_produto", "preco", "sumiu_pos_pitch", "sumiu_conexao"])
    .describe("O motivo real do travamento, lendo a conversa."),
  porQueTravou: z.string().describe("1 frase, citando entre aspas o que o lead disse quando travou."),
  comoAbordar: z.array(z.string()).describe("1 ou 2 bolhas de WhatsApp em sequência, prontas para o atendente copiar; só a última com pergunta."),
  oQueEvitar: z.string().describe("1 frase: o que NÃO repetir com este lead."),
});

const PROMPT_NOTA = `Você é o coordenador comercial da Mentoria Vestigium (Professor Perito Walker), que prepara concurseiros para Perito Criminal e Médico Legista.
Um lead travou ou sumiu. Escreva a orientação para o ATENDENTE HUMANO que vai retomar a conversa por WhatsApp.

Regras do que o atendente pode dizer (nunca sugira o contrário):
- Nunca porcentagem de desconto, nunca cupom, nunca valor da taxa do boleto, nunca previsão de data de edital.
- Planos: Anual Completo 12x R$ 394 (com material, via Premium do Estratégia), Anual 12x R$ 315, Semestral Premium 12x R$ 246, Semestral 12x R$ 197. Médico: só o Médico Legista Semestral 12x R$ 394, que já inclui o material.
- Os planos sem "Completo"/"Premium" NÃO têm aulas, apostila nem questões: a mentoria é método, plano personalizado, encontros ao vivo e suporte.
- Garantia de 7 dias.
- Travou no preço por renda: não responda com parcelamento. O atendente pergunta quanto cabe por mês e pode oferecer um bônus extra ou condição exclusiva (sem dizer qual).
- Mensagens curtas (no máximo 2 frases cada), pessoais, com o primeiro nome real do lead (nunca "[NOME]") e o concurso dele. Se forem 2 mensagens, são 2 bolhas em sequência e SÓ a última tem pergunta. Nada de "sem pressão, é só me chamar".
- Se o lead já escolheu o plano: a mensagem confirma o plano e diz que o link vai em seguida. Não volte a perguntar orçamento nem peça permissão ("posso te mandar o link?") — os leads somem nessa pergunta.
- Um plano só, nunca dois preços na mesma mensagem. Sem markdown: nada de ** ou #.

Como escolher o motivo (na dúvida, o mais acionável):
- escolheu_sem_link: o lead escolheu um plano ou respondeu "sim" a "posso gerar o link?" e o link não chegou. Vale mesmo que ele tenha falado de valor antes.
- adiou: deu uma data ou um motivo para depois ("mês que vem", "quando receber", "depois da viagem"), mesmo que já tenha recebido o link.
- link_sem_pagamento: recebeu o link, não deu data nem objeção, e não pagou.
- preco: disse que o valor não cabe ou está acima do que pode.
- duvida_produto: fez uma pergunta sobre a mentoria (material, edital, vaga, tempo) que ficou sem resposta boa.
- sumiu_pos_pitch: ouviu o preço e não disse mais nada.`;

async function gerarConteudo(entrada: string): Promise<(ConteudoNota & { motivo: MotivoTravamento }) | null> {
  try {
    const model = new ChatOpenAI({
      modelName: env.OPENAI_MODEL,
      openAIApiKey: env.OPENAI_API_KEY,
      temperature: 0.4,
      timeout: 60_000,
    }).withStructuredOutput(SchemaNota, { name: "nota_atendente" });
    const r = await model.invoke([
      { role: "system", content: PROMPT_NOTA },
      { role: "user", content: entrada },
    ]);
    return { ...r, comoAbordar: r.comoAbordar.slice(0, 2) };
  } catch (e) {
    logger.warn("nota-atendente", "Falha ao gerar o conteúdo da nota — sai só a parte fixa:", e);
    return null;
  }
}

type MensagemChatwoot = { message_type: number; content?: string | null; created_at: number; private?: boolean };

async function transcricaoRecente(idConversa: string | number): Promise<string> {
  const r = (await listarMensagens(env.CHATWOOT_ACCOUNT_ID, idConversa)) as { payload?: MensagemChatwoot[] };
  return (r.payload ?? [])
    .filter((m) => (m.message_type === 0 || m.message_type === 1) && !m.private && (m.content ?? "").trim())
    .slice(-30)
    .map((m) => `${m.message_type === 0 ? "LEAD" : "NÓS"}: ${(m.content ?? "").replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
}

export type GatilhoNota =
  | { tipo: "objecao"; objecao: TipoObjecao; fala: string; resposta: string }
  | { tipo: "sumico"; etapa: string; motivoProvavel: MotivoTravamento };

export function chaveNota(idConversa: string | number, gatilho: GatilhoNota): string {
  return gatilho.tipo === "objecao"
    ? `nota:${idConversa}:${gatilho.objecao}`
    : `nota:${idConversa}:sumiu:${gatilho.etapa.toLowerCase().replace(/\s+/g, "-")}`;
}

export interface PedidoNota {
  idConversa: string | number;
  telefone: string;
  /** Nome do contato ou título do card ("Karla - PCDF") — o modelo tira o primeiro nome. */
  nome: string;
  descricaoCard?: string;
  gatilho: GatilhoNota;
  agora?: Date;
}

/** Monta o texto da nota sem gravar nada — o envio e a trava ficam em criarNotaAtendente. */
export async function montarNotaAtendente(d: PedidoNota): Promise<{ motivo: MotivoTravamento; texto: string }> {
  const agora = d.agora ?? new Date();
  const motivoInicial = d.gatilho.tipo === "objecao" ? motivoDaObjecao(d.gatilho.objecao) : d.gatilho.motivoProvavel;
  const [dadosFormulario, transcricao, objecoesAnteriores] = await Promise.all([
    buscarDadosFormulario(d.telefone),
    transcricaoRecente(d.idConversa).catch(() => ""),
    listarAlertasDesde(`objecao:${d.idConversa}:`, new Date(0)).catch(() => []),
  ]);

  const contexto = [
    d.gatilho.tipo === "objecao"
      ? `Gatilho: o lead levantou uma objeção (${d.gatilho.objecao}). Fala dele: "${d.gatilho.fala}". Resposta que a IA está mandando: "${d.gatilho.resposta.slice(0, 600)}"`
      : `Gatilho: o lead parou de responder e a régua automática de follow-up acabou (etapa ${d.gatilho.etapa}). Motivo provável pelo código: ${ROTULO_MOTIVO[d.gatilho.motivoProvavel]}.`,
    `Nome do lead: ${d.nome || "desconhecido (não use nome)"}`,
    objecoesAnteriores.length > 0 ? `Objeções já registradas nesta conversa: ${objecoesAnteriores.map((o) => o.motivo).join(", ")}` : "",
    `Card do funil: ${d.descricaoCard ?? "—"}`,
    `Formulário de aplicação: ${dadosFormulario || "não encontrado"}`,
    `Conversa (mais recente por último):\n${transcricao || "(sem histórico)"}`,
  ].filter(Boolean).join("\n\n");

  const conteudo = await gerarConteudo(contexto);
  // Na objeção o tipo já veio do classificador; no sumiço o modelo lê a conversa e pode achar
  // um motivo melhor (ex.: a dúvida de material que ficou sem resposta).
  const motivo = d.gatilho.tipo === "sumico" && conteudo ? conteudo.motivo : motivoInicial;
  const retomada = lerRetomada(d.descricaoCard ?? "")?.momento ?? null;
  const texto = formatarNota({ motivo, quando: quandoAbordar(motivo, agora, retomada), conteudo, dadosFormulario });
  return { motivo, texto };
}

/**
 * Cria a nota privada na conversa (uma vez por gatilho). Nunca lança: quem chama é o turno do lead
 * ou a régua de follow-up, e uma nota que falha não pode derrubar nenhum dos dois.
 * Devolve o motivo usado (ou null se não criou).
 */
export async function criarNotaAtendente(d: PedidoNota): Promise<MotivoTravamento | null> {
  if (!env.NOTA_ATENDENTE_ATIVA) return null;
  const chave = chaveNota(d.idConversa, d.gatilho);
  const motivoInicial = d.gatilho.tipo === "objecao" ? motivoDaObjecao(d.gatilho.objecao) : d.gatilho.motivoProvavel;

  try {
    if (!(await reivindicarAlerta(chave, d.telefone, motivoInicial))) return null;
  } catch (e) {
    logger.warn("nota-atendente", "Erro na trava da nota — pulando para não duplicar:", e);
    return null;
  }

  try {
    const { motivo, texto } = await montarNotaAtendente(d);
    await enviarMensagem(env.CHATWOOT_ACCOUNT_ID, d.idConversa, texto, { private: true });
    logger.info("nota-atendente", "Nota pro atendente criada", { idConversa: d.idConversa, motivo, gatilho: d.gatilho.tipo });
    return motivo;
  } catch (e) {
    await liberarAlerta(chave).catch(() => {});
    logger.warn("nota-atendente", "Falha ao criar a nota pro atendente:", e);
    return null;
  }
}
