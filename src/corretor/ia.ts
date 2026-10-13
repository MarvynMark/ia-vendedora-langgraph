// Chamadas de IA do corretor: ler o manuscrito (foto/PDF), ajustar a transcrição a pedido do aluno
// e avaliar a resposta.
//
// A leitura vai direto na API de Chat Completions: precisamos mandar imagem e PDF na mesma
// mensagem (o PDF escaneado vira páginas para o modelo), e o formato "file" não passa pelo
// ChatOpenAI do LangChain. A avaliação usa ChatOpenAI + structured output, como o resto do app,
// para cair no Langfuse.
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { comRetry } from "../lib/retry.ts";
import { criarLangfuseHandler, finalizarLangfuseHandler } from "../lib/langfuse.ts";
import { logger } from "../lib/logger.ts";
import { numerarLinhas } from "./regras.ts";
import type { AvaliacaoIA, PerfilConcurso } from "./tipos.ts";

export interface Anexo {
  tipo: string;   // file_type do Chatwoot: "image" | "file" | ...
  url: string;
}

const LIMITE_BYTES = 20 * 1024 * 1024;

export type ParteConteudo =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } }
  | { type: "file"; file: { filename: string; file_data: string } };

function tipoPorExtensao(url: string): string | null {
  const ext = url.split("?")[0]!.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

/** Baixa o anexo do Chatwoot e devolve no formato que a API aceita (imagem ou PDF). */
export async function anexoParaConteudo(anexo: Anexo, indice: number): Promise<ParteConteudo> {
  const res = await fetchComTimeout(anexo.url, { timeout: 60_000 });
  if (!res.ok) throw new Error(`[corretor] Falha ao baixar anexo (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const cabecalho = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const mime = cabecalho.startsWith("image/") || cabecalho === "application/pdf" ? cabecalho : tipoPorExtensao(anexo.url);
  return bytesParaConteudo(bytes, mime, indice);
}

/** Bytes de uma foto/PDF → parte de conteúdo da API (também usado pelo script de teste local). */
export function bytesParaConteudo(bytes: Uint8Array, mime: string | null, indice: number): ParteConteudo {
  if (bytes.length > LIMITE_BYTES) throw new ErroAnexo("O arquivo passa de 20 MB. Mande fotos das páginas ou um PDF menor.");
  if (!mime) throw new ErroAnexo("Consigo ler foto, PDF ou texto. Esse tipo de arquivo eu não consigo abrir.");
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  return mime === "application/pdf"
    ? { type: "file", file: { filename: `pagina-${indice + 1}.pdf`, file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl, detail: "high" } };
}

export { tipoPorExtensao };

/** Erro com mensagem que pode ir direto para o aluno. */
export class ErroAnexo extends Error {}

async function chamarJson<T>(
  sistema: string,
  conteudo: ParteConteudo[],
  nome: string,
  schema: Record<string, unknown>,
): Promise<T> {
  return comRetry(async () => {
    const res = await fetchComTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.CORRETOR_MODELO,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: conteudo },
        ],
        response_format: { type: "json_schema", json_schema: { name: nome, strict: true, schema } },
      }),
      timeout: 180_000,
    });
    if (!res.ok) throw new Error(`[corretor] OpenAI ${nome} falhou (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
      usage?: Record<string, unknown>;
    };
    const msg = data.choices?.[0]?.message;
    if (!msg?.content) throw new Error(`[corretor] OpenAI ${nome} sem conteúdo${msg?.refusal ? `: ${msg.refusal}` : ""}`);
    logger.info("corretor", `OpenAI ${nome} ok`, { usage: data.usage });
    return JSON.parse(msg.content) as T;
  }, 2, 2000);
}

