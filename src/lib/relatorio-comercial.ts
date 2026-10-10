// Relatório diário do grupo do comercial (decisão do Gusthavo, 09/10/2026): todo dia às 8h, com o
// dia ANTERIOR — aplicações por concurso/cargo/resposta do formulário, o funil de hoje e a agenda
// do dia (lista quente). Às segundas vem também o termômetro da semana.
//
// Sai em mensagens separadas porque a agenda é para AGIR e os números são para LER; numa mensagem
// só a agenda ficava enterrada no fim.

import { env } from "../config/env.ts";
import { avisarGrupo, type KanbanTaskResumo } from "../services/chatwoot.ts";
import { listarAplicacoes, buscarPerfisPorTelefones, type Aplicacao } from "../db/formulario.ts";
import { reivindicarAlerta, liberarAlerta, listarAlertasDesde } from "../db/alertas.ts";
import { RE_LINK_ENVIADO } from "./delays-followup.ts";
import { ehMedicoPorFormacao } from "./medico.ts";
import { ROTULO_MOTIVO, type MotivoTravamento } from "./nota-atendente.ts";
import {
  varrerBoard, analisarConversa, classificarCard, ordenarListaQuente, displayIdDoCard, STEP,
  type ItemListaQuente,
} from "./lista-quente.ts";
import { logger } from "./logger.ts";

const DIA = 86_400_000;
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;
const TOP_AGENDA = 10;

/** Meia-noite de São Paulo do dia de `d`, em UTC. */
export function inicioDoDiaSP(d: Date): Date {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()) - SP_OFFSET_MS);
}

