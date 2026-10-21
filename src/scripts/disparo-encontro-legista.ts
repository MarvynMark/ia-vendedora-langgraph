// Disparo do convite do encontro ao vivo "Próximos concursos de Médico Legista e tira-dúvidas"
// (21/10/2026, 21h30, YouTube) para os médicos e estudantes de medicina que aplicaram desde 01/06.
//
//   bun run src/scripts/disparo-encontro-legista.ts montar                     # monta a lista (banco × Chatwoot)
//   bun run src/scripts/disparo-encontro-legista.ts teste <idConversa>         # manda o template para uma conversa
//   bun run src/scripts/disparo-encontro-legista.ts enviar [--limite N] [--enviar]
//   bun run src/scripts/disparo-encontro-legista.ts verificar                  # status de entrega na Meta
//
// Template `encontro_legista_2110` (UTILITY, imagem + botões Confirmar / Parar mensagens). Quem toca
// "Confirmar" recebe o link pelo webhook (respostaConfirmacaoEvento em routes/webhook-filtros.ts).
// A imagem do cabeçalho é o anexo da nota privada 732607 da conv 3896 — o blob do Chatwoot não expira.
// Na hora do envio fica fora quem virou aluno (etiqueta `mentoria`), está bloqueado ou falou nas
// últimas 2h (a IA já está conversando com ele).

import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { buscarConversa, buscarConversasDoContato, criarConversa, listarMensagens } from "../services/chatwoot.ts";
import { salvarMensagemSeNova } from "../db/memoria.ts";
import { pool } from "../db/pool.ts";
import { appendFile } from "node:fs/promises";

const ACC = env.CHATWOOT_ACCOUNT_ID;
const INBOX = Number(env.CHATWOOT_INBOX_ID);
const LISTA = "output/disparo-encontro-legista-2110.json";
const LEDGER = "output/disparo-encontro-legista-enviados.tsv";

const TEMPLATE = "encontro_legista_2110";
const TEXTO = "AVISO IMPORTANTE\n\nSeu pedido de acesso o evento online, foi recebido com sucesso.\n\nToque em confirmar 👇🏻";
const IMAGEM = "https://chat.stkd.site/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBM2ZEQVE9PSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--ad5d1dacae75fb6192f34e33af59527796badde0/encontro-legista-2110.jpg";
// O que a IA passa a saber quando o lead voltar a falar: o botão em si é respondido pelo webhook.
const MEMORIA = "[convite enviado] Convite do encontro ao vivo \"Próximos concursos de Médico Legista e tira-dúvidas\", " +
  "quarta 21/10 às 21h30 no YouTube, com o Walker e a médica legista Natália Basan. " +
  "Link da live: https://www.youtube.com/watch?v=yyRL-WCCrG0";

interface Alvo {
  nome: string; whatsapp: string; formacao: string; aplicou: string;
  contato: number | null; telefoneContato: string | null; conv: number | null;
}

// Celular brasileiro aparece com e sem o 9: compara DDD + últimos 8 dígitos.
const chave = (tel: string) => { const d = tel.replace(/\D/g, "").replace(/^55/, ""); return d.slice(0, 2) + d.slice(-8); };

// A busca de contatos do Chatwoot devolve 429 em rajada; sem retentativa, metade da lista
// aparecia como "sem contato".
async function acharContato(tel: string): Promise<{ id: number; phone_number: string } | null> {
  let res: Response | null = null;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    res = await fetchComTimeout(
      `${env.CHATWOOT_BASE_URL}/api/v1/accounts/${ACC}/contacts/search?q=${tel.slice(-8)}`,
      { headers: { api_access_token: env.CHATWOOT_API_TOKEN } },
    );
    if (res.ok) break;
    await Bun.sleep(2000 * (tentativa + 1));
  }
  if (!res?.ok) throw new Error(`Chatwoot ${res?.status}`);
  const lista = ((await res.json()) as { payload: Array<{ id: number; phone_number?: string }> }).payload ?? [];
  const c = lista.find((x) => x.phone_number && chave(x.phone_number) === chave(tel));
  return c ? { id: c.id, phone_number: c.phone_number! } : null;
}

