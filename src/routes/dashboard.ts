import { Elysia } from "elysia";
import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { logger } from "../lib/logger.ts";
import { gerarDashboardHTML } from "./dashboard-html.ts";

const ACCOUNT_ID = env.CHATWOOT_ACCOUNT_ID;
const BASE_URL = env.CHATWOOT_BASE_URL;
const TOKEN = env.CHATWOOT_API_TOKEN;
const BOARD_ID = env.KANBAN_BOARD_ID;

const STEPS = [
  { id: 1,  nome: "Novo Lead",             cor: "#94a3b8" },
  { id: 7,  nome: "Primeira mensagem",      cor: "#60a5fa" },
  { id: 10, nome: "Conexão",               cor: "#a78bfa" },
  { id: 8,  nome: "Aguardando Pagamento",  cor: "#fbbf24" },
  { id: 9,  nome: "Ganho",                 cor: "#34d399" },
  { id: 11, nome: "Perdido",               cor: "#ef4444" },
  { id: 12, nome: "Nutrir",                cor: "#f97316" },
];

const STEP_GANHO    = 9;
const STEP_PERDIDO  = 11;
const STEP_AGUARD   = 8;

function chatwootHeaders() {
  return { "Content-Type": "application/json", api_access_token: TOKEN };
}

// ─── Helpers Chatwoot ────────────────────────────────────────────────────────

async function listarTasksStep(stepId: number, page = 1): Promise<unknown[]> {
  try {
    const url = `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/kanban/tasks?board_id=${BOARD_ID}&step_id=${stepId}&page=${page}`;
    const res = await fetchComTimeout(url, { method: "GET", headers: chatwootHeaders(), timeout: 10000 });
    if (!res.ok) return [];
    const data = await res.json() as { tasks?: unknown[] };
    return data.tasks ?? [];
  } catch {
    return [];
  }
}

async function listarConversas(status = "open", page = 1): Promise<unknown[]> {
  try {
    const url = `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations?status=${status}&page=${page}&inbox_id=${env.CHATWOOT_INBOX_ID}`;
    const res = await fetchComTimeout(url, { method: "GET", headers: chatwootHeaders(), timeout: 10000 });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { payload?: unknown[] } };
    return data.data?.payload ?? [];
  } catch {
    return [];
  }
}