function rotuloData(d: Date): string {
  const sp = new Date(d.getTime() + SP_OFFSET_MS);
  return `${String(sp.getUTCDate()).padStart(2, "0")}/${String(sp.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Classificação das aplicações ────────────────────────────────────────────

// "concurso_desejado" é texto livre ("PCDF e PCERJ", "polícia científica de SC", "qualquer um").
const UFS: Array<[string, RegExp]> = [
  ["DF", /\b(pc)?df\b|distrito federal|bras[ií]lia/],
  ["RJ", /\b(pc)?e?rj\b|rio de janeiro|\brio\b(?! grande)/],
  ["SP", /\b(pc)?sp\b|s[ãa]o paulo/],
  ["MG", /\b(pc)?mg\b|minas/],
  ["ES", /\b(pc)?i?es\b|esp[ií]rito santo/],
  ["MA", /\b(pc)?ma\b|maranh[ãa]o/],
  ["TO", /\b(pc)?to\b|tocantins/],
  ["BA", /\b(pc)?ba\b|bahia/],
  ["SC", /\b(pc)?i?sc\b|santa catarina/],
  ["RS", /\b(pc)?rs\b|rio grande do sul|\bigp\b/],
  ["PR", /\b(pc)?pr\b|paran[áa]/],
  ["GO", /\b(pc)?go\b|goi[áa]s/],
  ["PE", /\b(pc)?pe\b|pernambuco/],
  ["CE", /\b(pc)?ce\b|cear[áa]/],
  ["PF", /\bpf\b|pol[ií]cia federal/],
];

export function estadoDoConcurso(concurso: string | null | undefined): string {
  const c = (concurso ?? "").toLowerCase();
  if (!c.trim()) return "Não informado";
  if (/qualquer|todos|tanto faz|o que (sair|abrir)|pr[óo]ximo/.test(c)) return "Qualquer um";
  const achados = UFS.filter(([, re]) => re.test(c)).map(([uf]) => uf);
  if (achados.length === 0) return "Outro";
  if (achados.length > 1) return "Vários";
  return achados[0]!;
}

/** Agrupa as respostas de "disposto a investir" (o formulário teve 3 versões da pergunta). */
export function grupoInvestimento(resposta: string | null | undefined): string {
  const r = (resposta ?? "").toLowerCase();
  if (!r.trim()) return "Sem resposta";
  const faixa = /at[ée]\s*r\$\s*(\d+)/.exec(r);
  if (faixa) return `Até R$ ${faixa[1]}`;
  if (/n[ãa]o|agora n/.test(r)) return "Não";
  if (/sim/.test(r)) return "Sim";
  return "Outro";
}

function contar<T>(itens: T[], chave: (i: T) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const i of itens) m.set(chave(i), (m.get(chave(i)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const linhaContagem = (pares: Array<[string, number]>) => pares.map(([k, n]) => `${n} ${k}`).join(" · ");

// ── Coleta ──────────────────────────────────────────────────────────────────

export interface DadosFunil {
  porEtapa: Record<keyof typeof STEP, number>;
  linkEnviado: number;
  emFollowup: number;
  ganhosNoPeriodo: number;
  perdidosNoPeriodo: number;
}

export function resumirFunil(cards: KanbanTaskResumo[], ontemInicio: Date, ontemFim: Date): DadosFunil {
  const porEtapa = Object.fromEntries(Object.keys(STEP).map((k) => [k, 0])) as Record<keyof typeof STEP, number>;
  const idParaChave = new Map(Object.entries(STEP).map(([k, id]) => [id as number, k as keyof typeof STEP]));
  let linkEnviado = 0;
  let emFollowup = 0;
  let ganhosNoPeriodo = 0;
  let perdidosNoPeriodo = 0;
  const noDia = (iso?: string) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= ontemInicio.getTime() && t < ontemFim.getTime();
  };

  for (const c of cards) {
    const chave = idParaChave.get(c.board_step_id);
    if (chave) porEtapa[chave]++;
    const desc = c.description ?? "";
    if (c.board_step_id === STEP.aguardandoPagamento && RE_LINK_ENVIADO.test(desc)) linkEnviado++;
    const ativo = [STEP.primeiraMensagem, STEP.conexao, STEP.aguardandoPagamento].includes(c.board_step_id as 7 | 10 | 8);
    if (ativo && /Follow-ups:\s*[1-9]/.test(desc) && !/Follow-ups conclu[íi]dos/.test(desc)) emFollowup++;
    if (c.board_step_id === STEP.ganho && noDia(c.step_changed_at)) ganhosNoPeriodo++;
    if (c.board_step_id === STEP.perdido && noDia(c.step_changed_at)) perdidosNoPeriodo++;
  }
  return { porEtapa, linkEnviado, emFollowup, ganhosNoPeriodo, perdidosNoPeriodo };
}

async function montarListaQuente(cards: KanbanTaskResumo[], agora: Date): Promise<ItemListaQuente[]> {
  const alvo = cards.filter((c) => c.board_step_id === STEP.aguardandoPagamento || c.board_step_id === STEP.conexao);
  const analises = new Map<number, Awaited<ReturnType<typeof analisarConversa>>>();
  for (const c of alvo) {
    const id = displayIdDoCard(c);
    if (id) analises.set(c.id, await analisarConversa(id));
  }
  const perfis = await buscarPerfisPorTelefones([...analises.values()].map((a) => a?.telefone ?? ""));
  const objecoesPreco = new Map<string, Date>();
  for (const o of await listarAlertasDesde("objecao:", new Date(agora.getTime() - 30 * DIA))) {
    const [, conv, tipo] = o.chave.split(":");
    if (tipo === "preco" && conv) objecoesPreco.set(conv, o.criado_em);
  }

  const itens: ItemListaQuente[] = [];
  for (const card of alvo) {
    const analise = analises.get(card.id);
    if (!analise) continue;
    const item = classificarCard({
      card,
      analise,
      perfil: perfis.get(analise.telefone.replace(/\D/g, "").slice(-8)) ?? null,
      objecaoPrecoEm: objecoesPreco.get(String(displayIdDoCard(card))) ?? null,
      agora,
    });
    if (item) itens.push(item);
  }
  return ordenarListaQuente(itens);
}

// ── Mensagens ───────────────────────────────────────────────────────────────

export function montarMensagemNumeros(d: { dataRef: Date; aplicacoes: Aplicacao[]; funil: DadosFunil }): string {
  const { aplicacoes: aps, funil: f } = d;
  const medicos = aps.filter((a) => ehMedicoPorFormacao(a.formacao)).length;
  const e = f.porEtapa;
  const linhas = [
    `📊 *RELATÓRIO COMERCIAL — ${rotuloData(d.dataRef)}*`,
    "",
    `*Aplicações ontem: ${aps.length}*`,
  ];
  if (aps.length > 0) {
    linhas.push(
      `Concurso: ${linhaContagem(contar(aps, (a) => estadoDoConcurso(a.concurso)))}`,
      `Cargo: ${medicos} médico legista · ${aps.length - medicos} perito`,
      `Disposto a investir: ${linhaContagem(contar(aps, (a) => grupoInvestimento(a.dispostoInvestir)))}`,
      `Quando quer entrar: ${linhaContagem(contar(aps, (a) => a.quandoEntrar?.trim() || "Sem resposta"))}`,
    );
  }
  linhas.push(
    "",
    `*Ontem:* ${f.ganhosNoPeriodo} ganho(s) · ${f.perdidosNoPeriodo} perdido(s)`,
    "",
    "*Funil hoje*",
    `Novo Lead ${e.novoLead} · Primeira mensagem ${e.primeiraMensagem} · Conexão ${e.conexao} · Sessão agendada ${e.sessaoAgendada}`,
    `💰 Aguardando Pagamento ${e.aguardandoPagamento} (${f.linkEnviado} com link enviado — prestes a comprar)`,
    `🔁 Em follow-up automático: ${f.emFollowup}`,
    `Nutrir ${e.nutrir} · Perdido ${e.perdido} · Ganho ${e.ganho}`,
  );
  return linhas.join("\n");
}

const PRIORIDADE = { 1: "🔴 Agir agora", 2: "🟠 Combinado pra hoje", 3: "🟡 Preço há 7 dias", 4: "🔵 Janela de retorno" } as const;

export function montarMensagemAgenda(lista: ItemListaQuente[]): string {
  const base = `${env.CHATWOOT_BASE_URL}/app/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations`;
  if (lista.length === 0) return "🔥 *AGENDA DO DIA*\nNinguém na lista quente hoje.";
  const contagem = ([1, 2, 3, 4] as const)
    .map((p) => [p, lista.filter((i) => i.prioridade === p).length] as const)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${PRIORIDADE[p]}: ${n}`)
    .join(" · ");
  const linhas = [`🔥 *AGENDA DO DIA — ${lista.length} leads*`, contagem, ""];
  for (const i of lista.slice(0, TOP_AGENDA)) {
    const quente = i.perfil?.quandoEntrar && /imediat/i.test(i.perfil.quandoEntrar) ? " ⭐" : "";
    // O título do card costuma já trazer o concurso ("Karla - PCDF"); não repete.
    const c = i.perfil?.concurso?.trim().slice(0, 30);
    const concurso = c && !i.nome.toLowerCase().includes(c.toLowerCase()) ? ` (${c})` : "";
    linhas.push(`${PRIORIDADE[i.prioridade].slice(0, 2)} *${i.nome}*${concurso}${quente} — ${i.motivo}`, `${base}/${i.displayId}`);
  }
  if (lista.length > TOP_AGENDA) linhas.push("", `+${lista.length - TOP_AGENDA} na lista — a lista inteira sai no script relatorio-comercial.ts.`);
  linhas.push("", "⭐ = respondeu \"Imediatamente\" no formulário. O roteiro de cada um está na nota privada da conversa.");
  return linhas.join("\n");
}

