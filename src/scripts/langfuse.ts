/**
 * CLI de análise dos traces do Langfuse (observabilidade da IA).
 *
 * Cada execução do grafo vira um "trace" no Langfuse, com o sessionId = telefone
 * do lead. Dentro do trace ficam as "observations": cada chamada de LLM, cada
 * tool, cada nó do grafo — com prompt, resposta, tokens, custo e duração.
 *
 * Use isto para investigar POR QUE a IA respondeu de determinado jeito, onde o
 * tempo/dinheiro está indo, e o que quebrou. Complementa o Chatwoot: lá se vê o
 * que o lead recebeu, aqui se vê o que a IA pensou.
 *
 * Uso:
 *   bun run lf resumo [dias]        # custo, tokens e volume por dia
 *   bun run lf sessoes [n]          # últimos leads atendidos
 *   bun run lf conversa <telefone>  # histórico de raciocínio de um lead
 *   bun run lf trace <id>           # waterfall de um trace (onde foi o tempo)
 *   bun run lf lentos [n] [dias]    # traces mais lentos
 *   bun run lf caros [n] [dias]     # traces mais caros
 *   bun run lf erros [n]            # observations com level ERROR/WARNING
 *
 * Pré-requisito: LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASEURL no .env
 */

import { env } from "../config/env.ts";

