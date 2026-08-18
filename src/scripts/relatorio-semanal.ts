// Relatório semanal de vendas da IA — reproduz a análise do funil AI-led.
// Fontes: banco (n8n_historico_mensagens = conversas conduzidas pela IA) + Kanban (vendas) +
// Langfuse (custo, best-effort). Gera um HTML pronto pra compartilhar em output/.
//
// Uso:
//   bun run src/scripts/relatorio-semanal.ts            # últimos 7 dias
//   bun run src/scripts/relatorio-semanal.ts 14         # últimos 14 dias
//
// O fluxo foi destilado da análise feita manualmente (funil, ghosting pós-preço, vendas por
// step do Kanban). Roda onde os segredos existem (.env do app), então pode ser agendado no
// servidor (cron/Coolify) que já hospeda a aplicação.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pool } from "../db/pool.ts";
import { env } from "../config/env.ts";
import { listarKanbanTasks, type KanbanTaskResumo } from "../services/chatwoot.ts";

const DIAS = Number(process.argv[2] ?? "7");
const BOARD_ID = 1;
const STEP_GANHO = 9;
const STEP_AG_PAGTO = 8;

const ate = new Date();
const de = new Date(ate.getTime() - DIAS * 24 * 60 * 60 * 1000);
const deISO = de.toISOString();
const ateISO = ate.toISOString();
const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

console.log(`\n📊 Relatório semanal — ${fmt(de)} a ${fmt(ate)} (${DIAS} dias)\n`);

// ─────────────────────────────────────────────────────────────────────────────
// 1) Funil AI-led (banco de conversas)
// ─────────────────────────────────────────────────────────────────────────────
const precoRegex = "R\\$\\s?(3\\.997|3\\.197|1\\.997|997|394|315|197)";
const funilQ = await pool.query<{
  leads: string; engajaram: string; chegaram_preco: string;
  sumiram_pos_preco: string; novos: string;
}>(`
  WITH j AS (
    SELECT DISTINCT session_id FROM n8n_historico_mensagens
    WHERE created_at >= $1 AND created_at < $2
  ),
  firsts AS (SELECT session_id, min(created_at) prim FROM n8n_historico_mensagens GROUP BY 1),
  agg AS (
    SELECT h.session_id,
      count(*) FILTER (WHERE type='human') n_lead,
      bool_or(type='ai' AND content ~ '${precoRegex}') chegou_preco,
      (array_agg(type ORDER BY created_at DESC))[1] ult
    FROM n8n_historico_mensagens h JOIN j USING(session_id) GROUP BY 1
  )
  SELECT
    (SELECT count(*) FROM j) leads,
    count(*) FILTER (WHERE n_lead > 0) engajaram,
    count(*) FILTER (WHERE chegou_preco) chegaram_preco,
    count(*) FILTER (WHERE chegou_preco AND ult='ai') sumiram_pos_preco,
    (SELECT count(*) FROM firsts f JOIN j USING(session_id) WHERE f.prim >= $1) novos
  FROM agg;
`, [deISO, ateISO]);
const f = funilQ.rows[0]!;
const leads = +f.leads, engajaram = +f.engajaram, chegaramPreco = +f.chegaram_preco;
const sumiramPosPreco = +f.sumiram_pos_preco, novos = +f.novos;

// ─────────────────────────────────────────────────────────────────────────────
// 2) Vendas e pipeline (Kanban) — o endpoint IGNORA o filtro de step e devolve tudo
// em ordem de id (antigas primeiro). Uma task antiga pode ter entrado no step ESTA
// semana, então varremos TODAS as páginas uma vez e filtramos por step_changed_at.
// ─────────────────────────────────────────────────────────────────────────────
// Cada lead vira {title, link} — link abre a conversa direto no CRM pra o Pedro contatar.
type LeadRef = { title: string; link: string };
const CRM_BASE = `${env.CHATWOOT_BASE_URL}/app/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations`;