export function montarTermometroSemanal(d: {
  aplicacoesSemana: Aplicacao[];
  ganhosSemana: number;
  motivosSemana: string[];
}): string {
  const aps = d.aplicacoesSemana;
  const motivos = contar(d.motivosSemana, (m) => ROTULO_MOTIVO[m as MotivoTravamento] ?? m);
  return [
    "🌡️ *TERMÔMETRO DA SEMANA*",
    `Aplicações: ${aps.length} · Ganhos: ${d.ganhosSemana}`,
    `Por concurso: ${linhaContagem(contar(aps, (a) => estadoDoConcurso(a.concurso)).slice(0, 6))}`,
    `Quando quer entrar: ${linhaContagem(contar(aps, (a) => a.quandoEntrar?.trim() || "Sem resposta"))}`,
    motivos.length > 0 ? `Onde travaram: ${linhaContagem(motivos.slice(0, 6))}` : "Onde travaram: nenhum registro na semana",
  ].join("\n");
}

// ── Execução ────────────────────────────────────────────────────────────────

export async function gerarRelatorioComercial(agora = new Date()): Promise<string[]> {
  const hojeInicio = inicioDoDiaSP(agora);
  const ontemInicio = new Date(hojeInicio.getTime() - DIA);
  const [cards, aplicacoes] = await Promise.all([varrerBoard(), listarAplicacoes(ontemInicio, hojeInicio)]);
  const funil = resumirFunil(cards, ontemInicio, hojeInicio);
  const lista = await montarListaQuente(cards, agora);
  const mensagens = [montarMensagemNumeros({ dataRef: ontemInicio, aplicacoes, funil }), montarMensagemAgenda(lista)];

  const ehSegunda = new Date(agora.getTime() + SP_OFFSET_MS).getUTCDay() === 1;
  if (ehSegunda) {
    const semanaInicio = new Date(hojeInicio.getTime() - 7 * DIA);
    const [aplicacoesSemana, notas] = await Promise.all([
      listarAplicacoes(semanaInicio, hojeInicio),
      listarAlertasDesde("nota:", semanaInicio),
    ]);
    const semana = resumirFunil(cards, semanaInicio, hojeInicio);
    mensagens.push(montarTermometroSemanal({
      aplicacoesSemana,
      ganhosSemana: semana.ganhosNoPeriodo,
      motivosSemana: notas.map((n) => n.motivo),
    }));
  }
  return mensagens;
}

