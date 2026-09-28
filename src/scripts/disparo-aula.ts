// Disparo do convite da aula ao vivo "Raio-X dos Próximos Concursos de Perito Criminal" (28/09/2026, 20h).
//
//   bun run src/scripts/disparo-aula.ts teste <telefone>          # manda só para um número (sem tocar em conversa)
//   bun run src/scripts/disparo-aula.ts enviar [--limite N] [--enviar]
//
// Lista: a mesma do Dia do Cliente (output/promo-dia-cliente-2026-09-18.json, leads dos últimos 90 dias).
// Cada lead é reconferido na hora: fica fora quem virou aluno (etiqueta `mentoria`), está bloqueado
// ou falou nas últimas 2h (a IA já está conversando com ele).
//
// Template com botão de resposta "Quero participar" (abre a janela de 24h: às 20h quem tocou recebe o
// aviso de que começou) e botão de link para a aula.
//
// Envio direto pela Graph API da Meta: o template tem imagem no cabeçalho, e o Chatwoot ainda não
// sincronizou. A imagem sobe uma vez para a Meta e o media id é reaproveitado em todos os envios.
// Em cada conversa fica uma nota privada e o texto entra na memória da IA — se o lead responder
// "vou assistir", ela sabe do que se trata.

import { env } from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { fetchComTimeout } from "../lib/fetch-with-timeout.ts";
import { buscarConversa, enviarMensagem } from "../services/chatwoot.ts";
import { salvarMensagemSeNova } from "../db/memoria.ts";
import { pool } from "../db/pool.ts";
import { appendFile } from "node:fs/promises";

const ACC = env.CHATWOOT_ACCOUNT_ID;
const TEMPLATE = "aula_raio_x_participar";
const IMAGEM = `${import.meta.dir}/../../output/aula-raio-x.jpg`;
const LISTA = "output/promo-dia-cliente-2026-09-18.json";
const LEDGER = "output/aula-raio-x-enviados.txt";
const LINK_AULA = "https://www.youtube.com/watch?v=gfc8ijeR5WM";

// Texto idêntico ao aprovado na Meta (vai para a nota e para a memória da IA).
const TEXTO = `🚨 *É HOJE!*

Olá, tudo bem?

Hoje, às *20h*, teremos um encontro especial e *AO VIVO* sobre:

🎯 *Raio-X dos Próximos Concursos de Perito Criminal*

Vamos falar sobre os principais concursos que estão no radar, as oportunidades que podem surgir e, principalmente, *como se preparar desde já para não depender do edital para começar a estudar.*

Quer participar? Toca no botão abaixo que eu te aviso quando começar 👇

[botões: Quero participar · Assistir à aula → ${LINK_AULA}]`;

interface Alvo { convId: number; nome: string; telefone: string }

let pcCache: { phone_number_id?: string; api_key?: string } | null = null;
async function credenciais() {
  if (!pcCache) {
    const r = await fetchComTimeout(`${env.CHATWOOT_BASE_URL}/api/v1/accounts/${ACC}/inboxes/${env.CHATWOOT_INBOX_ID}`, { headers: { api_access_token: env.CHATWOOT_API_TOKEN } });
    pcCache = ((await r.json()) as any).provider_config ?? {};
  }
  return pcCache!;
}

let mediaId: string | null = null;
async function subirImagem(): Promise<string> {
  if (mediaId) return mediaId;
  const pc = await credenciais();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "image/jpeg");
  form.append("file", Bun.file(IMAGEM), "aula-raio-x.jpg");
  const r = await fetchComTimeout(`https://graph.facebook.com/v21.0/${pc.phone_number_id}/media`, {
    method: "POST", headers: { Authorization: `Bearer ${pc.api_key}` }, body: form,
  });
  const j = (await r.json()) as any;
  if (!j.id) throw new Error(`upload da imagem falhou: ${JSON.stringify(j).slice(0, 200)}`);
  mediaId = j.id as string;
  return mediaId;
}