const PROMPT_TRANSCRICAO = `Você transcreve respostas manuscritas de provas discursivas de concurso.

Regras:
- Transcreva EXATAMENTE o que o candidato escreveu, linha por linha da folha, na ordem das páginas recebidas.
- NÃO corrija nada: mantenha erros de grafia, acentuação, pontuação, concordância e as palavras partidas no fim da linha (com o hífen, se houver).
- Cada linha escrita da folha vira um item da lista "linhas". Linhas em branco no meio do texto podem ser omitidas.
- Não inclua a numeração impressa na folha, cabeçalhos, nomes de campos, carimbos ou o enunciado da questão: só o texto do candidato.
- Palavra que você não consegue ler com segurança vira [ilegível]. Nunca invente.
- Em "aviso", escreva em uma frase curta qualquer problema que o candidato precise saber (foto cortada, desfocada, página aparentemente faltando, o arquivo não parece uma resposta). Se não houver problema, deixe vazio.`;

/** Lê as fotos/PDFs da resposta e devolve as linhas exatamente como o aluno escreveu. */
export async function transcreverResposta(anexos: Anexo[] | ParteConteudo[]): Promise<{ linhas: string[]; aviso: string }> {
  const conteudo: ParteConteudo[] = [{ type: "text", text: `Transcreva a resposta manuscrita (${anexos.length} arquivo(s), em ordem).` }];
  for (const [i, a] of anexos.entries()) conteudo.push("type" in a ? a : await anexoParaConteudo(a, i));
  const r = await chamarJson<{ linhas: string[]; aviso: string }>(PROMPT_TRANSCRICAO, conteudo, "transcricao", {
    type: "object",
    properties: { linhas: { type: "array", items: { type: "string" } }, aviso: { type: "string" } },
    required: ["linhas", "aviso"],
    additionalProperties: false,
  });
  return { linhas: r.linhas.map((l) => l.trim()).filter(Boolean), aviso: r.aviso.trim() };
}

/** Lê o enunciado mandado em foto/PDF. */
export async function transcreverEnunciado(anexos: Anexo[]): Promise<string> {
  const conteudo: ParteConteudo[] = [{ type: "text", text: "Transcreva o enunciado (comando) da questão discursiva." }];
  for (const [i, a] of anexos.entries()) conteudo.push(await anexoParaConteudo(a, i));
  const r = await chamarJson<{ enunciado: string }>(
    "Você transcreve enunciados de questões de prova. Transcreva o comando completo da questão, com todos os subitens, sem resumir nem comentar. Se houver texto de apoio, inclua. Se não houver enunciado legível, devolva vazio.",
    conteudo,
    "enunciado",
    { type: "object", properties: { enunciado: { type: "string" } }, required: ["enunciado"], additionalProperties: false },
  );
  return r.enunciado.trim();
}

/** O aluno corrigiu a transcrição ("na linha 5 é perícia"): aplica só o que ele pediu. */
export async function ajustarTranscricao(linhas: string[], pedido: string): Promise<{ linhas: string[]; entendeu: boolean }> {
  const r = await chamarJson<{ linhas: string[]; entendeu: boolean }>(
    `Você mantém a transcrição de uma resposta manuscrita. O candidato está apontando o que ficou errado na transcrição.
Aplique SOMENTE as alterações que ele pediu, nas linhas indicadas, e devolva a transcrição completa, linha por linha, sem numeração.
Não corrija mais nada por conta própria: erros de português do candidato devem permanecer.
Se a mensagem dele não for um pedido de ajuste da transcrição, devolva as linhas sem mudança e entendeu = false.`,
    [{ type: "text", text: `TRANSCRIÇÃO ATUAL:\n${numerarLinhas(linhas)}\n\nMENSAGEM DO CANDIDATO:\n${pedido}` }],
    "ajuste_transcricao",
    {
      type: "object",
      properties: { linhas: { type: "array", items: { type: "string" } }, entendeu: { type: "boolean" } },
      required: ["linhas", "entendeu"],
      additionalProperties: false,
    },
  );
  return { linhas: r.linhas.map((l) => l.replace(/^\d{1,2}\.\s/, "").trim()).filter(Boolean), entendeu: r.entendeu };
}

