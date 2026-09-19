// Disparo da promoção do Dia do Cliente (18/09/2026) — segmenta a base do Kanban em ondas e
// manda o template certo para cada uma.
//
//   bun run src/scripts/disparo-promocao.ts segmentar            # lê o Kanban, gera output/promo-<data>.json + resumo
//   bun run src/scripts/disparo-promocao.ts enviar <onda> [--limite N] [--enviar]
//   bun run src/scripts/disparo-promocao.ts followup [--minutos 90] [--enviar]
//       → quem viu a tabela há mais de N minutos e não respondeu recebe o toque da garantia
//         (texto livre: está dentro da janela de 24h porque acabou de responder ao disparo)
//
// Ondas (decisão do Gusthavo, 18/09):
//   quente  → ouviu o preço (link enviado / em negociação / proposta_apresentada), "sem dinheiro",
//             Aguardando Pagamento, Sessão agendada          → template dia_cliente_quente_v2
//   morno   → qualificando, Conexão, Primeira mensagem       → template dia_cliente_abertura_v2
//   frio    → "inicio" em Nutrir/Perdido com ≤ 90 dias        → template dia_cliente_abertura_v2
// Fora: Ganho, etiqueta `mentoria` (aluno), etiqueta `medico` (disparo próprio), >90 dias parado,
// conversa ativa nas últimas 2h (a IA já está falando com ele).
//
// Envio: pelo Chatwoot se o template já sincronizou (aparece na conversa como saída normal);
// senão direto pela Graph API da Meta, com nota privada na conversa. Nos dois casos o texto
// entra na memória da IA (salvarMensagemSeNova) — é assim que ela sabe do que o lead está
// falando quando responde "eu quero". E `agente-on` é religado em quem estava sem, senão a
// resposta cai no vazio.

import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { listarKanbanTasks, buscarConversa, adicionarEtiquetas, enviarTemplate, enviarMensagem } from "../services/chatwoot.ts";
import { salvarMensagemSeNova } from "../db/memoria.ts";
import { CONTEUDO_TEMPLATES } from "../lib/templates.ts";
import { pool } from "../db/pool.ts";

const ACC = env.CHATWOOT_ACCOUNT_ID;
const BOARD = env.KANBAN_BOARD_ID;
const STEP = { NOVO: 1, PRIMEIRA: 7, CONEXAO: 10, SESSAO: 89, AG_PAGTO: 8, GANHO: 9, PERDIDO: 11, NUTRIR: 12 } as const;
const TEMPLATE: Record<Onda, string> = { quente: "dia_cliente_quente_v2", morno: "dia_cliente_abertura_v2", frio: "dia_cliente_abertura_v2" };
const DIAS_MAX = 90;
const ARQUIVO = `output/promo-dia-cliente-2026-09-18.json`;

type Onda = "quente" | "morno" | "frio";
interface Alvo {
  onda: Onda;
  cardId: number;
  convId: number;
  contatoId: number;
  nome: string;
  telefone: string;
  etapa: number;
  marcador: string;
  diasParado: number;
  agenteOn: boolean;
  etiquetas: string[];
}

const dias = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 9999);

function ondaDe(etapa: number, marcador: string): Onda | null {
  const m = marcador.toLowerCase();
  if (etapa === STEP.AG_PAGTO || etapa === STEP.SESSAO) return "quente";
  if (/link enviado|em negocia|proposta_apresentada|sem dinheiro/.test(m)) return "quente";
  if (etapa === STEP.CONEXAO || etapa === STEP.PRIMEIRA || /qualificando|engajado/.test(m)) return "morno";
  if (etapa === STEP.NUTRIR || etapa === STEP.PERDIDO) return "frio";
  return null;
}