async function enviarViaMeta(telefone: string) {
  const pc = await credenciais();
  const r = await fetchComTimeout(`https://graph.facebook.com/v21.0/${pc.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pc.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: telefone, type: "template",
      template: {
        name: TEMPLATE, language: { code: "pt_BR" },
        components: [{ type: "header", parameters: [{ type: "image", image: { id: await subirImagem() } }] }],
      },
    }),
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(`Meta ${r.status}: ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
  return j.messages?.[0]?.id as string | undefined;
}

async function jaEnviados(): Promise<Set<string>> {
  const f = Bun.file(LEDGER);
  return new Set((await f.exists()) ? (await f.text()).split("\n").map((l) => l.trim()).filter(Boolean) : []);
}
async function registrarEnviado(telefone: string) {
  await appendFile(LEDGER, telefone + "\n");
}

async function enviar(limite: number, valendo: boolean) {
  const { alvos } = JSON.parse(await Bun.file(LISTA).text()) as { alvos: Alvo[] };
  const enviados = await jaEnviados();
  const lista = alvos.filter((a) => !enviados.has(a.telefone)).slice(0, limite);
  console.log(`${lista.length} alvos (${enviados.size} já enviados antes) · ${valendo ? "VALENDO" : "dry-run"}\n`);

  let ok = 0, falhas = 0;
  const fora: Record<string, number> = {};
  // 8 envios em paralelo: 1.000 leads em poucos minutos (o usuário ia ficar sem internet).
  let i = 0;
  async function trabalhador() { while (i < lista.length) await processar(lista[i++]!); }
  async function processar(a: Alvo) {
    const rotulo = `${a.nome} (${a.telefone}) conv ${a.convId}`;
    let conv: any;
    try { conv = await buscarConversa(ACC, a.convId); } catch { fora["conversa inacessível"] = (fora["conversa inacessível"] ?? 0) + 1; return; }
    const etiquetas: string[] = conv.labels ?? [];
    const motivo = etiquetas.includes("mentoria") ? "aluno (mentoria)"
      : conv.meta?.sender?.blocked ? "bloqueado"
      : Date.now() - (conv.last_activity_at ?? 0) * 1000 < 2 * 3_600_000 ? "ativo nas últimas 2h"
      : null;
    if (motivo) { fora[motivo] = (fora[motivo] ?? 0) + 1; return; }
    if (!valendo) { console.log(`→ ${rotulo}`); ok++; return; }
    try {
      const id = await enviarViaMeta(a.telefone);
      await registrarEnviado(a.telefone);
      await enviarMensagem(ACC, a.convId, `📣 Convite da aula *${TEMPLATE}* enviado pela API da Meta às ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })} (id ${id ?? "?"}). Texto:\n\n${TEXTO}`, { private: true });
      await salvarMensagemSeNova(`+${a.telefone}`, {
        type: "ai", content: TEXTO, tool_calls: [], invalid_tool_calls: [], response_metadata: {},
        additional_kwargs: { origem: "disparo-aula-raio-x", template: TEMPLATE },
      });
      ok++;
      console.log(`✓ ${rotulo}`);
    } catch (e) {
      falhas++;
      console.log(`✗ ${rotulo}: ${(e as Error).message.slice(0, 160)}`);
      logger.error("disparo-aula", "falha no envio", { telefone: a.telefone, erro: (e as Error).message });
    }
  }
  await subirImagem();
  await Promise.all(Array.from({ length: 8 }, trabalhador));
  console.log(`\n${valendo ? `${ok} enviados, ${falhas} falhas` : `Dry-run: ${ok} receberiam. Use --enviar.`}`);
  console.log("Fora:", JSON.stringify(fora));
}

const [cmd, arg, ...flags] = process.argv.slice(2);
if (cmd === "teste" && arg) {
  console.log(`✓ enviado para ${arg} (id ${await enviarViaMeta(arg.replace(/\D/g, ""))})`);
} else if (cmd === "enviar") {
  const todos = [arg, ...flags].filter(Boolean) as string[];
  const i = todos.indexOf("--limite");
  await enviar(i >= 0 ? Number(todos[i + 1]) : Infinity, todos.includes("--enviar"));
} else console.log("uso: teste <telefone> | enviar [--limite N] [--enviar]");
await pool.end();