async function varrerKanban(): Promise<{ ganho: LeadRef[]; agPagto: LeadRef[] }> {
  const ganho: LeadRef[] = [], agPagto: LeadRef[] = [];
  for (let page = 1; page <= 120; page++) {
    let tasks: KanbanTaskResumo[] = [];
    // Retry por página: a varredura faz ~74 requisições e uma pode dar timeout — não deixa
    // um erro transitório abortar o relatório inteiro.
    for (let tent = 1; tent <= 3; tent++) {
      try { tasks = await listarKanbanTasks(env.CHATWOOT_ACCOUNT_ID, BOARD_ID, STEP_GANHO, page); break; }
      catch (e) {
        if (tent === 3) throw e;
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (tasks.length === 0) break;
    for (const t of tasks) {
      const x = t as unknown as { step_changed_at?: string; board_step_id: number };
      const sc = x.step_changed_at ?? "";
      if (sc >= deISO && sc < ateISO) {
        const conv = t.conversations?.[0]?.display_id ?? null;
        const ref: LeadRef = { title: t.title, link: conv ? `${CRM_BASE}/${conv}` : "" };
        if (x.board_step_id === STEP_GANHO) ganho.push(ref);
        else if (x.board_step_id === STEP_AG_PAGTO) agPagto.push(ref);
      }
    }
  }
  return { ganho, agPagto };
}

let vendas = { total: 0, titulos: [] as LeadRef[] };
let aguardando = { total: 0, titulos: [] as LeadRef[] };
let kanbanOk = true;
try {
  const k = await varrerKanban();
  vendas = { total: k.ganho.length, titulos: k.ganho };
  aguardando = { total: k.agPagto.length, titulos: k.agPagto };
} catch (e) {
  kanbanOk = false;
  console.warn("  ⚠ Kanban indisponível:", (e as Error).message);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Custo (Langfuse) — best-effort, via CLI existente
// ─────────────────────────────────────────────────────────────────────────────
let custoUsd = "";
try {
  const out = execSync(`bun run src/scripts/langfuse.ts resumo ${DIAS}`, { encoding: "utf8", timeout: 60000 });
  custoUsd = (out.match(/Total no período:\s*\$([\d.,]+)/)?.[1] ?? "").trim();
} catch { /* Langfuse opcional */ }

// ─────────────────────────────────────────────────────────────────────────────
// 4) Métricas derivadas
// ─────────────────────────────────────────────────────────────────────────────
const convGeral = leads ? ((vendas.total / leads) * 100).toFixed(1) : "0";
const convPreco = chegaramPreco ? ((vendas.total / chegaramPreco) * 100).toFixed(1) : "0";
const pctChegouPreco = engajaram ? ((chegaramPreco / engajaram) * 100).toFixed(0) : "0";

console.log(`  Leads ativos:        ${leads} (${novos} novos)`);
console.log(`  Engajaram:           ${engajaram}`);
console.log(`  Chegaram ao preço:   ${chegaramPreco} (${pctChegouPreco}% dos engajados)`);
console.log(`  Sumiram pós-preço:   ${sumiramPosPreco} / ${chegaramPreco}`);
console.log(`  VENDAS (Ganho):      ${vendas.total}${kanbanOk ? "" : " (Kanban indisponível)"}`);
console.log(`  Aguardando pagto:    ${aguardando.total}`);
console.log(`  Conversão:           ${convGeral}% dos leads · ${convPreco}% dos que viram o preço`);
console.log(`  Custo Langfuse:      ${custoUsd ? "US$ " + custoUsd : "(indisponível)"}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5) HTML (mesmo visual do relatório compartilhado)
// ─────────────────────────────────────────────────────────────────────────────
const dataArquivo = ate.toISOString().slice(0, 10);
const html = gerarHtml({
  periodo: `${fmt(de)} a ${fmt(ate)}`, leads, novos, engajaram, chegaramPreco,
  sumiramPosPreco, vendas: vendas.total, aguardando: aguardando.total, kanbanOk,
  convGeral, convPreco, pctChegouPreco, custoUsd,
  vendasTitulos: vendas.titulos, aguardandoTitulos: aguardando.titulos,
});

mkdirSync("output", { recursive: true });
const outPath = `output/relatorio-vendas-${dataArquivo}.html`;
writeFileSync(outPath, html);
writeFileSync(`output/relatorio-vendas-${dataArquivo}.json`, JSON.stringify({
  periodo: { de: deISO, ate: ateISO, dias: DIAS },
  funil: { leads, novos, engajaram, chegaramPreco, sumiramPosPreco },
  vendas: vendas.total, aguardando: aguardando.total,
  conversao: { geral: convGeral, doPreco: convPreco }, custoUsd,
  vendasTitulos: vendas.titulos, aguardandoTitulos: aguardando.titulos,
}, null, 2));

console.log(`\n✅ Gerado: ${outPath}`);
console.log(`   (e o .json com os dados brutos ao lado)\n`);
await pool.end();

// ─────────────────────────────────────────────────────────────────────────────
function gerarHtml(d: {
  periodo: string; leads: number; novos: number; engajaram: number; chegaramPreco: number;
  sumiramPosPreco: number; vendas: number; aguardando: number; kanbanOk: boolean;
  convGeral: string; convPreco: string; pctChegouPreco: string; custoUsd: string;
  vendasTitulos: LeadRef[]; aguardandoTitulos: LeadRef[];
}): string {
  const esc = (s: string) => s.replace(/</g, "&lt;");
  const li = (arr: LeadRef[], comLink = false) => arr.length
    ? arr.map(r => (comLink && r.link)
        ? `<li><a href="${r.link}" target="_blank" rel="noopener">${esc(r.title)} ↗</a></li>`
        : `<li>${esc(r.title)}</li>`).join("")
    : "<li>(nenhum no período)</li>";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Vendas IA — ${d.periodo}</title>
<style>
  :root{--bg:#f4f5f7;--panel:#fff;--ink:#1a1d24;--soft:#4b525e;--muted:#8a919e;--line:#e4e7ec;
    --accent:#3b4a9e;--won:#1a875a;--wait:#b8791b;--lost:#c0392f;
    --mono:ui-monospace,Menlo,Consolas,monospace;--serif:Georgia,serif;--sans:system-ui,-apple-system,sans-serif;}
  @media(prefers-color-scheme:dark){:root{--bg:#0e1016;--panel:#171a22;--ink:#eef0f4;--soft:#b3bac6;
    --muted:#7c8494;--line:#282d38;--accent:#8b9bff;--won:#4ec98a;--wait:#e0a94a;--lost:#f0766a;}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55}
  .wrap{max-width:900px;margin:0 auto;padding:32px 20px 80px}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  h1{font-family:var(--serif);font-size:34px;margin:.3em 0 .1em;letter-spacing:-.01em}
  .sub{color:var(--soft);font-size:14.5px}
  h2{font-family:var(--serif);font-size:20px;margin:34px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:720px){.kpis{grid-template-columns:repeat(2,1fr)}}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:15px 16px}
  .kpi .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .kpi .v{font-size:30px;font-weight:700;letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
  .kpi .d{font-size:12.5px;color:var(--soft);margin-top:2px}
  .kpi.win .v{color:var(--won)}.kpi.warn .v{color:var(--wait)}
  .leak{display:flex;gap:16px;align-items:center;background:color-mix(in srgb,var(--lost) 10%,transparent);
    border:1px solid color-mix(in srgb,var(--lost) 30%,transparent);border-radius:12px;padding:16px 20px;margin-top:12px}
  .leak .big{font-family:var(--serif);font-size:40px;font-weight:700;color:var(--lost);white-space:nowrap}
  .leak p{margin:0;font-size:14px;color:var(--soft)}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:680px){.two{grid-template-columns:1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  ul{margin:6px 0 0;padding-left:18px}li{font-size:13.5px;color:var(--soft);margin:4px 0}
  a{color:var(--accent);text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
  .foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">
  <div class="eyebrow">Relatório de Vendas · IA "Perito Walker" · Instituto Vestigium</div>
  <h1>Desempenho da semana</h1>
  <div class="sub">Período <b>${d.periodo}</b> · atendimento conduzido pela IA (WhatsApp comercial)</div>

  <h2>Números</h2>
  <div class="kpis">
    <div class="kpi"><div class="k">Leads atendidos</div><div class="v">${d.leads}</div><div class="d">${d.novos} novos</div></div>
    <div class="kpi"><div class="k">Chegaram ao preço</div><div class="v">${d.chegaramPreco}</div><div class="d">${d.pctChegouPreco}% dos engajados</div></div>
    <div class="kpi win"><div class="k">Vendas (Ganho)</div><div class="v">${d.kanbanOk ? d.vendas : "—"}</div><div class="d">conversão ${d.convGeral}%</div></div>
    <div class="kpi warn"><div class="k">Aguardando pagto</div><div class="v">${d.kanbanOk ? d.aguardando : "—"}</div><div class="d">link enviado, sem pagar</div></div>
  </div>

  <h2>O vazamento: pós-preço</h2>
  <div class="leak"><div class="big">${d.sumiramPosPreco}&nbsp;/&nbsp;${d.chegaramPreco}</div>
    <p>dos leads que <b>viram o preço sumiram logo depois</b> (a IA falou por último e ninguém respondeu). É onde mora quase toda a perda de venda — alvo do "closer" humano e da recuperação em escada.</p></div>

  <h2>Ações da semana</h2>
  <p style="font-size:13.5px;color:var(--soft);margin:0 0 12px">👉 <b>Pedro:</b> os leads <b>aguardando pagamento</b> têm link direto pra abrir a conversa no CRM e entrar em contato.</p>
  <div class="two">
    <div class="card"><div class="eyebrow" style="color:var(--won)">Vendas fechadas (${d.vendasTitulos.length})</div><ul>${li(d.vendasTitulos)}</ul></div>
    <div class="card"><div class="eyebrow" style="color:var(--wait)">Aguardando pagamento — contatar (${d.aguardandoTitulos.length})</div><ul>${li(d.aguardandoTitulos, true)}</ul></div>
  </div>

  <div class="foot">Fontes: banco de conversas (funil AI-led) · Kanban fazer.ai (vendas)${d.custoUsd ? " · Langfuse (custo)" : ""}.${d.custoUsd ? ` Custo do período: US$ ${d.custoUsd}.` : ""} Gerado automaticamente por <code>bun run relatorio</code>.</div>
</div></body></html>`;
}
