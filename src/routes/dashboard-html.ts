// HTML do dashboard gerencial — design premium SaaS
export function gerarDashboardHTML(): string {
  return /* html */`<!DOCTYPE html>
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
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#060810;
  --s1:#0c1118;
  --s2:#111722;
  --card:#0f1521;
  --border:rgba(255,255,255,0.07);
  --border2:rgba(255,255,255,0.12);
  --text:#e6edf3;
  --muted:#7d8590;
  --muted2:#484f58;
  --green:#10b981;
  --green-bg:rgba(16,185,129,0.1);
  --green-glow:rgba(16,185,129,0.2);
  --red:#ef4444;
  --red-bg:rgba(239,68,68,0.1);
  --blue:#3b82f6;
  --blue-bg:rgba(59,130,246,0.1);
  --amber:#f59e0b;
  --amber-bg:rgba(245,158,11,0.1);
  --purple:#8b5cf6;
  --purple-bg:rgba(139,92,246,0.1);
  --slate:#94a3b8;
  --ff:'Plus Jakarta Sans',system-ui,sans-serif;
  --fm:'DM Mono',monospace;
  --r:12px;
}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font-family:var(--ff);font-size:14px;display:flex;flex-direction:column}

/* ── Progress bar ── */
#progress-wrap{position:fixed;top:0;left:0;right:0;height:2px;z-index:9999;background:rgba(255,255,255,0.04)}
#progress-bar{height:100%;background:linear-gradient(90deg,var(--blue),var(--green));width:100%;transform-origin:left;transition:width 1s linear}

/* ── Layout ── */
.layout{display:flex;flex:1;overflow:hidden;padding-top:2px}

/* ── Sidebar ── */
.sidebar{width:56px;background:var(--s1);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:12px 0;gap:4px;flex-shrink:0}
.logo-wrap{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#1d4ed8,#10b981);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:#fff;margin-bottom:16px;box-shadow:0 0 20px rgba(16,185,129,0.3)}
.nav-btn{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--muted2);transition:all .15s;border:none;background:transparent}
.nav-btn:hover,.nav-btn.active{background:var(--s2);color:var(--text)}
.nav-btn svg{width:16px;height:16px}

/* ── Main area ── */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* ── Topbar ── */
.topbar{height:52px;background:var(--s1);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 24px;flex-shrink:0}
.topbar-left{display:flex;align-items:center;gap:12px}
.page-title{font-size:15px;font-weight:700;letter-spacing:-.3px}
.live-pill{display:flex;align-items:center;gap:5px;background:var(--green-bg);border:1px solid var(--green-glow);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:var(--green);letter-spacing:.04em}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(0.8)}}
.topbar-right{display:flex;align-items:center;gap:14px}
.update-ts{font-family:var(--fm);font-size:11px;color:var(--muted);letter-spacing:.02em}
.btn-refresh{display:flex;align-items:center;gap:6px;background:var(--s2);border:1px solid var(--border2);color:var(--text);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--ff);transition:all .15s}
.btn-refresh:hover{background:var(--blue-bg);border-color:var(--blue);color:var(--blue)}
.btn-refresh.loading svg{animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.btn-refresh svg{width:13px;height:13px;flex-shrink:0}

/* ── Scroll area ── */
.content{flex:1;overflow-y:auto;overflow-x:hidden;padding:20px 24px 40px}
.content::-webkit-scrollbar{width:4px}
.content::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}

/* ── KPI Grid ── */
.kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
.kpi-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;position:relative;overflow:hidden;cursor:default;transition:border-color .2s}
.kpi-card::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--kpi-color,var(--blue)),transparent);opacity:.5}
.kpi-card:hover{border-color:var(--border2)}
.kpi-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
.kpi-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.kpi-icon{width:28px;height:28px;border-radius:7px;background:var(--kpi-bg,var(--blue-bg));display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kpi-icon svg{width:14px;height:14px;color:var(--kpi-color,var(--blue))}
.kpi-value{font-family:var(--fm);font-size:32px;font-weight:500;line-height:1;color:var(--kpi-color,var(--text));margin-bottom:10px;letter-spacing:-1px}
.kpi-footer{display:flex;align-items:center;justify-content:space-between}
.kpi-sub{font-size:11px;color:var(--muted)}
.sparkline{width:60px;height:20px;opacity:.7}

/* ── Section header ── */
.section-row{display:grid;gap:14px;margin-bottom:14px}
.row-3{grid-template-columns:1fr 1fr 1fr}
.row-2{grid-template-columns:1.8fr 1fr}
.row-1{grid-template-columns:1fr}

/* ── Card ── */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.card-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 12px;border-bottom:1px solid var(--border)}
.card-title{font-size:13px;font-weight:700;letter-spacing:-.2px;display:flex;align-items:center;gap:7px}
.card-title svg{width:14px;height:14px;color:var(--muted)}
.card-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;font-family:var(--fm);letter-spacing:.04em}
.badge-blue{background:var(--blue-bg);color:var(--blue)}
.badge-green{background:var(--green-bg);color:var(--green)}
.badge-red{background:var(--red-bg);color:var(--red)}
.badge-amber{background:var(--amber-bg);color:var(--amber)}
.badge-purple{background:var(--purple-bg);color:var(--purple)}
.badge-gray{background:rgba(148,163,184,0.1);color:var(--slate)}
.card-body{padding:18px}

/* ── Chart containers ── */
.chart-wrap{position:relative;height:220px;width:100%}
.chart-wrap canvas{max-height:220px}
.gauge-wrap{display:flex;flex-direction:column;align-items:center;padding:10px 0 6px}
.gauge-svg{width:180px;height:100px}
.gauge-value{font-family:var(--fm);font-size:28px;font-weight:500;color:var(--text);letter-spacing:-1px;text-align:center;margin-top:-4px}
.gauge-label{font-size:11px;color:var(--muted);text-align:center;margin-top:2px}
.gauge-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:16px;padding:0 8px}
.g-stat{text-align:center}
.g-stat-val{font-family:var(--fm);font-size:16px;font-weight:500;letter-spacing:-.5px}
.g-stat-lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:1px}

/* ── Donut center ── */
.donut-wrap{position:relative;height:180px;display:flex;align-items:center;justify-content:center}
.donut-wrap canvas{position:absolute}
.donut-center{position:relative;z-index:2;text-align:center;pointer-events:none}
.donut-center-val{font-family:var(--fm);font-size:22px;font-weight:500;letter-spacing:-1px}
.donut-center-lbl{font-size:10px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.donut-legend{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.legend-item{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--s2);border-radius:8px;border:1px solid var(--border)}
.legend-left{display:flex;align-items:center;gap:8px}
.legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.legend-name{font-size:12px;font-weight:600}
.legend-sub{font-size:10px;color:var(--muted);margin-top:1px}
.legend-right{text-align:right}
.legend-rate{font-family:var(--fm);font-size:15px;font-weight:500}
.legend-wins{font-size:10px;color:var(--muted)}

/* ── Conversas table ── */
.conv-table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
thead th{padding:9px 14px;text-align:left;font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border);background:rgba(255,255,255,0.01);white-space:nowrap}
tbody td{padding:11px 14px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr{transition:background .1s;cursor:default}
tbody tr:hover td{background:rgba(255,255,255,0.02)}
.avatar{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;letter-spacing:-.5px}
.lead-cell{display:flex;align-items:center;gap:10px}
.lead-name{font-weight:600;color:var(--text);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.concurso-cell{font-family:var(--fm);font-size:11px;color:var(--muted);font-weight:500}
.etapa-pill{display:inline-flex;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.04em;white-space:nowrap}
.atendente-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:.04em}
.at-ia{background:var(--purple-bg);color:var(--purple)}
.at-pedro{background:var(--blue-bg);color:var(--blue)}
.at-none{color:var(--muted);font-size:11px}
.tempo-cell{font-family:var(--fm);font-size:12px;font-weight:500}
.t-ok{color:var(--green)}
.t-warn{color:var(--amber)}
.t-crit{color:var(--red)}
.status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-right:6px;display:inline-block}
.status-cell{display:flex;align-items:center;font-size:11px;font-weight:600;white-space:nowrap}
.s-ativo .status-dot{background:var(--green);box-shadow:0 0 6px var(--green-glow);animation:pulse 2s infinite}
.s-ativo{color:var(--green)}
.s-aguardando .status-dot{background:var(--amber)}
.s-aguardando{color:var(--amber)}
.s-parado .status-dot{background:var(--red)}
.s-parado{color:var(--red)}
.empty-row td{text-align:center;padding:40px;color:var(--muted);font-size:13px}

/* ── Activity feed ── */
.feed-body{padding:4px 18px 10px;display:flex;flex-direction:column;max-height:340px;overflow-y:auto}
.feed-body::-webkit-scrollbar{width:3px}
.feed-body::-webkit-scrollbar-thumb{background:var(--border2)}
.feed-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);animation:slideDown .3s ease}
@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
.feed-item:last-child{border-bottom:none}
.feed-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;margin-top:1px}
.f-ganho .feed-icon{background:var(--green-bg)}
.f-perdido .feed-icon{background:var(--red-bg)}
.f-pagamento .feed-icon{background:var(--blue-bg)}
.f-escalado .feed-icon{background:var(--amber-bg)}
.f-followup .feed-icon{background:var(--purple-bg)}
.f-atualizado .feed-icon{background:rgba(148,163,184,0.1)}
.feed-content{flex:1;min-width:0}
.feed-text{font-size:12px;color:var(--text);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feed-time{font-size:10px;color:var(--muted);font-family:var(--fm);margin-top:2px}
.feed-empty{padding:32px 18px;text-align:center;color:var(--muted);font-size:12px}

/* ── Alertas strip ── */
.alertas-strip{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}
.alerta-chip{display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:500;border:1px solid transparent;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.alerta-chip.alta{background:var(--red-bg);border-color:rgba(239,68,68,0.2);color:var(--text)}
.alerta-chip.media{background:var(--amber-bg);border-color:rgba(245,158,11,0.2);color:var(--text)}
.alerta-icon{font-size:14px;flex-shrink:0}
.no-alertas{padding:12px 18px;background:var(--green-bg);border:1px solid var(--green-glow);border-radius:8px;font-size:12px;color:var(--green);font-weight:600;display:flex;align-items:center;gap:8px}

/* ── Skeleton loading ── */
.skeleton{background:linear-gradient(90deg,var(--s2) 25%,var(--border) 50%,var(--s2) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.skel-number{height:32px;width:70px;margin-bottom:8px}
.skel-line{height:10px;margin-bottom:6px}
.skel-line.short{width:60%}

/* ── Responsive ── */
@media(max-width:1200px){
  .kpi-grid{grid-template-columns:repeat(3,1fr)}
  .row-3{grid-template-columns:1fr 1fr}
  .row-2{grid-template-columns:1fr}
}
@media(max-width:768px){
  .kpi-grid{grid-template-columns:1fr 1fr}
  .row-3,.row-2{grid-template-columns:1fr}
  .sidebar{display:none}
}
</style>
</head>
<body>

<!-- Progress bar -->
<div id="progress-wrap"><div id="progress-bar"></div></div>

<!-- Layout -->
<div class="layout">

  <!-- Sidebar -->
  <nav class="sidebar">
    <div class="logo-wrap">V</div>
    <button class="nav-btn active" title="Dashboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
    </button>
    <button class="nav-btn" title="Funil">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
    </button>
    <button class="nav-btn" title="Leads">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </button>
  </nav>

  <!-- Main -->
  <div class="main">
    <!-- Topbar -->
    <header class="topbar">
      <div class="topbar-left">
        <span class="page-title">Painel Comercial</span>
        <div class="live-pill">
          <span class="live-dot"></span>
          AO VIVO
        </div>
      </div>
      <div class="topbar-right">
        <span class="update-ts" id="update-ts">—</span>
        <button class="btn-refresh" id="btn-refresh" onclick="refresh()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
            <path d="M8 16H3v5"/>
          </svg>
          Atualizar
        </button>
      </div>
    </header>

    <!-- Content -->
    <div class="content">

      <!-- KPIs -->
      <div class="kpi-grid" id="kpi-grid">
        <div class="kpi-card" style="--kpi-color:var(--blue);--kpi-bg:var(--blue-bg)">
          <div class="kpi-header">
            <span class="kpi-label">Leads Hoje</span>
            <div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></div>
          </div>
          <div class="kpi-value" id="v-leads-hoje">—</div>
          <div class="kpi-footer"><span class="kpi-sub">novos no funil</span><svg class="sparkline" id="sp-0"/></div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--green);--kpi-bg:var(--green-bg)">
          <div class="kpi-header">
            <span class="kpi-label">Ganhos Hoje</span>
            <div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div>
          </div>
          <div class="kpi-value" id="v-ganhos-hoje">—</div>
          <div class="kpi-footer"><span class="kpi-sub">vendas fechadas</span><svg class="sparkline" id="sp-1"/></div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--purple);--kpi-bg:var(--purple-bg)">
          <div class="kpi-header">
            <span class="kpi-label">Conversão</span>
            <div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
          </div>
          <div class="kpi-value" id="v-taxa">—</div>
          <div class="kpi-footer"><span class="kpi-sub">taxa histórica</span><svg class="sparkline" id="sp-2"/></div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--blue);--kpi-bg:var(--blue-bg)">
          <div class="kpi-header">
            <span class="kpi-label">Leads Ativos</span>
            <div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          </div>
          <div class="kpi-value" id="v-ativos">—</div>
          <div class="kpi-footer"><span class="kpi-sub">em atendimento</span><svg class="sparkline" id="sp-3"/></div>
        </div>
        <div class="kpi-card" style="--kpi-color:var(--amber);--kpi-bg:var(--amber-bg)">
          <div class="kpi-header">
            <span class="kpi-label">Aguard. Pagto</span>
            <div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
          </div>
          <div class="kpi-value" id="v-aguard">—</div>
          <div class="kpi-footer"><span class="kpi-sub">fechar hoje</span><svg class="sparkline" id="sp-4"/></div>
        </div>
      </div>

      <!-- Alertas -->
      <div id="alertas-area" class="alertas-strip"></div>

      <!-- Row 3 colunas: funil + donut + gauge -->
      <div class="section-row row-3" style="margin-top:14px">

        <!-- Funil -->
        <div class="card">
          <div class="card-head">
            <div class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Funil de Vendas
            </div>
            <span class="card-badge badge-gray" id="funil-badge">—</span>
          </div>
          <div class="card-body" style="padding:14px 18px">
            <div class="chart-wrap" style="height:240px">
              <canvas id="chart-funil"></canvas>
            </div>
          </div>
        </div>

        <!-- Donut IA vs Pedro -->
        <div class="card">
          <div class="card-head">
            <div class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
              Atendimentos
            </div>
            <span class="card-badge badge-purple">IA vs Pedro</span>
          </div>
          <div class="card-body" style="padding:12px 18px 16px">
            <div class="donut-wrap">
              <canvas id="chart-donut" style="position:absolute;width:180px!important;height:180px!important"></canvas>
              <div class="donut-center" id="donut-center">
                <div class="donut-center-val" id="donut-total">—</div>
                <div class="donut-center-lbl">ativos</div>
              </div>
            </div>
            <div class="donut-legend" id="donut-legend"></div>
          </div>
        </div>

        <!-- Gauge conversão -->
        <div class="card">
          <div class="card-head">
            <div class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              Taxa de Conversão
            </div>
          </div>
          <div class="card-body" style="padding:10px 18px 16px">
            <div class="gauge-wrap">
              <svg class="gauge-svg" viewBox="0 0 200 110" id="gauge-svg">
                <defs>
                  <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#ef4444"/>
                    <stop offset="50%" stop-color="#f59e0b"/>
                    <stop offset="100%" stop-color="#10b981"/>
                  </linearGradient>
                </defs>
                <!-- Track -->
                <path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14" stroke-linecap="round"/>
                <!-- Arc -->
                <path id="gauge-arc" d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 251.2" style="transition:stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)"/>
                <!-- Needle -->
                <circle id="gauge-needle" cx="20" cy="100" r="5" fill="#fff" opacity="0" style="transition:all 1.2s cubic-bezier(.4,0,.2,1)"/>
              </svg>
              <div class="gauge-value" id="gauge-val">—</div>
              <div class="gauge-label">de conversão histórica</div>
            </div>
            <div class="gauge-stats">
              <div class="g-stat">
                <div class="g-stat-val" id="gs-total" style="color:var(--muted)">—</div>
                <div class="g-stat-lbl">Total</div>
              </div>
              <div class="g-stat">
                <div class="g-stat-val" id="gs-ganhos" style="color:var(--green)">—</div>
                <div class="g-stat-lbl">Ganhos</div>
              </div>
              <div class="g-stat">
                <div class="g-stat-val" id="gs-perdidos" style="color:var(--red)">—</div>
                <div class="g-stat-lbl">Perdidos</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Row 2 colunas: conversas + feed -->
      <div class="section-row row-2">

        <!-- Conversas ativas -->
        <div class="card">
          <div class="card-head">
            <div class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Conversas Ativas
              <div class="live-dot" style="margin-left:2px"></div>
            </div>
            <span class="card-badge badge-blue" id="conv-count">0</span>
          </div>
          <div class="conv-table-wrap">
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
              <tbody id="conv-tbody">
                <tr class="empty-row"><td colspan="6">Carregando conversas...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Feed atividade -->
        <div class="card">
          <div class="card-head">
            <div class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Atividade Recente
            </div>
          </div>
          <div class="feed-body" id="feed-body">
            <div class="feed-empty">Carregando...</div>
          </div>
        </div>

      </div>
    </div>
  </div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
let D = null;
let chartFunil = null;
let chartDonut = null;
const REFRESH_S = 60;
let countdown = REFRESH_S;
let timer = null;

// ── Countdown / progress ──────────────────────────────────────────────────
function startCountdown() {
  clearInterval(timer);
  countdown = REFRESH_S;
  timer = setInterval(() => {
    countdown--;
    const pct = ((REFRESH_S - countdown) / REFRESH_S) * 100;
    document.getElementById('progress-bar').style.width = pct + '%';
    if (countdown <= 0) { clearInterval(timer); fetchData(); }
  }, 1000);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmt(min) {
  if (!min && min !== 0) return '—';
  if (min < 60)  return min + 'min';
  if (min < 1440) return Math.floor(min/60) + 'h' + (min%60>0 ? (min%60)+'m' : '');
  return Math.floor(min/1440) + 'd';
}
function tempoClass(min) {
  if (min > 240) return 't-crit';
  if (min > 60)  return 't-warn';
  return 't-ok';
}
function avatarColor(name) {
  const h = [...(name||'?')].reduce((a,c)=>a+c.charCodeAt(0),0);
  const colors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899'];
  return colors[h % colors.length];
}
function initials(name) {
  return (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
}

// ── Count-up animation ────────────────────────────────────────────────────
function countUp(el, target, suffix='', duration=1200) {
  const start = performance.now();
  const isFloat = String(target).includes('.');
  const end = parseFloat(target) || 0;
  function tick(now) {
    const p = Math.min((now-start)/duration,1);
    const ease = 1-Math.pow(1-p,3);
    const cur = end * ease;
    el.textContent = (isFloat ? cur.toFixed(1) : Math.round(cur)) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Sparkline ─────────────────────────────────────────────────────────────
function drawSparkline(svgId, color) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const pts = Array.from({length:7},()=>Math.random()*40+10);
  const w=60,h=20,max=Math.max(...pts),min=Math.min(...pts);
  const norm = pts.map(v=>h-((v-min)/(max-min||1))*h);
  const d = norm.map((y,i)=>\`\${i===0?'M':'L'}\${(i/(pts.length-1))*w},\${y}\`).join(' ');
  svg.setAttribute('viewBox',\`0 0 \${w} \${h}\`);
  svg.innerHTML = \`<defs><linearGradient id="sg\${svgId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="\${color}" stop-opacity="0.3"/><stop offset="100%" stop-color="\${color}" stop-opacity="0"/></linearGradient></defs><path d="\${d} L\${w},\${h} L0,\${h}Z" fill="url(#sg\${svgId})"/><path d="\${d}" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linejoin="round"/>\`;
}

// ── Gauge ─────────────────────────────────────────────────────────────────
function animateGauge(pct) {
  const total = 251.2;
  const fill = (pct / 100) * total;
  const arc = document.getElementById('gauge-arc');
  const needle = document.getElementById('gauge-needle');
  if (!arc) return;
  setTimeout(()=>{
    arc.style.strokeDasharray = \`\${fill} \${total}\`;
    // Needle position along the arc
    const angle = -180 + (pct/100)*180; // -180 to 0
    const rad = angle * Math.PI / 180;
    const cx = 100 + 80 * Math.cos(rad);
    const cy = 100 + 80 * Math.sin(rad);
    needle.setAttribute('cx', cx);
    needle.setAttribute('cy', cy);
    needle.setAttribute('opacity','1');
  },200);
}

// ── Funil chart ───────────────────────────────────────────────────────────
function renderFunil(funil) {
  const ctx = document.getElementById('chart-funil');
  if (!ctx) return;
  if (chartFunil) chartFunil.destroy();
  const labels = funil.map(f=>f.etapa);
  const data   = funil.map(f=>f.total);
  const colors = funil.map(f=>f.cor);
  const total  = data.reduce((a,b)=>a+b,0);
  document.getElementById('funil-badge').textContent = total + ' leads';
  chartFunil = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets:[{
        data,
        backgroundColor: colors.map(c=>c+'cc'),
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      animation:{duration:900,easing:'easeInOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#111722',
          borderColor:'rgba(255,255,255,0.1)',
          borderWidth:1,
          titleColor:'#e6edf3',
          bodyColor:'#7d8590',
          padding:10,
          callbacks:{
            label:ctx=>\` \${ctx.raw} leads (\${total>0?((ctx.raw/total)*100).toFixed(1):0}%)\`
          }
        }
      },
      scales:{
        x:{
          grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},
          ticks:{color:'#484f58',font:{family:'DM Mono',size:11}},
          border:{display:false}
        },
        y:{
          grid:{display:false},
          ticks:{color:'#7d8590',font:{family:'Plus Jakarta Sans',size:12,weight:'500'}},
          border:{display:false}
        }
      }
    }
  });
}

// ── Donut chart ───────────────────────────────────────────────────────────
function renderDonut(split) {
  const ctx = document.getElementById('chart-donut');
  if (!ctx) return;
  if (chartDonut) chartDonut.destroy();
  const ia = split.ia, pedro = split.pedro;
  const total = ia.ativos + pedro.ativos;
  document.getElementById('donut-total').textContent = total;
  chartDonut = new Chart(ctx, {
    type:'doughnut',
    data:{
      labels:['IA','Pedro'],
      datasets:[{
        data:[ia.ativos, pedro.ativos],
        backgroundColor:['rgba(139,92,246,0.8)','rgba(59,130,246,0.8)'],
        borderColor:['#8b5cf6','#3b82f6'],
        borderWidth:2,
        hoverOffset:4
      }]
    },
    options:{
      responsive:false,
      cutout:'70%',
      animation:{duration:900,animateRotate:true},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#111722',
          borderColor:'rgba(255,255,255,0.1)',
          borderWidth:1,
          titleColor:'#e6edf3',
          bodyColor:'#7d8590',
          callbacks:{label:c=>\` \${c.raw} ativos\`}
        }
      }
    }
  });
  // Legend customizada
  document.getElementById('donut-legend').innerHTML = \`
    <div class="legend-item">
      <div class="legend-left">
        <div class="legend-dot" style="background:var(--purple)"></div>
        <div><div class="legend-name">🤖 IA</div><div style="font-size:10px;color:var(--muted)">\${ia.ativos} ativos</div></div>
      </div>
      <div class="legend-right">
        <div class="legend-rate" style="color:var(--purple)">\${ia.taxa}%</div>
        <div class="legend-wins" style="color:var(--muted)">\${ia.ganhos} ganhos</div>
      </div>
    </div>
    <div class="legend-item">
      <div class="legend-left">
        <div class="legend-dot" style="background:var(--blue)"></div>
        <div><div class="legend-name">👤 Pedro</div><div style="font-size:10px;color:var(--muted)">\${pedro.ativos} ativos</div></div>
      </div>
      <div class="legend-right">
        <div class="legend-rate" style="color:var(--blue)">\${pedro.taxa}%</div>
        <div class="legend-wins" style="color:var(--muted)">\${pedro.ganhos} ganhos</div>
      </div>
    </div>
  \`;
}

// ── Conversas table ───────────────────────────────────────────────────────
function renderConversas(convs) {
  document.getElementById('conv-count').textContent = convs.length;
  const tbody = document.getElementById('conv-tbody');
  if (!convs.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhuma conversa ativa no momento</td></tr>';
    return;
  }
  const etapaCor = {
    'Novo Lead':'#94a3b8','Primeira mensagem':'#3b82f6',
    'Conexão':'#8b5cf6','Aguardando Pagamento':'#f59e0b',
    'Ganho':'#10b981','Perdido':'#ef4444','Desconhecida':'#484f58'
  };
  tbody.innerHTML = convs.map(c=>{
    const cor = etapaCor[c.etapa]||'#484f58';
    const ini = initials(c.nome);
    const bg  = avatarColor(c.nome);
    const atCls = c.atendente==='IA'?'at-ia':c.atendente==='Pedro'?'at-pedro':'at-none';
    const atTxt = c.atendente==='IA'?'🤖 IA':c.atendente==='Pedro'?'👤 Pedro':c.atendente;
    const tCls = tempoClass(c.minutos_sem_resposta);
    const sCls = c.status==='parado'?'s-parado':c.status==='aguardando'?'s-aguardando':'s-ativo';
    const sTxt = c.status==='parado'?'Parado':c.status==='aguardando'?'Aguardando':'Ativo';
    return \`<tr>
      <td><div class="lead-cell"><div class="avatar" style="background:\${bg}20;color:\${bg}">\${ini}</div><div class="lead-name">\${c.nome}</div></div></td>
      <td class="concurso-cell">\${c.concurso||'—'}</td>
      <td><span class="etapa-pill" style="background:\${cor}18;color:\${cor}">\${c.etapa}</span></td>
      <td><span class="atendente-badge \${atCls}">\${atTxt}</span></td>
      <td class="tempo-cell \${tCls}">\${fmt(c.minutos_sem_resposta)}</td>
      <td><div class="status-cell \${sCls}"><span class="status-dot"></span>\${sTxt}</div></td>
    </tr>\`;
  }).join('');
}

// ── Activity feed ─────────────────────────────────────────────────────────
function renderFeed(items) {
  const body = document.getElementById('feed-body');
  if (!items.length) { body.innerHTML='<div class="feed-empty">Sem atividade recente</div>'; return; }
  const icons = {ganho:'🏆',perdido:'💔',pagamento:'💳',escalado:'⚡',followup:'📤',atualizado:'📋'};
  body.innerHTML = items.map(a=>\`
    <div class="feed-item f-\${a.tipo}">
      <div class="feed-icon">\${icons[a.tipo]||'📌'}</div>
      <div class="feed-content">
        <div class="feed-text">\${a.evento}</div>
        <div class="feed-time">\${a.hora}</div>
      </div>
    </div>
  \`).join('');
}

// ── Alertas ───────────────────────────────────────────────────────────────
function renderAlertas(alertas) {
  const area = document.getElementById('alertas-area');
  if (!alertas.length) {
    area.innerHTML = '<div class="no-alertas">✓ Sem alertas no momento — tudo sob controle</div>';
    return;
  }
  area.innerHTML = alertas.map(a=>\`
    <div class="alerta-chip \${a.urgencia}">
      <span class="alerta-icon">\${a.urgencia==='alta'?'🔴':'🟡'}</span>
      \${a.mensagem}
    </div>
  \`).join('');
}

// ── KPIs render ───────────────────────────────────────────────────────────
function renderKPIs(kpis, funil) {
  const ganhos  = funil.find(f=>f.etapa==='Ganho')?.total || kpis.leads_ativos;
  const perdidos = funil.find(f=>f.etapa==='Perdido')?.total || 0;
  const total = (funil.reduce((a,f)=>a+f.total,0));

  countUp(document.getElementById('v-leads-hoje'), kpis.leads_hoje);
  countUp(document.getElementById('v-ganhos-hoje'), kpis.ganhos_hoje);
  countUp(document.getElementById('v-taxa'), kpis.taxa_conversao, '%');
  countUp(document.getElementById('v-ativos'), kpis.leads_ativos);
  countUp(document.getElementById('v-aguard'), kpis.aguardando_pagamento);

  document.getElementById('gauge-val').textContent = kpis.taxa_conversao + '%';
  document.getElementById('gs-total').textContent = total;
  document.getElementById('gs-ganhos').textContent = ganhos;
  document.getElementById('gs-perdidos').textContent = perdidos;
  animateGauge(kpis.taxa_conversao);

  drawSparkline('sp-0','#3b82f6');
  drawSparkline('sp-1','#10b981');
  drawSparkline('sp-2','#8b5cf6');
  drawSparkline('sp-3','#3b82f6');
  drawSparkline('sp-4','#f59e0b');
}

// ── Main render ───────────────────────────────────────────────────────────
function renderAll(d) {
  D = d;
  renderKPIs(d.kpis, d.funil);
  renderFunil(d.funil);
  renderDonut(d.split_atendimento);
  renderConversas(d.conversas_ativas || []);
  renderFeed(d.atividade_recente || []);
  renderAlertas(d.alertas || []);
  const ts = new Date(d.atualizado_em);
  document.getElementById('update-ts').textContent = 'Atualizado às ' + ts.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Sao_Paulo'});
}

// ── Fetch ─────────────────────────────────────────────────────────────────
async function fetchData() {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('loading');
  try {
    const r = await fetch('/api/dashboard');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    renderAll(d);
    startCountdown();
  } catch(e) {
    console.error(e);
    document.getElementById('update-ts').textContent = 'Erro ao atualizar';
  } finally {
    btn.classList.remove('loading');
  }
}

async function refresh() {
  clearInterval(timer);
  document.getElementById('progress-bar').style.width = '0%';
  await fetchData();
}

// ── Init ──────────────────────────────────────────────────────────────────
fetchData();
</script>
</body>
</html>`;
}