const PROMPT_ESPELHO = `Você monta o espelho técnico de uma questão discursiva de concurso a partir SOMENTE do enunciado, antes de ler qualquer resposta.

Liste os elementos EXIGIDOS: o que o comando pede expressamente.
- Granularidade (siga à risca, para que a mesma questão gere sempre o mesmo espelho):
  • um elemento por AÇÃO pedida sobre cada OBJETO: "diferencie X e Y, apresentando exemplos" → "diferença entre X e Y" + "exemplos de X e de Y"; "a finalidade de H e sua importância para I" → "finalidade de H" + "importância de H para I"; "procedimentos de preservação e aquisição" → "procedimentos de preservação" + "procedimentos de aquisição";
  • qualidades do MESMO objeto ficam juntas: "importância de C para a validade e a confiabilidade" → um elemento só.
- Cada elemento diz o que precisa aparecer na resposta, de forma concreta e verificável, no MESMO nível de especificidade do comando. Se o comando diz "procedimentos adequados de preservação", o elemento é "procedimentos de preservação" — técnicas específicas (isolar a rede, bloqueador de escrita, bolsa de Faraday…) entram apenas como EXEMPLOS aceitos no "atendidoSe", nunca como elementos próprios.
- Exceção: quando o comando NOMEIA um conjunto fechado e conhecido (os requisitos de X, as etapas de Y, as fases de Z), crie UM elemento para CADA componente que a doutrina ou a técnica consolidada considera indispensável, nomeando-o (ex.: "descreva as etapas da PCR" → desnaturação; anelamento dos iniciadores; extensão). É assim que a banca corrige: veja o exemplo de padrão oficial abaixo.
- NÃO inclua condutas, técnicas ou conhecimentos que o comando não pede, por mais relevantes que sejam: eles são aprofundamento, não exigência.
- Se o enunciado narra um caso, NÃO crie um elemento só de "aplicar ao caso": a aplicação ao caso é avaliada na elaboração crítica. Só crie elemento sobre o caso se o comando pedir algo expressamente sobre ele (ex.: "no caso descrito, indique…").
- NÃO inclua requisitos de forma (gênero textual, número de linhas, extensão, letra): o sistema confere isso separadamente.
- Em "comando", copie o trecho do enunciado que exige o elemento.
- Em "atendidoSe", escreva o critério mínimo e objetivo para o elemento contar como ATENDIDO, no nível de exigência da banca (o que basta, não o ideal). Ex.: "ATENDIDO se citar ao menos uma medida concreta de preservação (ex.: documentar o estado, isolar quando indicado, coletar voláteis); PARCIAL se só disser que é preciso preservar, sem medida concreta". Esse critério fixa a fronteira entre ATENDIDO e PARCIAL para todas as correções desta questão. Quando houver várias condutas tecnicamente adequadas, o critério aceita QUALQUER uma delas (lista aberta de exemplos), não uma conduta preferida.`;


/** Itens EXIGIDOS do espelho, montados só a partir do enunciado (sem ver a resposta). */
const SCHEMA_ITENS_ESPELHO = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: { elemento: { type: "string" }, comando: { type: "string" }, atendidoSe: { type: "string" } },
        required: ["elemento", "comando", "atendidoSe"],
        additionalProperties: false,
      },
    },
  },
  required: ["itens"],
  additionalProperties: false,
};

export interface ItemEspelho {
  elemento: string;
  comando: string;
  atendidoSe: string;
}

export async function montarEspelhoExigido(perfil: PerfilConcurso, enunciado: string): Promise<ItemEspelho[]> {
  const r = await chamarJson<{ itens: ItemEspelho[] }>(
    `${PROMPT_ESPELHO}\n\nConcurso: ${perfil.nome} (${perfil.banca}).\n\nEXEMPLO DE PADRÃO OFICIAL DA BANCA (granularidade de referência; não é a questão a corrigir):\n${perfil.exemploEspelhoOficial}`,
    [{ type: "text", text: `ENUNCIADO:\n${enunciado}` }],
    "espelho_exigido",
    SCHEMA_ITENS_ESPELHO,
  );
  return r.itens.filter((i) => i.elemento.trim());
}