async function segmentar() {
  const cards: any[] = []; const vistos = new Set<number>();
  for (const step of Object.values(STEP)) {
    if (step === STEP.GANHO || step === STEP.NOVO) continue;
    for (let p = 1; p <= 400; p++) {
      const t = (await listarKanbanTasks(ACC, BOARD, step, p)) as any[];
      for (const c of t) if (!vistos.has(c.id)) { vistos.add(c.id); cards.push(c); }
      if (t.length < 25) break;
    }
  }
  console.log(`${cards.length} cards fora de Ganho/Novo Lead. Lendo conversas...`);

  const alvos: Alvo[] = [];
  const fora: Record<string, number> = {};
  const pular = (motivo: string) => { fora[motivo] = (fora[motivo] ?? 0) + 1; };
  const fila = cards.filter((c) => c.conversation_ids?.[0]);
  fora["sem conversa"] = cards.length - fila.length;

  let i = 0;
  async function trabalhador() {
    while (i < fila.length) {
      const c = fila[i++]!;
      const etapa = c.board_step_id as number;
      const parado = dias(c.step_changed_at ?? c.created_at);
      if (parado > DIAS_MAX) { pular(">90 dias"); continue; }
      const marcador = (c.description ?? "").match(/Descrição:\s*([^\n]+)/)?.[1]?.trim() ?? "";
      const onda = ondaDe(etapa, marcador);
      if (!onda) { pular("sem onda"); continue; }
      let conv: any;
      try { conv = await buscarConversa(ACC, c.conversation_ids[0]); } catch { pular("conversa inacessível"); continue; }
      const etiquetas: string[] = conv.labels ?? [];
      if (etiquetas.includes("mentoria")) { pular("aluno (mentoria)"); continue; }
      if (etiquetas.includes("medico")) { pular("médico"); continue; }
      const contato = conv.meta?.sender ?? {};
      if (contato.blocked) { pular("bloqueado"); continue; }
      const telefone = String(contato.phone_number ?? "").replace(/\D/g, "");
      if (!telefone) { pular("sem telefone"); continue; }
      const ultimaAtividade = (conv.last_activity_at ?? 0) * 1000;
      if (Date.now() - ultimaAtividade < 2 * 3_600_000) { pular("ativo nas últimas 2h"); continue; }
      alvos.push({
        onda, cardId: c.id, convId: conv.id, contatoId: contato.id, nome: contato.name ?? c.title ?? "",
        telefone, etapa, marcador, diasParado: parado, agenteOn: etiquetas.includes("agente-on"), etiquetas,
      });
    }
  }
  await Promise.all(Array.from({ length: 6 }, trabalhador));

  // Um telefone só recebe uma vez, na onda mais quente em que aparecer.
  const ordem: Onda[] = ["quente", "morno", "frio"];
  const porTel = new Map<string, Alvo>();
  for (const a of alvos) {
    const atual = porTel.get(a.telefone);
    if (!atual || ordem.indexOf(a.onda) < ordem.indexOf(atual.onda)) porTel.set(a.telefone, a);
  }
  fora["duplicado (mesmo telefone)"] = alvos.length - porTel.size;
  const finais = [...porTel.values()];

  await Bun.write(ARQUIVO, JSON.stringify({ geradoEm: new Date().toISOString(), alvos: finais, fora }, null, 1));
  const conta = (f: (a: Alvo) => boolean) => finais.filter(f).length;
  console.log(`\nAlvos: ${finais.length}`);
  for (const o of ordem) console.log(`  ${o.padEnd(7)} ${String(conta((a) => a.onda === o)).padStart(4)}   (sem agente-on: ${conta((a) => a.onda === o && !a.agenteOn)})`);
  console.log("\nFora do disparo:");
  for (const [k, v] of Object.entries(fora).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log(`\nLista salva em ${ARQUIVO}`);
}

// Registro de quem já recebeu (um telefone por linha). Sobrevive a parada/reinício do script:
// na primeira rodada, parar para acelerar sem isto significaria mandar duas vezes para 15 leads.
const LEDGER = "output/promo-enviados.txt";
async function jaEnviados(): Promise<Set<string>> {
  const f = Bun.file(LEDGER);
  return new Set((await f.exists()) ? (await f.text()).split("\n").map((l) => l.trim()).filter(Boolean) : []);
}
async function registrarEnviado(telefone: string) {
  const f = Bun.file(LEDGER);
  await Bun.write(LEDGER, ((await f.exists()) ? await f.text() : "") + telefone + "\n");
}

let inboxCache: any = null;
async function inboxComercial() {
  if (!inboxCache) inboxCache = await (await fetchComTimeout(`${env.CHATWOOT_BASE_URL}/api/v1/accounts/${ACC}/inboxes/${env.CHATWOOT_INBOX_ID}`, { headers: { api_access_token: env.CHATWOOT_API_TOKEN } })).json();
  return inboxCache;
}

async function enviarViaMeta(telefone: string, template: string) {
  const pc = (await inboxComercial()).provider_config ?? {};
  const r = await fetchComTimeout(`https://graph.facebook.com/v21.0/${pc.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pc.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: telefone, type: "template", template: { name: template, language: { code: "pt_BR" } } }),
  });
  const j = await r.json() as any;
  if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.messages?.[0]?.id as string | undefined;
}

async function templateSincronizado(nome: string): Promise<boolean> {
  const inbox = await inboxComercial();
  return (inbox.message_templates ?? []).some((t: any) => t.name === nome && String(t.status).toLowerCase() === "approved");
}

async function enviar(onda: Onda, limite: number, valendo: boolean) {
  const { alvos } = JSON.parse(await Bun.file(ARQUIVO).text()) as { alvos: Alvo[] };
  const enviados = await jaEnviados();
  const lista = alvos.filter((a) => a.onda === onda && !enviados.has(a.telefone)).slice(0, limite);
  if (enviados.size) console.log(`(${enviados.size} já enviados antes, pulados)`);
  const template = TEMPLATE[onda];
  const texto = CONTEUDO_TEMPLATES[template];
  if (!texto) throw new Error(`template ${template} não está em CONTEUDO_TEMPLATES`);
  const viaChatwoot = await templateSincronizado(template);
  console.log(`Onda ${onda}: ${lista.length} alvos · template ${template} · envio ${viaChatwoot ? "pelo Chatwoot" : "direto pela Meta (Chatwoot não sincronizou)"} · ${valendo ? "VALENDO" : "dry-run"}\n`);

  let ok = 0, falhas = 0;
  for (const a of lista) {
    const rotulo = `${a.nome} (${a.telefone}) conv ${a.convId}${a.agenteOn ? "" : " [religa agente-on]"}`;
    if (!valendo) { console.log(`→ ${rotulo}`); continue; }
    try {
      if (!a.agenteOn) await adicionarEtiquetas(ACC, a.convId, ["agente-on"]);
      if (viaChatwoot) {
        await enviarTemplate(ACC, a.convId, template, texto);
      } else {
        const id = await enviarViaMeta(a.telefone, template);
        await enviarMensagem(ACC, a.convId, `📣 Template *${template}* enviado direto pela API da Meta às ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })} (id ${id ?? "?"}). Texto:\n\n${texto}`, { private: true });
      }
      await salvarMensagemSeNova(`+${a.telefone}`, {
        type: "ai", content: texto, tool_calls: [], invalid_tool_calls: [], response_metadata: {},
        additional_kwargs: { origem: "promo-dia-cliente", template },
      });
      await registrarEnviado(a.telefone);
      ok++;
      console.log(`✓ ${rotulo}`);
    } catch (e) {
      falhas++;
      console.log(`✗ ${rotulo}: ${(e as Error).message.slice(0, 160)}`);
      logger.error("disparo-promocao", "falha no envio", { telefone: a.telefone, erro: (e as Error).message });
    }
    await Bun.sleep(1000);
  }
  console.log(`\n${valendo ? `${ok} enviados, ${falhas} falhas` : "Dry-run: nada enviado. Use --enviar."}`);
}

// Follow-up de garantia — pedido do Gusthavo (18/09, 12:45): quem viu a tabela e sumiu recebe o
// "risco zero". Texto livre, sem template: o lead respondeu ao disparo há pouco, a janela está
// aberta. Sai como fala da IA (memória gravada), então se ele responder a conversa continua.
const FOLLOWUP_GARANTIA =
  "Só pra você decidir com tranquilidade: a mentoria tem garantia de 7 dias, risco zero. " +
  "Você entra hoje com o valor do dia do cliente, usa a plataforma, participa dos encontros, e se não fizer sentido pra você é só me avisar dentro dos 7 dias que eu devolvo seu dinheiro. " +
  "O que não volta é o preço de hoje. Quer que eu te reserve qual dos planos?";

async function followup(minutos: number, valendo: boolean) {
  const { alvos } = JSON.parse(await Bun.file(ARQUIVO).text()) as { alvos: Alvo[] };
  const convPorSessao = new Map(alvos.map((a) => [`+${a.telefone}`, a]));
  // Sessões em que a tabela foi enviada hoje, a última fala é da IA (lead não respondeu depois)
  // há mais de N minutos, e o follow-up ainda não saiu.
  const { rows } = await pool.query<{ session_id: string; ultima_ia: string }>(
    `WITH tabela AS (
       SELECT session_id, MIN(created_at) AS enviada_em
       FROM n8n_historico_mensagens
       WHERE additional_kwargs->>'origem' = 'tool:mostrar-condicao-promocao' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
       GROUP BY session_id
     ),
     ultima AS (
       SELECT DISTINCT ON (session_id) session_id, type, created_at
       FROM n8n_historico_mensagens WHERE session_id IN (SELECT session_id FROM tabela)
       ORDER BY session_id, created_at DESC
     )
     SELECT u.session_id, u.created_at AS ultima_ia
     FROM ultima u JOIN tabela t USING (session_id)
     WHERE u.type = 'ai'
       AND u.created_at < NOW() - ($1 || ' minutes')::interval
       AND NOT EXISTS (
         SELECT 1 FROM n8n_historico_mensagens f
         WHERE f.session_id = u.session_id
           AND (f.additional_kwargs->>'origem' = 'promo-followup-garantia' OR f.content LIKE $2)
       )`,
    // Pelo TEXTO também: quando sai pelo Chatwoot, o webhook grava a mensagem primeiro (como
    // saida_externa) e a gravação do script é descartada como duplicata — só a marca não bastava
    // (4 leads receberam duas vezes em 18/09).
    [minutos, FOLLOWUP_GARANTIA.slice(0, 60) + "%"],
  );
  console.log(`Follow-up de garantia: ${rows.length} lead(s) viram a tabela e não responderam há ${minutos}+ min · ${valendo ? "VALENDO" : "dry-run"}\n`);
  let ok = 0;
  for (const r of rows) {
    const a = convPorSessao.get(r.session_id);
    if (!a) { console.log(`· ${r.session_id}: não está na lista do disparo (teste?), pulando`); continue; }
    // Só manda se a IA ainda está ligada: quem topou foi pausado e está com o comercial.
    let ligado = true;
    try { const conv = (await buscarConversa(ACC, a.convId)) as { labels?: string[] }; ligado = (conv.labels ?? []).includes("agente-on"); } catch { ligado = false; }
    if (!ligado) { console.log(`· ${a.nome}: IA pausada (comercial assumiu), pulando`); continue; }
    if (!valendo) { console.log(`→ ${a.nome} (${a.telefone}) conv ${a.convId}`); continue; }
    try {
      await enviarMensagem(ACC, a.convId, FOLLOWUP_GARANTIA);
      await salvarMensagemSeNova(r.session_id, {
        type: "ai", content: FOLLOWUP_GARANTIA, tool_calls: [], invalid_tool_calls: [], response_metadata: {},
        additional_kwargs: { origem: "promo-followup-garantia" },
      });
      ok++; console.log(`✓ ${a.nome} (${a.telefone}) conv ${a.convId}`);
    } catch (e) { console.log(`✗ ${a.nome}: ${(e as Error).message.slice(0, 120)}`); }
    await Bun.sleep(2000);
  }
  console.log(`\n${valendo ? `${ok} follow-up(s) enviado(s)` : "Dry-run: nada enviado. Use --enviar."}`);
}

const [cmd, arg, ...flags] = process.argv.slice(2);
if (cmd === "segmentar") await segmentar();
else if (cmd === "enviar" && (arg === "quente" || arg === "morno" || arg === "frio")) {
  const i = flags.indexOf("--limite");
  await enviar(arg, i >= 0 ? Number(flags[i + 1]) : Infinity, flags.includes("--enviar"));
} else if (cmd === "followup") {
  const todos = [arg, ...flags].filter(Boolean) as string[];
  const i = todos.indexOf("--minutos");
  await followup(i >= 0 ? Number(todos[i + 1]) : 90, todos.includes("--enviar"));
} else console.log("uso: segmentar | enviar <quente|morno|frio> [--limite N] [--enviar] | followup [--minutos N] [--enviar]");
await pool.end();
