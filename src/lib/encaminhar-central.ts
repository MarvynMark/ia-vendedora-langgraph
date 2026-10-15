// Encaminha os webhooks de pagamento (Guru e TMB) para a Central Vestigium, que guarda as
// vendas para o painel comercial e financeiro. Fire-and-forget: falha aqui nunca afeta o
// fluxo do bot. Sem CENTRAL_INGEST_URL configurado, não faz nada.
//
// O CPF (e o api_token que a Guru inclui no corpo) é removido antes do envio.

import { env } from "../config/env.ts";
import { logger } from "./logger.ts";

// CPF e o token que a Guru manda no próprio corpo do webhook.
const CAMPOS_CPF = new Set(["doc", "documento", "cpf", "doc_contato", "api_token", "token"]);

/** Cópia profunda do corpo sem nenhum campo de CPF, em qualquer nível. */
export function semCpf(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semCpf);
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (!CAMPOS_CPF.has(k.toLowerCase())) saida[k] = semCpf(v);
    }
    return saida;
  }
  return valor;
}

export function encaminharPagamentoParaCentral(plataforma: "guru" | "tmb", body: unknown): void {
  if (!env.CENTRAL_INGEST_URL) return;
  const url = `${env.CENTRAL_INGEST_URL.replace(/\/$/, "")}/api/ingest/pagamento/${plataforma}`;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-central-chave": env.CENTRAL_INGEST_CHAVE },
    body: JSON.stringify(semCpf(body)),
    signal: AbortSignal.timeout(8_000),
  })
    .then(r => { if (!r.ok) logger.warn("central", `Central respondeu ${r.status} ao pagamento ${plataforma}`); })
    .catch(e => logger.warn("central", `Falha ao encaminhar pagamento ${plataforma} para a Central`, { erro: String(e) }));
}

/** Formulário de matrícula (DIM) para a Central, sem as perguntas de CPF. Mesmo esquema
 *  fire-and-forget dos pagamentos: falha aqui não afeta o roteiro nem a planilha. */
export function encaminharFormularioParaCentral(opts: {
  respostas: Array<{ pergunta: string; resposta: string }>;
  concurso: string | null;
  recebidoEm: Date;
}): void {
  if (!env.CENTRAL_INGEST_URL || opts.respostas.length === 0) return;
  const url = `${env.CENTRAL_INGEST_URL.replace(/\/$/, "")}/api/ingest/formulario-matricula`;
  const respostas = opts.respostas.filter(r => !/\bcpf\b/i.test(r.pergunta));
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-central-chave": env.CENTRAL_INGEST_CHAVE },
    body: JSON.stringify({ linhas: [{ respondido_em: opts.recebidoEm.toISOString(), origem: "Respondi (DIM)", concurso_ia: opts.concurso, respostas }] }),
    signal: AbortSignal.timeout(8_000),
  })
    .then(r => { if (!r.ok) logger.warn("central", `Central respondeu ${r.status} ao formulário de matrícula`); })
    .catch(e => logger.warn("central", "Falha ao encaminhar o formulário de matrícula para a Central", { erro: String(e) }));
}