/**
 * Espelho da questão por maioria: monta 3 em paralelo e fica com o de estrutura (nº de itens) mais
 * frequente. A montagem única variava (o mesmo enunciado saía com 6 ou 7 itens), e o espelho
 * escolhido fica salvo como a régua da questão — só acontece uma vez por enunciado.
 */
export async function montarEspelhoPorMaioria(perfil: PerfilConcurso, enunciado: string): Promise<ItemEspelho[]> {
  const tentativas = (await Promise.allSettled([1, 2, 3].map(() => montarEspelhoExigido(perfil, enunciado))))
    .flatMap((t) => (t.status === "fulfilled" && t.value.length ? [t.value] : []));
  if (!tentativas.length) throw new Error("[corretor] Nenhuma montagem de espelho deu certo");
  const contagem = new Map<number, number>();
  for (const t of tentativas) contagem.set(t.length, (contagem.get(t.length) ?? 0) + 1);
  const maisFrequente = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  return tentativas.find((t) => t.length === maisFrequente)!;
}

function schemaAvaliacao(perfil: PerfilConcurso) {
  const criterios = Object.fromEntries(perfil.criterios.map((c) => [
    c.sigla,
    z.object({
      faixa: z.enum(c.faixas.map((f) => f.codigo) as [string, ...string[]])
        .describe(`Faixa da rubrica de ${c.nome} cujo descritor corresponde à resposta.`),
      nota: z.number().describe(`Nota de ${c.nome} DENTRO da faixa escolhida, com até duas casas decimais.`),
      justificativa: z.string().describe("Qual descritor da faixa se aplica e o trecho do aluno que comprova. Se não for a faixa máxima, o item EXIGIDO que impediu."),
    }),
  ]));
  return z.object({
    oQueAQuestaoExigia: z.string().describe("O comando explicado: verbos, subitens e recortes."),
    espelhoExigido: z.array(z.object({
      item: z.number().int().describe("Número do item no ESPELHO EXIGIDO recebido."),
      status: z.enum(["ATENDIDO", "PARCIAL", "NAO_ATENDIDO", "INCORRETO"]),
      comentario: z.string().describe("O que o aluno efetivamente escreveu sobre esse item (curto, citando o texto)."),
    })).describe("Uma classificação para CADA item do espelho exigido, na mesma ordem."),
    aprofundamentos: z.array(z.object({
      elemento: z.string().describe("Conhecimento complementar, não pedido pelo comando."),
      status: z.enum(["ATENDIDO", "PARCIAL", "NAO_ATENDIDO", "INCORRETO"]),
      comentario: z.string(),
    })).describe("No máximo 3. Valorizam a resposta; a ausência não desconta. INCORRETO se o aluno afirmou algo errado."),
    criterios: z.object(criterios),
    errosPortugues: z.array(z.object({
      linha: z.number().int().describe("Número da linha da transcrição onde está o erro."),
      trecho: z.string(),
      correcao: z.string(),
      tipo: z.string().describe("acentuação, grafia, pontuação, concordância, regência, morfossintaxe, propriedade vocabular ou translineação"),
      explicacao: z.string(),
    })).describe("Cada erro efetivo uma única vez. Vazio se não houver."),
    fugaAoTema: z.boolean(),
    identificacaoIndevida: z.boolean().describe("Nome, assinatura ou marca que identifique o candidato no texto."),
    pontosFortes: z.array(z.string()).describe("Até 2 pontos fortes REAIS."),
    ondePerdeu: z.array(z.string()).describe("Os maiores problemas, do mais grave ao menos grave."),
    prioridades: z.array(z.string()).describe("Exatamente 3 ações específicas para a próxima resposta."),
    espelhoIdeal: z.array(z.string()).describe("O que deveria aparecer numa resposta nota máxima."),
    respostaModelo: z.string().describe("Resposta de alto nível, em texto corrido, cabendo nas linhas do edital."),
    veredito: z.string().describe("Comentário curto, direto e individualizado do Professor Vestigium."),
  });
}