const BASE = env.LANGFUSE_BASEURL;
const AUTH =
  "Basic " +
  Buffer.from(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`).toString("base64");

if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
  console.error("Chaves do Langfuse ausentes no .env (LANGFUSE_PUBLIC_KEY/SECRET_KEY).");
  process.exit(1);
}

// ─────────────────────────── infra ───────────────────────────

async function api<T = any>(caminho: string): Promise<T> {
  const resp = await fetch(`${BASE}${caminho}`, { headers: { Authorization: AUTH } });
  if (!resp.ok) {
    throw new Error(`${resp.status} em ${caminho}: ${(await resp.text()).slice(0, 300)}`);
  }
  return (await resp.json()) as T;
}

/** Busca N páginas de traces de uma vez (a API pagina de 50 em 50). */
async function buscarTraces(params: string, paginas = 1): Promise<any[]> {
  const tudo: any[] = [];
  for (let p = 1; p <= paginas; p++) {
    const r = await api(`/api/public/traces?limit=50&page=${p}&${params}`);
    tudo.push(...(r.data ?? []));
    if (!r.data?.length || p >= (r.meta?.totalPages ?? 1)) break;
  }
  return tudo;
}

function desdeDias(dias: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  return `fromTimestamp=${d.toISOString()}`;
}

function seg(n: number | null | undefined): string {
  return n == null ? "-" : `${n.toFixed(1)}s`;
}

function usd(n: number | null | undefined): string {
  return n == null ? "-" : `$${n.toFixed(4)}`;
}

function quando(ts: string): string {
  return new Date(ts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function cortar(txt: string, max: number): string {
  const limpo = txt.replace(/\s+/g, " ").trim();
  return limpo.length > max ? `${limpo.slice(0, max)}…` : limpo;
}

/** Extrai texto e tool_calls de uma mensagem serializada do LangChain. */
function lerMensagem(m: any): { tipo: string; texto: string; tools: string[] } {
  const tipo = m?.type ?? m?.id?.at?.(-1) ?? "?";
  const bruto = m?.content ?? m?.kwargs?.content ?? m?.lc_kwargs?.content ?? "";
  const texto =
    typeof bruto === "string"
      ? bruto
      : Array.isArray(bruto)
        ? bruto.map((p: any) => p?.text ?? "").join(" ")
        : JSON.stringify(bruto);
  const chamadas = m?.tool_calls ?? m?.lc_kwargs?.tool_calls ?? [];
  return {
    tipo,
    texto,
    tools: chamadas.map((t: any) => `${t.name}(${cortar(JSON.stringify(t.args ?? {}), 80)})`),
  };
}

function mensagensDe(campo: any): any[] {
  if (!campo) return [];
  if (Array.isArray(campo)) return campo;
  if (Array.isArray(campo.messages)) return campo.messages;
  return [];
}

// ─────────────────────────── comandos ───────────────────────────

async function resumo(dias = 7) {
  const r = await api(`/api/public/metrics/daily?limit=${dias}`);
  console.log("\nDIA          TRACES   OBS    CUSTO      TOKENS IN    TOKENS OUT");
  console.log("─".repeat(70));
  let custoTotal = 0;
  for (const d of r.data ?? []) {
    const modelos = (d.usage ?? []).filter((u: any) => u.model);
    const entrada = modelos.reduce((s: number, u: any) => s + (u.inputUsage ?? 0), 0);
    const saida = modelos.reduce((s: number, u: any) => s + (u.outputUsage ?? 0), 0);
    custoTotal += d.totalCost ?? 0;
    console.log(
      `${d.date}   ${String(d.countTraces).padEnd(7)}${String(d.countObservations).padEnd(7)}` +
        `${usd(d.totalCost).padEnd(11)}${entrada.toLocaleString("pt-BR").padEnd(13)}${saida.toLocaleString("pt-BR")}`,
    );
  }
  console.log("─".repeat(70));
  console.log(`Total no período: ${usd(custoTotal)}  |  projeção 30d: ${usd((custoTotal / (r.data?.length || 1)) * 30)}\n`);

  const modelos: Record<string, { custo: number; obs: number }> = {};
  for (const d of r.data ?? []) {
    for (const u of d.usage ?? []) {
      if (!u.model) continue;
      modelos[u.model] ??= { custo: 0, obs: 0 };
      modelos[u.model]!.custo += u.totalCost ?? 0;
      modelos[u.model]!.obs += u.countObservations ?? 0;
    }
  }
  for (const [m, v] of Object.entries(modelos)) {
    console.log(`  ${m}: ${usd(v.custo)} em ${v.obs} chamadas (${usd(v.custo / v.obs)}/chamada)`);
  }
  console.log();
}

async function sessoes(n = 20) {
  const r = await api(`/api/public/sessions?limit=${n}`);
  console.log(`\n${r.meta?.totalItems ?? "?"} leads rastreados. Últimos ${n}:\n`);
  for (const s of r.data ?? []) {
    console.log(`  ${quando(s.createdAt).padEnd(22)} ${s.id}`);
  }
  console.log(`\n→ detalhe: bun run lf conversa <telefone>\n`);
}

async function conversa(sessionId: string) {
  const traces = await buscarTraces(`sessionId=${encodeURIComponent(sessionId)}`, 4);
  if (!traces.length) {
    console.log(`\nNenhum trace para a sessão "${sessionId}". Confira o formato (+5511999999999).\n`);
    return;
  }
  traces.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const custo = traces.reduce((s, t) => s + (t.totalCost ?? 0), 0);
  console.log(`\n═══ ${sessionId} — ${traces.length} execuções, ${usd(custo)} ═══\n`);

  for (const t of traces) {
    console.log(`┌─ ${quando(t.timestamp)}  ${seg(t.latency)}  ${usd(t.totalCost)}  [${(t.tags ?? []).join(",")}]`);
    console.log(`│  trace: ${t.id}`);

    const entrada = mensagensDe(t.input).map(lerMensagem);
    const ultimaHumana = [...entrada].reverse().find((m) => m.tipo === "human");
    if (ultimaHumana) console.log(`│  LEAD  › ${cortar(ultimaHumana.texto, 300)}`);

    for (const m of mensagensDe(t.output).map(lerMensagem)) {
      if (m.tools.length) for (const tool of m.tools) console.log(`│  TOOL  › ${tool}`);
      if (m.tipo === "ai" && m.texto) console.log(`│  IA    › ${cortar(m.texto, 300)}`);
    }
    console.log(`└─\n`);
  }
  console.log(`→ waterfall de um trace: bun run lf trace <id>\n`);
}

async function trace(id: string) {
  const t = await api(`/api/public/traces/${id}`);
  console.log(`\n═══ ${t.name} — ${quando(t.timestamp)} ═══`);
  console.log(`sessão: ${t.sessionId}  |  ${seg(t.latency)}  |  ${usd(t.totalCost)}  |  tags: ${(t.tags ?? []).join(",")}\n`);

  const obs = [...(t.observations ?? [])].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  const t0 = obs.length ? new Date(obs[0]!.startTime).getTime() : 0;

  console.log("  OFFSET   DURAÇÃO   TIPO         NOME                          CUSTO / TOKENS");
  console.log("  " + "─".repeat(88));
  for (const o of obs) {
    const ini = new Date(o.startTime).getTime();
    const dur = o.endTime ? (new Date(o.endTime).getTime() - ini) / 1000 : null;
    const tokens = o.usage?.total ? `${o.usage.total} tk` : "";
    const custo = o.calculatedTotalCost ? usd(o.calculatedTotalCost) : "";
    const alerta = dur != null && dur > 5 ? " ←" : "";
    console.log(
      `  +${((ini - t0) / 1000).toFixed(1).padStart(6)}s ${seg(dur).padStart(8)}   ` +
        `${String(o.type).padEnd(12)} ${cortar(o.name ?? "-", 28).padEnd(30)}${custo} ${tokens}${alerta}`,
    );
    if (o.level === "ERROR" || o.level === "WARNING") {
      console.log(`           ⚠  ${o.level}: ${cortar(o.statusMessage ?? "", 160)}`);
    }
  }
  console.log(`\n  (← marca passos acima de 5s)\n`);
}

async function ranking(campo: "latency" | "totalCost", n: number, dias: number) {
  const traces = await buscarTraces(desdeDias(dias), 10);
  const ordenados = traces
    .filter((t) => t[campo] != null)
    .sort((a, b) => b[campo] - a[campo])
    .slice(0, n);

  const rotulo = campo === "latency" ? "MAIS LENTOS" : "MAIS CAROS";
  console.log(`\n═══ ${n} ${rotulo} (últimos ${dias}d, ${traces.length} traces analisados) ═══\n`);
  for (const t of ordenados) {
    console.log(
      `  ${seg(t.latency).padStart(8)}  ${usd(t.totalCost).padStart(9)}  ${quando(t.timestamp).padEnd(22)} ${t.sessionId ?? "-"}`,
    );
    console.log(`            ${t.id}`);
  }
  const media = traces.reduce((s, t) => s + (t[campo] ?? 0), 0) / (traces.length || 1);
  console.log(`\n  média do período: ${campo === "latency" ? seg(media) : usd(media)}\n`);
}

async function erros(n = 20) {
  const achados: any[] = [];
  for (const nivel of ["ERROR", "WARNING"]) {
    const r = await api(`/api/public/observations?limit=${n}&level=${nivel}`);
    achados.push(...(r.data ?? []));
  }
  if (!achados.length) {
    console.log("\nNenhuma observation com level ERROR/WARNING. 👍\n");
    return;
  }
  console.log(`\n═══ ${achados.length} ocorrências ═══\n`);
  for (const o of achados.slice(0, n)) {
    console.log(`  ${o.level.padEnd(8)} ${quando(o.startTime).padEnd(22)} ${o.name}`);
    console.log(`           ${cortar(o.statusMessage ?? "(sem mensagem)", 200)}`);
    console.log(`           trace: ${o.traceId}\n`);
  }
}

// ─────────────────────────── entrada ───────────────────────────

const [cmd, a1, a2] = process.argv.slice(2);

try {
  switch (cmd) {
    case "resumo":
      await resumo(Number(a1) || 7);
      break;
    case "sessoes":
      await sessoes(Number(a1) || 20);
      break;
    case "conversa":
      if (!a1) throw new Error("informe o telefone: bun run lf conversa +5511999999999");
      await conversa(a1);
      break;
    case "trace":
      if (!a1) throw new Error("informe o id do trace");
      await trace(a1);
      break;
    case "lentos":
      await ranking("latency", Number(a1) || 10, Number(a2) || 7);
      break;
    case "caros":
      await ranking("totalCost", Number(a1) || 10, Number(a2) || 7);
      break;
    case "erros":
      await erros(Number(a1) || 20);
      break;
    default:
      console.log(`
Análise dos traces do Langfuse.

  bun run lf resumo [dias]        custo, tokens e volume por dia (padrão 7)
  bun run lf sessoes [n]          últimos leads atendidos
  bun run lf conversa <telefone>  histórico de raciocínio de um lead
  bun run lf trace <id>           waterfall: onde foi o tempo e o custo
  bun run lf lentos [n] [dias]    traces mais lentos
  bun run lf caros [n] [dias]     traces mais caros
  bun run lf erros [n]            observations com ERROR/WARNING
`);
  }
} catch (e) {
  console.error(`\nErro: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