async function montar() {
  const { rows } = await pool.query<{ nome: string; tel: string; formacao: string; aplicou: Date }>(`
    SELECT DISTINCT ON (tel) nome_completo AS nome, regexp_replace(whatsapp, '\\D', '', 'g') AS tel,
           area_graduacao AS formacao, criado_em AS aplicou
    FROM leads_formulario_mentoria
    WHERE criado_em >= '2026-06-01'
      AND area_graduacao ~* 'm[eé]dic|medicina|mediciba|medicona' AND area_graduacao !~* 'veter|biom'
    ORDER BY tel, criado_em DESC`);
  const alvos: Alvo[] = [];
  let i = 0;
  async function trabalhador() {
    while (i < rows.length) {
      const r = rows[i++]!;
      const whatsapp = r.tel.startsWith("55") ? r.tel : `55${r.tel}`;
      const c = await acharContato(whatsapp).catch((e) => { console.log(`! ${whatsapp}: ${(e as Error).message}`); return null; });
      const convs = c ? await buscarConversasDoContato(ACC, c.id).catch(() => []) : [];
      const conv = convs.filter((v) => v.inbox_id === INBOX).sort((a, b) => b.id - a.id)[0];
      alvos.push({
        nome: r.nome, whatsapp, formacao: r.formacao, aplicou: r.aplicou.toISOString(),
        contato: c?.id ?? null, telefoneContato: c?.phone_number ?? null, conv: conv?.id ?? null,
      });
    }
  }
  await Promise.all(Array.from({ length: 2 }, trabalhador));
  // O mesmo celular vem com e sem o 55 em aplicações diferentes: fica um por número.
  const unicos = [...new Map(alvos.map((a) => [a.whatsapp, a])).values()];
  await Bun.write(LISTA, JSON.stringify({ gerado: new Date().toISOString(), criterio: "leads_formulario_mentoria desde 01/06/2026, formação médica", alvos: unicos }, null, 1));
  console.log(`${unicos.length} alvos · ${unicos.filter((a) => a.conv).length} com conversa na inbox · ${unicos.filter((a) => a.contato && !a.conv).length} só com contato · ${unicos.filter((a) => !a.contato).length} sem contato`);
}