export interface EntradaAvaliacao {
  perfil: PerfilConcurso;
  area: string | null;
  enunciado: string;
  exigidos: ItemEspelho[];
  linhas: string[];            // já cortadas no máximo do edital
  linhasDescartadas: number;
  digitada: boolean;
  linhasEstimadas: boolean;
  telefone: string;
}

export async function avaliarResposta(e: EntradaAvaliacao): Promise<AvaliacaoIA> {
  const modelo = new ChatOpenAI({
    modelName: env.CORRETOR_MODELO,
    openAIApiKey: env.OPENAI_API_KEY,
    timeout: 240_000,
  }).withStructuredOutput(schemaAvaliacao(e.perfil), { name: "correcao_discursiva" });

  const origem = e.digitada
    ? `Resposta DIGITADA pelo aluno no WhatsApp${e.linhasEstimadas ? " — as linhas abaixo são uma ESTIMATIVA do sistema, não a folha do aluno: avalie o texto INTEIRO, não conte translineação e NÃO comente nem desconte nada pela quantidade de linhas (o sistema trata disso)" : " — linhas quebradas pelo próprio aluno"}.`
    : "Resposta MANUSCRITA, transcrita da foto/PDF e conferida pelo aluno.";
  const entrada = [
    `COMANDO DA QUESTÃO:\n${e.enunciado}`,
    origem,
    `ESPELHO EXIGIDO (fixo, montado a partir do enunciado — classifique cada item pelo critério dele; não acrescente nem remova itens exigidos):\n${e.exigidos.map((x, i) => `${i + 1}. ${x.elemento} [comando: "${x.comando}"]${x.atendidoSe ? `\n   Critério: ${x.atendidoSe}` : ""}`).join("\n")}`,
    `RESPOSTA DO ALUNO (${e.linhas.length} linha(s) consideradas${e.linhasDescartadas ? `; ${e.linhasDescartadas} linha(s) após a ${e.perfil.linhasMax}ª foram desconsideradas e não aparecem aqui` : ""}):\n${numerarLinhas(e.linhas)}`,
  ].join("\n\n");

  const handler = criarLangfuseHandler("corretor-redacao", {
    sessionId: e.telefone,
    tags: ["corretor", e.perfil.codigo],
    metadata: { area: e.area, digitada: e.digitada },
  });
  try {
    const r = await modelo.invoke(
      [
        { role: "system", content: e.perfil.promptSistema(e.area) },
        { role: "user", content: entrada },
      ],
      handler ? { callbacks: [handler] } : undefined,
    );
    type Bruta = Omit<AvaliacaoIA, "espelho"> & {
      espelhoExigido: Array<{ item: number; status: AvaliacaoIA["espelho"][number]["status"]; comentario: string }>;
      aprofundamentos: Array<{ elemento: string; status: AvaliacaoIA["espelho"][number]["status"]; comentario: string }>;
    };
    const { espelhoExigido, aprofundamentos, ...resto } = r as unknown as Bruta;
    // Item exigido que a IA não classificou não pode sumir do espelho (nem da contagem da faixa).
    const espelho: AvaliacaoIA["espelho"] = e.exigidos.map((x, i) => {
      const c = espelhoExigido.find((y) => y.item === i + 1);
      return c
        ? { elemento: x.elemento, origem: "EXIGIDO" as const, status: c.status, comentario: c.comentario }
        : { elemento: x.elemento, origem: "EXIGIDO" as const, status: "NAO_ATENDIDO" as const, comentario: "(não classificado pela correção)" };
    });
    for (const a of aprofundamentos.slice(0, 3)) espelho.push({ ...a, origem: "APROFUNDAMENTO" });
    return { ...resto, espelho };
  } finally {
    await finalizarLangfuseHandler(handler);
  }
}