export async function enviarRelatorioComercial(mensagens: string[]): Promise<void> {
  for (const m of mensagens) await avisarGrupo(env.CHATWOOT_COMERCIAL_CONVERSATION_ID, m);
}

const HORA_ENVIO_SP = 8;

/**
 * Job de 5 em 5 minutos: a partir das 8h de São Paulo, manda o relatório uma vez por dia. A trava
 * no banco (mesma tabela dos alertas) é o que garante "uma vez": sobrevive a restart e a duas
 * réplicas. Sem a flag RELATORIO_COMERCIAL_ATIVO=true é no-op.
 */
export async function verificarRelatorioDiario(agora = new Date()): Promise<void> {
  if (!env.RELATORIO_COMERCIAL_ATIVO) return;
  const sp = new Date(agora.getTime() + SP_OFFSET_MS);
  if (sp.getUTCHours() < HORA_ENVIO_SP) return;
  const chave = `relatorio-comercial:${sp.toISOString().slice(0, 10)}`;
  if (!(await reivindicarAlerta(chave, "", "relatorio-diario"))) return;
  let mensagens: string[];
  try {
    mensagens = await gerarRelatorioComercial(agora);
  } catch (e) {
    // Falhou antes de mandar qualquer coisa: libera para a próxima rodada de 5 min tentar de novo.
    await liberarAlerta(chave).catch(() => {});
    throw e;
  }
  // Daqui em diante NÃO libera: se a 2ª mensagem falhar, tentar de novo repetiria a 1ª no grupo.
  await enviarRelatorioComercial(mensagens);
  logger.info("relatorio-comercial", "Relatório diário enviado ao grupo do comercial");
}