async function buscarOverview() {
  try {
    const url = `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/reports/overview`;
    const res = await fetchComTimeout(url, { method: "GET", headers: chatwootHeaders(), timeout: 10000 });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ─── Agregação de dados ──────────────────────────────────────────────────────

interface TaskRaw {
  id: number;
  title: string;
  description: string;
  board_step_id: number;
  conversation_ids: number[];
  conversations?: Array<{
    id: number;
    status: string;
    last_activity_at?: number;
    created_at?: number;
    labels?: string[];
    contact?: { name: string };
    meta?: { labels?: string[] };
  }>;
  labels?: string[];
  created_at?: string;
  updated_at?: string;
  step_changed_at?: string;
}

async function agregarDados() {
  const agora = Date.now();
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const tsHoje = inicioHoje.getTime() / 1000;

  // Busca paralela de todas as etapas
  const [
    tasksNovo,
    tasksPrimeira,
    tasksConexao,
    tasksAguard,
    tasksGanho,
    tasksPerdido,
    tasksNutrir,
    conversasAbertas,
  ] = await Promise.all([
    listarTasksStep(1),
    listarTasksStep(7),
    listarTasksStep(10),
    listarTasksStep(8),
    listarTasksStep(9),
    listarTasksStep(11),
    listarTasksStep(12),
    listarConversas("open"),
  ]);

  const todasTasks = [
    ...tasksNovo, ...tasksPrimeira, ...tasksConexao,
    ...tasksAguard, ...tasksGanho, ...tasksPerdido, ...tasksNutrir,
  ] as TaskRaw[];

  // Contagem por etapa (segunda página para Perdido que tem 200+)
  const perdidoP2 = await listarTasksStep(11, 2) as TaskRaw[];
  const perdidoP3 = await listarTasksStep(11, 3) as TaskRaw[];
  const totalPerdido = (tasksPerdido as TaskRaw[]).length + perdidoP2.length + perdidoP3.length;

  const funil = STEPS.map((s) => {
    let total: number;
    if (s.id === 11) total = totalPerdido > 0 ? totalPerdido : (tasksPerdido as TaskRaw[]).length;
    else if (s.id === 1)  total = (tasksNovo as TaskRaw[]).length;
    else if (s.id === 7)  total = (tasksPrimeira as TaskRaw[]).length;
    else if (s.id === 10) total = (tasksConexao as TaskRaw[]).length;
    else if (s.id === 8)  total = (tasksAguard as TaskRaw[]).length;
    else if (s.id === 9)  total = (tasksGanho as TaskRaw[]).length;
    else if (s.id === 12) total = (tasksNutrir as TaskRaw[]).length;
    else total = 0;
    return { etapa: s.nome, total, cor: s.cor };
  });

  // KPIs
  const ganhadosHoje = (tasksGanho as TaskRaw[]).filter((t) => {
    const ts = t.step_changed_at ? new Date(t.step_changed_at).getTime() / 1000 : 0;
    return ts >= tsHoje;
  }).length;

  const totalAtivos = (tasksNovo as TaskRaw[]).length
    + (tasksPrimeira as TaskRaw[]).length
    + (tasksConexao as TaskRaw[]).length
    + (tasksAguard as TaskRaw[]).length;

  const totalGanhos = (tasksGanho as TaskRaw[]).length;
  const taxaConversao = totalGanhos + totalPerdido > 0
    ? parseFloat(((totalGanhos / (totalGanhos + totalPerdido)) * 100).toFixed(1))
    : 0;

  // Leads abordados hoje (entraram em alguma etapa hoje)
  const leadsHoje = todasTasks.filter((t) => {
    const ts = t.created_at ? new Date(t.created_at).getTime() / 1000 : 0;
    return ts >= tsHoje;
  }).length;

  // Conversas ativas com dados de atendimento
  const conversasAtivas = (conversasAbertas as NonNullable<TaskRaw["conversations"]>).map((conv) => {
    if (!conv) return null;
    const labels: string[] = (conv as Record<string, unknown>).labels as string[] ?? [];
    const atendente = labels.includes("nao") ? "IA" : labels.includes("sim") ? "Pedro" : "—";
    const lastActivity = conv.last_activity_at ?? conv.created_at ?? 0;
    const minutosSemResposta = lastActivity
      ? Math.floor((agora / 1000 - lastActivity) / 60)
      : 0;

    // Encontrar etapa da task vinculada
    const taskVinculada = todasTasks.find((t) =>
      (t.conversation_ids ?? []).includes(conv.id),
    );
    const stepId = taskVinculada?.board_step_id ?? 0;
    const etapa = STEPS.find((s) => s.id === stepId)?.nome ?? "Desconhecida";

    let status = "ativo";
    if (minutosSemResposta > 240) status = "parado";
    else if (minutosSemResposta > 60) status = "aguardando";

    const meta = (conv as Record<string, unknown>).meta as Record<string, unknown> | undefined;
    const senderName = meta?.sender ? (meta.sender as Record<string, unknown>).name as string : undefined;
    const nomeContato = senderName ?? conv.contact?.name ?? "Lead";

    // Concurso da task
    const concurso = taskVinculada?.title?.match(/[-–]\s*(.+)$/)?.[1]?.trim() ?? "—";

    return {
      id: conv.id,
      nome: nomeContato,
      concurso,
      etapa,
      atendente,
      minutos_sem_resposta: minutosSemResposta,
      status,
      label: labels.join(", "),
    };
  }).filter(Boolean).slice(0, 30);

  // Alertas
  const alertas: Array<{ tipo: string; mensagem: string; urgencia: string }> = [];

  for (const conv of conversasAtivas) {
    if (!conv) continue;
    if (conv.minutos_sem_resposta > 480) {
      alertas.push({
        tipo: "sem_resposta",
        mensagem: `${conv.nome} parado(a) há ${Math.floor(conv.minutos_sem_resposta / 60)}h na etapa ${conv.etapa}`,
        urgencia: "alta",
      });
    } else if (conv.minutos_sem_resposta > 240) {
      alertas.push({
        tipo: "sem_resposta",
        mensagem: `${conv.nome} sem resposta há ${Math.floor(conv.minutos_sem_resposta / 60)}h — ${conv.etapa}`,
        urgencia: "media",
      });
    }
  }

  if ((tasksAguard as TaskRaw[]).length > 0) {
    alertas.push({
      tipo: "pagamento_pendente",
      mensagem: `${(tasksAguard as TaskRaw[]).length} lead(s) aguardando pagamento — acompanhar hoje`,
      urgencia: (tasksAguard as TaskRaw[]).length >= 3 ? "alta" : "media",
    });
  }

  // Split IA vs Pedro
  const ativos = conversasAtivas.filter(Boolean) as NonNullable<typeof conversasAtivas[0]>[];
  const iaAtivos  = ativos.filter((c) => c.atendente === "IA").length;
  const pedroAtivos = ativos.filter((c) => c.atendente === "Pedro").length;

  const tasksGanhoTyped = tasksGanho as TaskRaw[];
  const ganhoIA = tasksGanhoTyped.filter((t) => {
    const desc = (t.description ?? "").toLowerCase();
    return desc.includes("🟣") || desc.includes("nao");
  }).length;
  const ganhoPedro = tasksGanhoTyped.length - ganhoIA;

  const split = {
    ia:    { ativos: iaAtivos,    ganhos: ganhoIA,    taxa: iaAtivos > 0    ? parseFloat(((ganhoIA / Math.max(iaAtivos + ganhoIA, 1)) * 100).toFixed(1)) : 0 },
    pedro: { ativos: pedroAtivos, ganhos: ganhoPedro, taxa: pedroAtivos > 0 ? parseFloat(((ganhoPedro / Math.max(pedroAtivos + ganhoPedro, 1)) * 100).toFixed(1)) : 0 },
  };

  // Atividade recente (últimas tasks atualizadas)
  const atividadeRecente = todasTasks
    .filter((t) => t.updated_at || t.step_changed_at)
    .sort((a, b) => {
      const ta = new Date(a.updated_at ?? a.step_changed_at ?? 0).getTime();
      const tb = new Date(b.updated_at ?? b.step_changed_at ?? 0).getTime();
      return tb - ta;
    })
    .slice(0, 15)
    .map((t) => {
      const ts = new Date(t.updated_at ?? t.step_changed_at ?? Date.now());
      const hora = ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
      const stepId = t.board_step_id;
      let tipo = "atualizado";
      let evento = `${t.title ?? "Lead"} — atualizado`;
      if (stepId === STEP_GANHO)   { tipo = "ganho";    evento = `Venda fechada — ${t.title}`; }
      if (stepId === STEP_PERDIDO) { tipo = "perdido";  evento = `Lead perdido — ${t.title}`; }
      if (stepId === STEP_AGUARD)  { tipo = "pagamento"; evento = `Aguardando pagamento — ${t.title}`; }
      return { hora, evento, tipo };
    });

  return {
    atualizado_em: new Date().toISOString(),
    kpis: {
      leads_hoje: leadsHoje,
      ganhos_hoje: ganhadosHoje,
      taxa_conversao: taxaConversao,
      leads_ativos: totalAtivos,
      aguardando_pagamento: (tasksAguard as TaskRaw[]).length,
    },
    funil,
    conversas_ativas: conversasAtivas.filter(Boolean),
    alertas: alertas.slice(0, 10),
    atividade_recente: atividadeRecente,
    split_atendimento: split,
  };
}

// ─── HTML do Dashboard ────────────────────────────────────────────────────────

function gerarHTML(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Vestigium · Painel Comercial</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg:      #060810;
    --s1:      #0d1117;
    --s2:      #111722;
    --border:  #1c2333;
    --border2: rgba(255,255,255,0.06);
    --text:    #e6edf3;
    --muted:   #7d8590;
    --muted2:  #484f58;
    --green:     #2dd4a0;
    --green-dim: rgba(45,212,160,.12);
    --red:       #f05a6a;
    --red-dim:   rgba(240,90,106,.12);
    --blue:      #5b9cf6;
    --blue-dim:  rgba(91,156,246,.12);
    --yellow:    #f5be5a;
    --yellow-dim:rgba(245,190,90,.12);
    --purple:    #a78bfa;
    --slate:     #94a3b8;
    --font-head: 'Syne', sans-serif;
    --font-body: 'DM Sans', sans-serif;
    --font-mono: 'DM Mono', monospace;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
    background-image:
      radial-gradient(ellipse 80% 50% at 50% -20%, rgba(91,156,246,.07) 0%, transparent 70%),
      radial-gradient(ellipse 40% 30% at 80% 80%, rgba(45,212,160,.04) 0%, transparent 60%);
  }

  /* ── Topbar ── */
  .topbar {
    position: sticky; top: 0; z-index: 100;
    background: rgba(8,11,18,.85);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
    padding: 0 28px;
    display: flex; align-items: center; justify-content: space-between;
    height: 58px;
  }
  .topbar-left { display: flex; align-items: center; gap: 14px; }
  .logo-mark {
    width: 32px; height: 32px;
    background: linear-gradient(135deg, var(--blue), var(--green));
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-head); font-weight: 800; font-size: 14px; color: #fff;
  }
  .logo-text { font-family: var(--font-head); font-weight: 700; font-size: 16px; letter-spacing: -.3px; }
  .logo-sub { font-size: 11px; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
  .topbar-right { display: flex; align-items: center; gap: 16px; }
  .live-badge {
    display: flex; align-items: center; gap: 6px;
    font-size: 11px; color: var(--green); font-weight: 600;
    letter-spacing: .05em; text-transform: uppercase;
  }
  .live-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 0 0 rgba(45,212,160,.6);
    animation: pulse-dot 2s infinite;
  }
  @keyframes pulse-dot {
    0%   { box-shadow: 0 0 0 0   rgba(45,212,160,.6); }
    70%  { box-shadow: 0 0 0 8px rgba(45,212,160,0);  }
    100% { box-shadow: 0 0 0 0   rgba(45,212,160,0);  }
  }
  .update-info { font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
  .btn-refresh {
    background: var(--card); border: 1px solid var(--border2);
    color: var(--blue); padding: 6px 14px; border-radius: 8px;
    font-size: 12px; font-weight: 600; cursor: pointer;
    transition: all .15s; font-family: var(--font-body);
    display: flex; align-items: center; gap: 6px;
  }
  .btn-refresh:hover { background: var(--blue-dim); border-color: var(--blue); }
  .btn-refresh svg { transition: transform .3s; }
  .btn-refresh.spinning svg { animation: spin .6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Layout ── */
  .container { max-width: 1440px; margin: 0 auto; padding: 28px 28px 60px; }

  /* ── KPIs ── */
  .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 24px; }
  .kpi-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 14px; padding: 20px 22px;
    position: relative; overflow: hidden;
    transition: border-color .2s, transform .2s;
  }
  .kpi-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: var(--accent-color, var(--border));
    opacity: .8;
  }
  .kpi-card:hover { border-color: var(--border2); transform: translateY(-1px); }
  .kpi-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 600; margin-bottom: 10px; }
  .kpi-value { font-family: var(--font-head); font-size: 36px; font-weight: 800; line-height: 1; margin-bottom: 6px; }
  .kpi-sub { font-size: 11px; color: var(--muted); }
  .kpi-card.green { --accent-color: var(--green); }
  .kpi-card.blue  { --accent-color: var(--blue); }
  .kpi-card.red   { --accent-color: var(--red); }
  .kpi-card.yellow{ --accent-color: var(--yellow); }
  .kpi-card.purple{ --accent-color: var(--purple); }
  .kpi-card.green .kpi-value { color: var(--green); }
  .kpi-card.blue  .kpi-value { color: var(--blue); }
  .kpi-card.red   .kpi-value { color: var(--red); }
  .kpi-card.yellow.kpi-value { color: var(--yellow); }
  .kpi-card.purple .kpi-value{ color: var(--purple); }

  /* ── Grid principal ── */
  .main-grid { display: grid; grid-template-columns: 1fr 340px; gap: 20px; margin-bottom: 20px; }
  .col-left  { display: flex; flex-direction: column; gap: 20px; }
  .col-right { display: flex; flex-direction: column; gap: 20px; }

  /* ── Card base ── */
  .panel {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 14px; overflow: hidden;
  }
  .panel-header {
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .panel-title { font-family: var(--font-head); font-weight: 700; font-size: 13px; letter-spacing: -.1px; }
  .panel-badge {
    font-size: 11px; padding: 3px 9px; border-radius: 20px;
    font-weight: 600; font-family: var(--font-mono);
  }
  .badge-blue   { background: var(--blue-dim);   color: var(--blue); }
  .badge-green  { background: var(--green-dim);  color: var(--green); }
  .badge-red    { background: var(--red-dim);    color: var(--red); }
  .badge-yellow { background: var(--yellow-dim); color: var(--yellow); }
  .badge-purple { background: rgba(167,139,250,.12); color: var(--purple); }
  .badge-gray   { background: rgba(148,163,184,.1); color: var(--slate); }

  /* ── Funil ── */
  .funnel-body { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
  .funnel-row { display: flex; align-items: center; gap: 12px; }
  .funnel-name { width: 170px; font-size: 12px; color: var(--muted); font-weight: 500; flex-shrink: 0; }
  .funnel-track { flex: 1; background: var(--surface); border-radius: 6px; height: 28px; overflow: hidden; position: relative; }
  .funnel-bar {
    height: 100%; border-radius: 6px;
    display: flex; align-items: center; padding-left: 10px;
    font-size: 11px; font-weight: 700; color: rgba(255,255,255,.9);
    min-width: 28px; transition: width .8s cubic-bezier(.4,0,.2,1);
    font-family: var(--font-mono);
  }
  .funnel-pct { width: 40px; text-align: right; font-size: 11px; color: var(--muted2); font-family: var(--font-mono); }

  /* ── Tabela conversas ── */
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th {
    padding: 10px 14px; text-align: left;
    font-size: 10px; font-weight: 700; color: var(--muted2);
    text-transform: uppercase; letter-spacing: .08em;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  td { padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,.015); }
  .td-name { font-weight: 600; color: var(--text); }
  .td-mono { font-family: var(--font-mono); font-size: 12px; }
  .atendente-ia    { color: var(--purple); font-weight: 700; font-size: 12px; }
  .atendente-pedro { color: var(--blue); font-weight: 700; font-size: 12px; }
  .status-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 20px;
    letter-spacing: .04em; text-transform: uppercase;
  }
  .status-parado    { background: var(--red-dim);    color: var(--red); }
  .status-aguardando{ background: var(--yellow-dim); color: var(--yellow); }
  .status-ativo     { background: var(--green-dim);  color: var(--green); }
  .tempo-value { font-family: var(--font-mono); font-size: 12px; }
  .tempo-ok   { color: var(--green); }
  .tempo-warn { color: var(--yellow); }
  .tempo-crit { color: var(--red); }
  .empty-state { padding: 40px 20px; text-align: center; color: var(--muted); font-size: 13px; }

  /* ── Alertas ── */
  .alertas-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .alerta-item {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 12px; border-radius: 10px;
    border: 1px solid transparent; font-size: 12px; line-height: 1.5;
  }
  .alerta-alta   { background: var(--red-dim);    border-color: rgba(240,90,106,.2); }
  .alerta-media  { background: var(--yellow-dim); border-color: rgba(245,190,90,.2); }
  .alerta-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
  .alerta-msg { color: var(--text); }
  .no-alerts { padding: 20px; text-align: center; color: var(--muted); font-size: 12px; }

  /* ── Atividade ── */
  .feed-body { padding: 0 16px 12px; }
  .feed-item {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .feed-item:last-child { border-bottom: none; }
  .feed-dot {
    width: 7px; height: 7px; border-radius: 50%;
    flex-shrink: 0; margin-top: 5px;
  }
  .feed-ganho   .feed-dot { background: var(--green); }
  .feed-perdido .feed-dot { background: var(--red); }
  .feed-escalado.feed-dot { background: var(--yellow); }
  .feed-pagamento.feed-dot{ background: var(--blue); }
  .feed-atualizado.feed-dot{ background: var(--muted2); }
  .feed-followup .feed-dot{ background: var(--purple); }
  .feed-hora  { font-family: var(--font-mono); font-size: 10px; color: var(--muted2); flex-shrink: 0; margin-top: 2px; }
  .feed-texto { font-size: 12px; color: var(--muted); line-height: 1.4; }

  /* ── Split IA vs Pedro ── */
  .split-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .split-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px 16px;
  }
  .split-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .split-name { font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 6px; }
  .split-taxa { font-family: var(--font-head); font-size: 22px; font-weight: 800; }
  .split-ia    .split-taxa { color: var(--purple); }
  .split-pedro .split-taxa { color: var(--blue); }
  .split-stats { display: flex; gap: 16px; }
  .split-stat { }
  .split-stat-label { font-size: 10px; color: var(--muted2); text-transform: uppercase; letter-spacing: .06em; }
  .split-stat-val   { font-family: var(--font-mono); font-weight: 600; font-size: 14px; margin-top: 2px; }
  .split-bar-wrap { margin-top: 10px; background: var(--border); border-radius: 4px; height: 4px; overflow: hidden; }
  .split-bar { height: 100%; border-radius: 4px; transition: width .6s ease; }
  .split-ia    .split-bar { background: var(--purple); }
  .split-pedro .split-bar { background: var(--blue); }

  /* ── Bottom row ── */
  .bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

  /* ── Scroll ── */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

  @media (max-width: 1200px) {
    .kpi-grid { grid-template-columns: repeat(3, 1fr); }
    .main-grid { grid-template-columns: 1fr; }
    .bottom-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .kpi-grid { grid-template-columns: 1fr 1fr; }
    .container { padding: 16px; }
  }
</style>
</head>
<body>

<!-- TOPBAR -->
<div class="topbar">
  <div class="topbar-left">
    <div class="logo-mark">V</div>
    <div>
      <div class="logo-text">Vestigium</div>
      <div class="logo-sub">Painel Comercial</div>
    </div>
  </div>
  <div class="topbar-right">
    <div class="live-badge">
      <div class="live-dot"></div>
      Ao vivo
    </div>
    <div class="update-info" id="update-info">—</div>
    <button class="btn-refresh" onclick="refresh()">
      <svg id="refresh-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
        <path d="M21 3v5h-5"/>
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
        <path d="M8 16H3v5"/>
      </svg>
      Atualizar
    </button>
  </div>
</div>

<!-- CONTAINER -->
<div class="container">

  <!-- KPIs -->
  <div class="kpi-grid" id="kpi-grid">
    <div class="kpi-card blue">
      <div class="kpi-label">Leads Hoje</div>
      <div class="kpi-value" id="kpi-leads-hoje">—</div>
      <div class="kpi-sub">novos no funil</div>
    </div>
    <div class="kpi-card green">
      <div class="kpi-label">Ganhos Hoje</div>
      <div class="kpi-value" id="kpi-ganhos-hoje">—</div>
      <div class="kpi-sub">vendas fechadas</div>
    </div>
    <div class="kpi-card purple">
      <div class="kpi-label" style="color:var(--muted)">Taxa de Conversão</div>
      <div class="kpi-value" style="color:var(--purple)" id="kpi-taxa">—</div>
      <div class="kpi-sub">total histórico</div>
    </div>
    <div class="kpi-card blue">
      <div class="kpi-label">Leads Ativos</div>
      <div class="kpi-value" id="kpi-ativos">—</div>
      <div class="kpi-sub">em atendimento</div>
    </div>
    <div class="kpi-card yellow">
      <div class="kpi-label" style="color:var(--muted)">Aguard. Pagamento</div>
      <div class="kpi-value" style="color:var(--yellow)" id="kpi-aguard">—</div>
      <div class="kpi-sub">fechar agora</div>
    </div>
  </div>

  <!-- MAIN GRID -->
  <div class="main-grid">
    <div class="col-left">

      <!-- FUNIL -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Funil de Vendas</span>
          <span class="panel-badge badge-gray" id="funil-total">279 leads</span>
        </div>
        <div class="funnel-body" id="funil-body">
          <div class="empty-state">Carregando...</div>
        </div>
      </div>

      <!-- CONVERSAS ATIVAS -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Conversas Ativas</span>
          <span class="panel-badge badge-blue" id="conv-count">0</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Concurso</th>
                <th>Etapa</th>
                <th>Atendente</th>
                <th>Sem resposta</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="conv-table">
              <tr><td colspan="6" class="empty-state">Carregando...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <div class="col-right">

      <!-- ALERTAS -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">⚠ Alertas</span>
          <span class="panel-badge badge-red" id="alertas-count">0</span>
        </div>
        <div class="alertas-body" id="alertas-body">
          <div class="no-alerts">Sem alertas no momento</div>
        </div>
      </div>

      <!-- SPLIT IA vs PEDRO -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">IA vs Pedro</span>
          <span class="panel-badge badge-purple">Comparativo</span>
        </div>
        <div class="split-body" id="split-body">
          <div class="empty-state">Carregando...</div>
        </div>
      </div>

      <!-- ATIVIDADE RECENTE -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Atividade Recente</span>
        </div>
        <div class="feed-body" id="feed-body">
          <div class="empty-state">Carregando...</div>
        </div>
      </div>

    </div>
  </div>

</div>

<script>
let dadosCache = null;

function fmtTempo(min) {
  if (min < 60)  return min + 'm';
  if (min < 1440) return Math.floor(min/60) + 'h' + (min%60 > 0 ? (min%60)+'m' : '');
  return Math.floor(min/1440) + 'd';
}

function tempoClass(min) {
  if (min > 240) return 'tempo-crit';
  if (min > 60)  return 'tempo-warn';
  return 'tempo-ok';
}

function renderKPIs(d) {
  document.getElementById('kpi-leads-hoje').textContent = d.kpis.leads_hoje;
  document.getElementById('kpi-ganhos-hoje').textContent = d.kpis.ganhos_hoje;
  document.getElementById('kpi-taxa').textContent = d.kpis.taxa_conversao + '%';
  document.getElementById('kpi-ativos').textContent = d.kpis.leads_ativos;
  document.getElementById('kpi-aguard').textContent = d.kpis.aguardando_pagamento;
}

function renderFunil(d) {
  const total = d.funil.reduce((s, f) => s + f.total, 0);
  document.getElementById('funil-total').textContent = total + ' leads';
  const max = Math.max(...d.funil.map(f => f.total), 1);
  const html = d.funil.map(f => {
    const pct = Math.max((f.total / max) * 100, f.total > 0 ? 8 : 0);
    const pctTotal = total > 0 ? ((f.total / total) * 100).toFixed(1) : '0.0';
    return \`<div class="funnel-row">
      <div class="funnel-name">\${f.etapa}</div>
      <div class="funnel-track">
        <div class="funnel-bar" style="width:\${pct}%;background:\${f.cor}">\${f.total > 0 ? f.total : ''}</div>
      </div>
      <div class="funnel-pct">\${pctTotal}%</div>
    </div>\`;
  }).join('');
  document.getElementById('funil-body').innerHTML = html;
}

function renderConversas(d) {
  const convs = d.conversas_ativas || [];
  document.getElementById('conv-count').textContent = convs.length;
  if (!convs.length) {
    document.getElementById('conv-table').innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma conversa ativa no momento</td></tr>';
    return;
  }
  const rows = convs.map(c => {
    const atCls = c.atendente === 'IA' ? 'atendente-ia' : 'atendente-pedro';
    const atIcon = c.atendente === 'IA' ? '🤖 IA' : '👤 Pedro';
    const stCls = c.status === 'parado' ? 'status-parado' : c.status === 'aguardando' ? 'status-aguardando' : 'status-ativo';
    const stLabel = c.status === 'parado' ? 'Parado' : c.status === 'aguardando' ? 'Aguardando' : 'Ativo';
    const tCls = tempoClass(c.minutos_sem_resposta);
    return \`<tr>
      <td class="td-name">\${c.nome}</td>
      <td class="td-mono" style="color:var(--muted)">\${c.concurso || '—'}</td>
      <td><span class="panel-badge badge-gray">\${c.etapa}</span></td>
      <td class="\${atCls}">\${atIcon}</td>
      <td class="tempo-value \${tCls}">\${fmtTempo(c.minutos_sem_resposta)}</td>
      <td><span class="status-badge \${stCls}">\${stLabel}</span></td>
    </tr>\`;
  }).join('');
  document.getElementById('conv-table').innerHTML = rows;
}

function renderAlertas(d) {
  const alerts = d.alertas || [];
  document.getElementById('alertas-count').textContent = alerts.length;
  if (!alerts.length) {
    document.getElementById('alertas-body').innerHTML = '<div class="no-alerts">✓ Sem alertas no momento</div>';
    return;
  }
  const html = alerts.map(a => {
    const cls = a.urgencia === 'alta' ? 'alerta-alta' : 'alerta-media';
    const icon = a.urgencia === 'alta' ? '🔴' : '🟡';
    return \`<div class="alerta-item \${cls}">
      <span class="alerta-icon">\${icon}</span>
      <span class="alerta-msg">\${a.mensagem}</span>
    </div>\`;
  }).join('');
  document.getElementById('alertas-body').innerHTML = html;
}

function renderSplit(d) {
  const s = d.split_atendimento;
  const totalAtivos = (s.ia.ativos || 0) + (s.pedro.ativos || 0);
  const iaBar   = totalAtivos > 0 ? (s.ia.ativos / totalAtivos * 100).toFixed(0) : 50;
  const pedroBar= totalAtivos > 0 ? (s.pedro.ativos / totalAtivos * 100).toFixed(0) : 50;

  document.getElementById('split-body').innerHTML = \`
    <div class="split-card split-ia">
      <div class="split-header">
        <div class="split-name">🤖 Agente IA</div>
        <div class="split-taxa">\${s.ia.taxa}%</div>
      </div>
      <div class="split-stats">
        <div class="split-stat">
          <div class="split-stat-label">Ativos</div>
          <div class="split-stat-val">\${s.ia.ativos}</div>
        </div>
        <div class="split-stat">
          <div class="split-stat-label">Ganhos</div>
          <div class="split-stat-val" style="color:var(--green)">\${s.ia.ganhos}</div>
        </div>
      </div>
      <div class="split-bar-wrap">
        <div class="split-bar" style="width:\${iaBar}%"></div>
      </div>
    </div>
    <div class="split-card split-pedro">
      <div class="split-header">
        <div class="split-name">👤 Pedro Igor</div>
        <div class="split-taxa">\${s.pedro.taxa}%</div>
      </div>
      <div class="split-stats">
        <div class="split-stat">
          <div class="split-stat-label">Ativos</div>
          <div class="split-stat-val">\${s.pedro.ativos}</div>
        </div>
        <div class="split-stat">
          <div class="split-stat-label">Ganhos</div>
          <div class="split-stat-val" style="color:var(--green)">\${s.pedro.ganhos}</div>
        </div>
      </div>
      <div class="split-bar-wrap">
        <div class="split-bar" style="width:\${pedroBar}%"></div>
      </div>
    </div>
  \`;
}

function renderFeed(d) {
  const atividades = d.atividade_recente || [];
  if (!atividades.length) {
    document.getElementById('feed-body').innerHTML = '<div class="empty-state">Sem atividade recente</div>';
    return;
  }
  const html = atividades.map(a => \`
    <div class="feed-item feed-\${a.tipo}">
      <div class="feed-dot"></div>
      <div class="feed-hora">\${a.hora}</div>
      <div class="feed-texto">\${a.evento}</div>
    </div>
  \`).join('');
  document.getElementById('feed-body').innerHTML = html;
}

function renderTudo(d) {
  renderKPIs(d);
  renderFunil(d);
  renderConversas(d);
  renderAlertas(d);
  renderSplit(d);
  renderFeed(d);
  const ts = new Date(d.atualizado_em);
  document.getElementById('update-info').textContent = 'Atualizado às ' + ts.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function fetchDados() {
  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    dadosCache = d;
    renderTudo(d);
  } catch (e) {
    console.error('Erro ao buscar dados:', e);
    document.getElementById('update-info').textContent = 'Erro ao atualizar — ' + new Date().toLocaleTimeString('pt-BR');
  }
}

async function refresh() {
  const btn = document.querySelector('.btn-refresh');
  const icon = document.getElementById('refresh-icon');
  btn.classList.add('spinning');
  icon.style.animation = 'spin .6s linear infinite';
  await fetchDados();
  btn.classList.remove('spinning');
  icon.style.animation = '';
}

// Carregamento inicial
fetchDados();

// Auto-refresh a cada 60s
setInterval(fetchDados, 60_000);
</script>
</body>
</html>`;
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

export const dashboardRouter = new Elysia()
  .get("/dashboard", () => {
    return new Response(gerarDashboardHTML(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  })
  .get("/api/dashboard", async () => {
    try {
      const dados = await agregarDados();
      return dados;
    } catch (e) {
      logger.error("dashboard", "Erro ao agregar dados:", e);
      return { erro: "Falha ao carregar dados do dashboard" };
    }
  });