async function enviarConvite(convId: number) {
  const res = await fetchComTimeout(`${env.CHATWOOT_BASE_URL}/api/v1/accounts/${ACC}/conversations/${convId}/messages`, {
    method: "POST",
    headers: { api_access_token: env.CHATWOOT_API_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({
      message_type: "outgoing", content_type: "text", content: TEXTO,
      template_params: {
        name: TEMPLATE, category: "UTILITY", language: "pt_BR",
        processed_params: { body: {}, header: { media_url: IMAGEM, media_type: "image" } },
      },
    }),
  });
  if (!res.ok) throw new Error(`Chatwoot ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { id: number }).id;
}

async function jaEnviados(): Promise<Map<string, string>> {
  const f = Bun.file(LEDGER);
  const linhas = (await f.exists()) ? (await f.text()).split("\n").filter(Boolean) : [];
  return new Map(linhas.map((l) => { const [tel, ...resto] = l.split("\t"); return [tel!, resto.join("\t")]; }));
}

async function enviar(limite: number, valendo: boolean) {
  const { alvos } = JSON.parse(await Bun.file(LISTA).text()) as { alvos: Alvo[] };
  const enviados = await jaEnviados();
  const lista = alvos.filter((a) => !enviados.has(a.whatsapp)).slice(0, limite);
  console.log(`${lista.length} alvos (${enviados.size} já enviados antes) · ${valendo ? "VALENDO" : "dry-run"}\n`);

  let ok = 0, falhas = 0;
  const fora: Record<string, number> = {};
  const contar = (m: string) => { fora[m] = (fora[m] ?? 0) + 1; };
  let i = 0;
  async function trabalhador() { while (i < lista.length) await processar(lista[i++]!); }
  async function processar(a: Alvo) {
    let convId = a.conv;
    const rotulo = () => `${a.nome} (${a.whatsapp}) conv ${convId ?? "nova"}`;
    if (convId) {
      let conv: any;
      try { conv = await buscarConversa(ACC, convId); } catch { contar("conversa inacessível"); return; }
      const motivo = (conv.labels ?? []).includes("mentoria") ? "aluno (mentoria)"
        : conv.meta?.sender?.blocked ? "bloqueado"
        : Date.now() - (conv.last_activity_at ?? 0) * 1000 < 2 * 3_600_000 ? "ativo nas últimas 2h"
        : null;
      if (motivo) { contar(motivo); console.log(`- ${rotulo()}: ${motivo}`); return; }
    } else if (!a.contato) { contar("sem contato no Chatwoot"); console.log(`- ${rotulo()}: sem contato`); return; }
    if (!valendo) { console.log(`→ ${rotulo()}`); ok++; return; }
    try {
      // Sem conversa na inbox da API: abre uma. O Chatwoot pode recusar o vínculo de quem nunca
      // falou com esse número — aí o lead fica de fora e aparece como falha.
      if (!convId) convId = (await criarConversa(ACC, { inbox_id: INBOX, contact_id: a.contato! })).id;
      const msgId = await enviarConvite(convId);
      await appendFile(LEDGER, `${a.whatsapp}\t${convId}\t${msgId}\t${TEMPLATE}\n`);
      await salvarMensagemSeNova(a.telefoneContato ?? `+${a.whatsapp}`, {
        type: "ai", content: MEMORIA, tool_calls: [], invalid_tool_calls: [], response_metadata: {},
        additional_kwargs: { origem: "disparo-encontro-legista", template: TEMPLATE },
      });
      ok++;
      console.log(`✓ ${rotulo()}`);
    } catch (e) {
      falhas++;
      console.log(`✗ ${rotulo()}: ${(e as Error).message.slice(0, 160)}`);
      logger.error("disparo-encontro-legista", "falha no envio", { telefone: a.whatsapp, erro: (e as Error).message });
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador));
  console.log(`\n${valendo ? `${ok} enviados, ${falhas} falhas` : `Dry-run: ${ok} receberiam. Use --enviar.`}`);
  console.log("Fora:", JSON.stringify(fora));
}

// Lê o status que a Meta devolveu para cada mensagem do ledger (sent/delivered/read/failed).
async function verificar() {
  const enviados = await jaEnviados();
  const status: Record<string, number> = {};
  for (const [tel, resto] of enviados) {
    const [convId, msgId] = resto.split("\t");
    const msgs = ((await listarMensagens(ACC, convId!)) as any).payload ?? [];
    const m = msgs.find((x: any) => String(x.id) === msgId);
    const s = m?.status ?? "não encontrada";
    status[s] = (status[s] ?? 0) + 1;
    if (s === "failed") console.log(`✗ ${tel} conv ${convId}: ${m?.content_attributes?.external_error ?? "?"}`);
  }
  console.log(JSON.stringify(status));
}

const [cmd, arg, ...flags] = process.argv.slice(2);
if (cmd === "montar") {
  await montar();
} else if (cmd === "teste" && arg) {
  console.log(`✓ ${TEMPLATE} → conv ${arg} (msg ${await enviarConvite(Number(arg))})`);
} else if (cmd === "enviar") {
  const todos = [arg, ...flags].filter(Boolean) as string[];
  const i = todos.indexOf("--limite");
  await enviar(i >= 0 ? Number(todos[i + 1]) : Infinity, todos.includes("--enviar"));
} else if (cmd === "verificar") {
  await verificar();
} else console.log("uso: montar | teste <idConversa> | enviar [--limite N] [--enviar] | verificar");
await pool.end();
