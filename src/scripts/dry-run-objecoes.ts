// DRY-RUN do aviso de objeção: roda o classificador sobre as falas reais dos leads e mostra
// quantos alertas teriam ido para o grupo do comercial, com os trechos exatos que dispararam.
//
// Por que existe: foi o excesso de alerta que fez o grupo interno virar ruído antes (está escrito
// no prompt do Alertar_gestor). Antes de ligar o envio, medimos o volume e LEMOS os casos, um a
// um, atrás de falso positivo. Se o número vier alto, a resposta é apertar os regexes.
//
// Uso:
//   bun run src/scripts/dry-run-objecoes.ts [dias]   # default: 7
import { env } from "../config/env.ts";
import { listarKanbanTasks, listarMensagens } from "../services/chatwoot.ts";
import { classificarObjecao, ROTULO_OBJECAO, type TipoObjecao } from "../lib/objecoes.ts";

const dias = Number(process.argv[2] ?? 7);
const acc = env.CHATWOOT_ACCOUNT_ID;
const board = env.KANBAN_BOARD_ID;
const desde = Math.floor(Date.now() / 1000) - dias * 86400;

// Varre o board (mesma paginação do relatorio-recuperacao). O card traz `conversation_ids` (array),
// não `conversation_id`.
type Card = { id: number; conversation_ids?: number[]; title?: string; updated_at?: string };
const todos: Card[] = [];
const vistos = new Set<number>();
for (let p = 1; p <= 400; p++) {
  const lote = (await listarKanbanTasks(acc, board, 8, p)) as Card[];
  for (const c of lote) {
    if (vistos.has(c.id)) continue;
    vistos.add(c.id);
    todos.push(c);
  }
  if (lote.length < 25) break;
}

// Só quem teve movimento no período — sem isso seriam milhares de conversas lidas à toa.
const limite = desde * 1000;
const cards = todos.filter((c) => c.updated_at && new Date(c.updated_at).getTime() >= limite);
console.log(`${todos.length} cards no board, ${cards.length} com movimento nos últimos ${dias} dias. Lendo...\n`);

interface Achado {
  tipo: TipoObjecao;
  conv: number;
  lead: string;
  fala: string;
  quando: number;
}

const achados: Achado[] = [];
// Espelha a trava de produção: uma vez por TIPO por conversa.
const jaAvisado = new Set<string>();
let convsLidas = 0;
let falasLidas = 0;
let erros = 0;

for (const c of cards) {
  const idConversa = c.conversation_ids?.[0];
  if (!idConversa) continue;
  let msgs: Array<{ message_type: number; created_at: number; content?: string | null }>;
  try {
    const r = (await listarMensagens(acc, idConversa)) as { payload?: typeof msgs };
    msgs = r.payload ?? [];
  } catch {
    erros++;
    continue;
  }
  const recentes = msgs.filter((m) => m.message_type === 0 && m.created_at >= desde);
  if (recentes.length === 0) continue;
  convsLidas++;

  for (const m of recentes) {
    const fala = m.content ?? "";
    if (!fala.trim()) continue;
    falasLidas++;
    const tipo = classificarObjecao(fala);
    if (!tipo) continue;
    const chave = `${idConversa}:${tipo}`;
    if (jaAvisado.has(chave)) continue;
    jaAvisado.add(chave);
    achados.push({
      tipo,
      conv: idConversa,
      lead: c.title ?? "(sem título)",
      fala: fala.replace(/\s+/g, " ").slice(0, 160),
      quando: m.created_at,
    });
  }
}

const porTipo: Record<string, number> = {};
for (const a of achados) porTipo[a.tipo] = (porTipo[a.tipo] ?? 0) + 1;

console.log(`=== DRY-RUN DO AVISO DE OBJEÇÃO — últimos ${dias} dias ===\n`);
console.log(`Conversas com fala do lead no período: ${convsLidas}`);
console.log(`Falas do lead analisadas: ${falasLidas}`);
if (erros) console.log(`Conversas que não puderam ser lidas: ${erros}`);
console.log(`\nAlertas que teriam ido pro grupo: ${achados.length}  (~${(achados.length / dias).toFixed(1)}/dia)\n`);
for (const [tipo, n] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${ROTULO_OBJECAO[tipo as TipoObjecao]}: ${n}`);
}

console.log(`\n=== OS CASOS (leia atrás de falso positivo) ===`);
for (const a of achados.sort((x, y) => x.quando - y.quando)) {
  const dt = new Date(a.quando * 1000).toLocaleString("pt-BR");
  console.log(`\n[${ROTULO_OBJECAO[a.tipo]}] ${a.lead} — ${dt}`);
  console.log(`   "${a.fala}"`);
  console.log(`   ${env.CHATWOOT_BASE_URL}/app/accounts/${acc}/conversations/${a.conv}`);
}

process.exit(0);
