// Relatório de mídia da Meta: gasto, leads e custo por campanha e por mês.
//
// Fecha o ciclo com a atribuição por UTM: a Meta sabe quanto cada campanha CUSTOU, e a planilha de
// aplicação (utm_campaign) sabe quem COMPROU. Juntando os dois sai o CAC real por campanha — que é
// diferente do custo por lead que o painel mostra (a [LP] entregava lead a R$ 1,71 e vendia 2%).
//
// Configure no .env:
//   META_ACCESS_TOKEN=...        (token com permissão ads_read)
//   META_AD_ACCOUNT_ID=act_123…  (ID da conta de anúncios, com o prefixo act_)
//
// Uso:
//   bun run meta                      # últimos 3 meses, por campanha e mês
//   bun run meta 2026-06-01 2026-08-31
//   bun run meta 2026-08-01 2026-08-31 --dia     # quebra por dia em vez de mês

import { env } from "../config/env.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";

const API = "https://graph.facebook.com/v21.0";

if (!env.META_ACCESS_TOKEN || !env.META_AD_ACCOUNT_ID) {
  console.error(`
❌ Falta configurar o acesso à Meta.

No .env:
  META_ACCESS_TOKEN=EAAG...        (token com permissão ads_read)
  META_AD_ACCOUNT_ID=act_123456789 (ID da conta, COM o prefixo act_)

Como gerar o token: veja o passo a passo em docs/meta-ads.md
`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const porDia = process.argv.includes("--dia");
const hoje = new Date();
const padraoDe = new Date(hoje.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
const de = args[0] ?? padraoDe;
const ate = args[1] ?? hoje.toISOString().slice(0, 10);

type Insight = {
  campaign_name?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
};

// ATENÇÃO: a Meta devolve o MESMO lead em várias chaves ao mesmo tempo — em maio/26 a campanha da
// LP tinha lead=305, onsite_web_lead=305 e offsite_conversion.fb_pixel_lead=305, que é o mesmo
// evento visto de três ângulos. Somar tudo triplicava o resultado (952 em vez de 305).
// Regra: `lead` já é o consolidado; usamos só ele, e caímos nos alternativos apenas se ele não vier.
const LEAD_CONSOLIDADO = "lead";
const LEAD_ALTERNATIVOS = ["onsite_web_lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"];
// Conversa iniciada no WhatsApp/Direct é OUTRA coisa (campanha de mensagem), reportada à parte.
const CONVERSA_INICIADA = "onsite_conversion.messaging_first_reply";

function valorDe(acoes: Insight["actions"], tipo: string): number {
  return Number(acoes?.find((a) => a.action_type === tipo)?.value ?? 0) || 0;
}

function contarLeads(acoes: Insight["actions"]): number {
  if (!acoes) return 0;
  const consolidado = valorDe(acoes, LEAD_CONSOLIDADO);
  if (consolidado > 0) return consolidado;
  return Math.max(...LEAD_ALTERNATIVOS.map((t) => valorDe(acoes, t)), 0);
}

function contarConversas(acoes: Insight["actions"]): number {
  return valorDe(acoes, CONVERSA_INICIADA);
}

async function buscarInsights(): Promise<Insight[]> {
  const params = new URLSearchParams({
    access_token: env.META_ACCESS_TOKEN,
    level: "campaign",
    time_range: JSON.stringify({ since: de, until: ate }),
    time_increment: porDia ? "1" : "monthly",
    fields: "campaign_name,spend,impressions,reach,frequency,actions",
    limit: "500",
  });

  const todos: Insight[] = [];
  let url = `${API}/${env.META_AD_ACCOUNT_ID}/insights?${params}`;
  for (let pagina = 1; pagina <= 40; pagina++) {
    const res = await fetchComTimeout(url, { method: "GET", timeout: 60_000 });
    const corpo = await res.json() as { data?: Insight[]; paging?: { next?: string }; error?: { message: string; type: string } };
    if (corpo.error) {
      console.error(`\n❌ A Meta recusou a chamada: ${corpo.error.message}`);
      console.error(`   (tipo: ${corpo.error.type}) — token expirado ou sem permissão ads_read?\n`);
      process.exit(1);
    }
    todos.push(...(corpo.data ?? []));
    if (!corpo.paging?.next) break;
    url = corpo.paging.next;
  }
  return todos;
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const periodo = (d?: string) => (porDia ? (d ?? "") : (d ?? "").slice(0, 7));

const insights = await buscarInsights();
if (insights.length === 0) {
  console.log(`Nenhum dado entre ${de} e ${ate}. A conta veiculou anúncios nesse período?`);
  process.exit(0);
}

// Agrega por campanha × período (a API já devolve assim, mas normalizamos por segurança).
type Linha = { gasto: number; leads: number; conversas: number; impressoes: number; alcance: number };
const porCampanha = new Map<string, Map<string, Linha>>();
for (const i of insights) {
  const nome = i.campaign_name ?? "(sem nome)";
  const p = periodo(i.date_start);
  if (!porCampanha.has(nome)) porCampanha.set(nome, new Map());
  const m = porCampanha.get(nome)!;
  const atual = m.get(p) ?? { gasto: 0, leads: 0, conversas: 0, impressoes: 0, alcance: 0 };
  atual.gasto += Number(i.spend) || 0;
  atual.leads += contarLeads(i.actions);
  atual.conversas += contarConversas(i.actions);
  atual.impressoes += Number(i.impressions) || 0;
  atual.alcance += Number(i.reach) || 0;
  m.set(p, atual);
}

const periodos = [...new Set(insights.map((i) => periodo(i.date_start)))].sort();
const ordenadas = [...porCampanha.entries()].sort((a, b) => {
  const soma = (m: Map<string, Linha>) => [...m.values()].reduce((s, l) => s + l.gasto, 0);
  return soma(b[1]) - soma(a[1]);
});

console.log(`\n📊 Meta Ads — ${de} a ${ate}\n`);
for (const [nome, meses] of ordenadas) {
  const total = [...meses.values()].reduce(
    (s, l) => ({ gasto: s.gasto + l.gasto, leads: s.leads + l.leads, conversas: s.conversas + l.conversas, impressoes: 0, alcance: 0 }),
    { gasto: 0, leads: 0, conversas: 0, impressoes: 0, alcance: 0 },
  );
  if (total.gasto === 0 && total.leads === 0) continue;
  console.log(`\n▸ ${nome}`);
  console.log(`  ${"período".padEnd(10)} ${"gasto".padStart(13)} ${"leads".padStart(7)} ${"custo/lead".padStart(12)} ${"conversas".padStart(10)}`);
  for (const p of periodos) {
    const l = meses.get(p);
    if (!l || (l.gasto === 0 && l.leads === 0)) continue;
    const cpl = l.leads ? brl(l.gasto / l.leads) : "—";
    console.log(`  ${p.padEnd(10)} ${brl(l.gasto).padStart(13)} ${String(l.leads).padStart(7)} ${cpl.padStart(12)} ${String(l.conversas || "—").padStart(10)}`);
  }
  const cplTotal = total.leads ? brl(total.gasto / total.leads) : "—";
  console.log(`  ${"TOTAL".padEnd(10)} ${brl(total.gasto).padStart(13)} ${String(total.leads).padStart(7)} ${cplTotal.padStart(12)} ${String(total.conversas || "—").padStart(10)}`);
}

const geral = [...porCampanha.values()].flatMap((m) => [...m.values()]);
const gastoTotal = geral.reduce((s, l) => s + l.gasto, 0);
const leadsTotal = geral.reduce((s, l) => s + l.leads, 0);
console.log(`\n${"─".repeat(50)}`);
console.log(`TOTAL GERAL: ${brl(gastoTotal)} · ${leadsTotal} leads · ${leadsTotal ? brl(gastoTotal / leadsTotal) : "—"} por lead`);
console.log(`
💡 Custo por LEAD não é custo por VENDA. Para o CAC real, cruze o gasto acima com as vendas por
   utm_campaign da planilha de aplicação — a [LEADS][PCDF]-[LP] entregava lead a R$ 1,71 e
   converteu 2,0% (zero vendas em julho e agosto).`);
process.exit(0);
