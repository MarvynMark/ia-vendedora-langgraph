// Lead da LP lp.mentoriavestigium.com.br/lista-vip (Black Antecipada, 03/11/2026).
// A página manda dois eventos ao mesmo webhook, ligados pelo lead_id que ela gera:
//   "cadastro" — nome, WhatsApp, e-mail e UTMs, no envio do formulário;
//   "pesquisa" — as 4 respostas da página de obrigado (ou só as que o lead respondeu antes de pular).
// Aqui fica só o que é puro (validação, colunas, linha); a gravação está em services/google-sheets.ts.

import { z } from "zod";
import { carimboBrasilia, comoTexto } from "./planilha-alunos.ts";

export const ETIQUETA_BLACK = "black-2026";
export const ORIGEM_BLACK = "LP Lista VIP (Black 2026)";

const texto = (max: number) => z.string().trim().max(max);

const cadastroSchema = z.object({
  evento: z.literal("cadastro"),
  lead_id: z.string().uuid(),
  nome: texto(120).min(2),
  whatsapp: z.string().regex(/^\d{10,13}$/),
  email: texto(160).email(),
  pagina: texto(300).optional(),
  utm_source: texto(200).optional(),
  utm_medium: texto(200).optional(),
  utm_campaign: texto(200).optional(),
  utm_content: texto(200).optional(),
  utm_term: texto(200).optional(),
  fbclid: texto(500).optional(),
});

const pesquisaSchema = z.object({
  evento: z.literal("pesquisa"),
  lead_id: z.string().uuid(),
  completa: z.boolean().optional(),
  respostas: z.object({
    cargo: texto(120).optional(),
    tempo_estudo: texto(120).optional(),
    dificuldade: texto(120).optional(),
    intencao: texto(120).optional(),
  }),
});

export const eventoBlackSchema = z.discriminatedUnion("evento", [cadastroSchema, pesquisaSchema]);
export type EventoBlack = z.infer<typeof eventoBlackSchema>;
export type CadastroBlack = z.infer<typeof cadastroSchema>;
export type PesquisaBlack = z.infer<typeof pesquisaSchema>;

// Títulos da linha 1 da aba, na ordem em que são criados quando faltam. A busca é pelo título, não
// pela posição: dá para reordenar ou inserir colunas na planilha sem quebrar a gravação.
export const COLUNAS = {
  data: "Carimbo de data/hora",
  leadId: "Lead ID",
  nome: "Nome",
  whatsapp: "WhatsApp",
  email: "E-mail",
  cargo: "Cargo",
  tempoEstudo: "Tempo de estudo",
  dificuldade: "Maior dificuldade",
  intencao: "Entra na condição de 03/11?",
  pesquisaCompleta: "Pesquisa completa",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
  utmTerm: "utm_term",
  fbclid: "fbclid",
  pagina: "Página",
  origem: "Origem",
} as const;

/** "55" + DDD + número → "+55...", o formato que o Chatwoot guarda. */
export function telefoneE164(whatsapp: string): string {
  const d = whatsapp.replace(/\D/g, "");
  return `+${d.startsWith("55") ? d : `55${d}`}`;
}

/** Valores por título de coluna. Campo vazio fica de fora, para não apagar o que já estava na linha. */
export function valoresDoCadastro(c: CadastroBlack, recebidoEm: Date): Record<string, string> {
  return limpar({
    [COLUNAS.data]: carimboBrasilia(recebidoEm),
    [COLUNAS.leadId]: c.lead_id,
    [COLUNAS.nome]: c.nome,
    [COLUNAS.whatsapp]: telefoneE164(c.whatsapp),
    [COLUNAS.email]: c.email,
    [COLUNAS.utmSource]: c.utm_source,
    [COLUNAS.utmMedium]: c.utm_medium,
    [COLUNAS.utmCampaign]: c.utm_campaign,
    [COLUNAS.utmContent]: c.utm_content,
    [COLUNAS.utmTerm]: c.utm_term,
    [COLUNAS.fbclid]: c.fbclid,
    [COLUNAS.pagina]: c.pagina,
    [COLUNAS.origem]: ORIGEM_BLACK,
  });
}

export function valoresDaPesquisa(p: PesquisaBlack): Record<string, string> {
  return limpar({
    [COLUNAS.leadId]: p.lead_id,
    [COLUNAS.cargo]: p.respostas.cargo,
    [COLUNAS.tempoEstudo]: p.respostas.tempo_estudo,
    [COLUNAS.dificuldade]: p.respostas.dificuldade,
    [COLUNAS.intencao]: p.respostas.intencao,
    [COLUNAS.pesquisaCompleta]: p.completa === undefined ? undefined : (p.completa ? "Sim" : "Não"),
  });
}

/** Atributos do contato no Chatwoot a partir da pesquisa (chaves com prefixo black_). */
export function atributosDaPesquisa(p: PesquisaBlack): Record<string, string> {
  const r = p.respostas;
  const v: Record<string, string | undefined> = {
    black_cargo: r.cargo,
    black_tempo_estudo: r.tempo_estudo,
    black_dificuldade: r.dificuldade,
    black_intencao: r.intencao,
  };
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => Boolean(e[1])));
}

function limpar(v: Record<string, string | undefined>): Record<string, string> {
  const r: Record<string, string> = {};
  // O carimbo é a única célula que deve virar data (gravação em USER_ENTERED); o resto vai como texto.
  for (const [k, val] of Object.entries(v)) if (val) r[k] = k === COLUNAS.data ? val : comoTexto(val);
  return r;
}

/**
 * Mescla `valores` numa linha da aba. `cabecalho` é a linha 1 atual (vazia numa aba nova) e
 * `linhaAtual`, a linha já gravada do lead (vazia se ele ainda não existe). Numa aba vazia o
 * cabeçalho vira COLUNAS inteiro; numa aba já montada, colunas que faltarem entram no fim.
 * Nada que já estava na linha é apagado.
 */
export function mesclarLinha(opts: {
  cabecalho: string[];
  linhaAtual: string[];
  valores: Record<string, string>;
}): { cabecalho: string[]; cabecalhoMudou: boolean; linha: string[] } {
  const cabecalho = [...opts.cabecalho];
  while (cabecalho.length && !cabecalho[cabecalho.length - 1]!.trim()) cabecalho.pop();
  const tamanhoOriginal = cabecalho.length;

  const ordem: string[] = Object.values(COLUNAS);
  // Aba vazia ganha todas as colunas de uma vez, para as da pesquisa ficarem ao lado do contato
  // e não no fim, depois das UTMs.
  if (!cabecalho.length) cabecalho.push(...ordem);
  const titulos = Object.keys(opts.valores).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  for (const t of titulos) {
    if (!cabecalho.some(c => c.trim() === t)) cabecalho.push(t);
  }

  const linha = cabecalho.map((c, i) => opts.valores[c.trim()] ?? opts.linhaAtual[i] ?? "");
  const cabecalhoMudou = cabecalho.length > tamanhoOriginal;
  return { cabecalho: cabecalhoMudou ? cabecalho : opts.cabecalho, cabecalhoMudou, linha };
}

/** Índice (0-based, contando o cabeçalho como 0) da linha do lead, ou -1. */
export function indiceDoLead(linhas: string[][], cabecalho: string[], leadId: string): number {
  const col = cabecalho.findIndex(c => c.trim() === COLUNAS.leadId);
  if (col < 0) return -1;
  for (let i = 1; i < linhas.length; i++) {
    if ((linhas[i]?.[col] ?? "").trim() === leadId) return i;
  }
  return -1;
}
