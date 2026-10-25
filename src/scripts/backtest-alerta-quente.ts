// Re-executa a barreira do Alertar_gestor (lib/alerta-quente.ts) contra os alertas "⭐ Lead quente"
// que já saíram, com o histórico de cada conversa como estava na hora do alerta. Só leitura.
//
//   bun run src/scripts/backtest-alerta-quente.ts [dias]

import { pool } from "../db/pool.ts";
import { avaliarAlertaQuente } from "../lib/alerta-quente.ts";

const dias = Number(process.argv[2] ?? 14);

const alertas = await pool.query<{ chave: string; telefone: string; motivo: string; criado_em: Date }>(
  `SELECT chave, telefone, motivo, criado_em FROM alertas_gestor_enviados
   WHERE chave LIKE 'alertar-gestor:%' AND criado_em > NOW() - ($1 || ' days')::interval
   ORDER BY criado_em DESC`,
  [dias],
);

let bloqueados = 0;
for (const a of alertas.rows) {
  // O turno do alerta grava a fala do lead e a resposta da IA DEPOIS do agente, então o que estava
  // no histórico na hora é tudo antes de criado_em; a fala do lead é a 1ª human gravada logo após.
  const ia = await pool.query<{ content: string }>(
    `SELECT content FROM n8n_historico_mensagens
     WHERE session_id = $1 AND type = 'ai' AND created_at < $2`,
    [a.telefone, a.criado_em],
  );
  const lead = await pool.query<{ content: string }>(
    `SELECT content FROM n8n_historico_mensagens
     WHERE session_id = $1 AND type = 'human' AND created_at >= $2::timestamptz - interval '5 seconds'
     ORDER BY created_at LIMIT 1`,
    [a.telefone, a.criado_em],
  );
  const ultimaMensagem = lead.rows[0]?.content ?? "";
  const d = avaliarAlertaQuente({
    falasIaAnteriores: ia.rows.map((r) => r.content ?? ""),
    ultimaMensagem,
    motivo: a.motivo,
  });
  if (!d.enviar) bloqueados++;
  const conv = a.chave.split(":")[1] ?? "";
  const fala = ultimaMensagem.replace(/\s+/g, " ").slice(0, 70);
  console.log(`${d.enviar ? "PASSA   " : "BLOQUEIA"}  ${conv.padEnd(6)} ${(d.enviar ? "" : d.razao).padEnd(18)} ${a.motivo.slice(0, 70)}  | lead: "${fala}"`);
}
console.log(`\n${bloqueados}/${alertas.rowCount} bloqueados`);
await pool.end();
