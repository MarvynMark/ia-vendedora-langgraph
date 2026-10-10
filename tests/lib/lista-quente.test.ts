import { describe, test, expect } from "bun:test";
import {
  analisarMensagens, classificarCard, ordenarListaQuente, pesoDoPerfil, type Analise,
} from "../../src/lib/lista-quente.ts";
import type { KanbanTaskResumo } from "../../src/services/chatwoot.ts";

const AGORA = new Date("2026-10-09T15:00:00Z");
const seg = (diasAtras: number) => Math.floor((AGORA.getTime() - diasAtras * 86_400_000) / 1000);

const card = (desc = ""): KanbanTaskResumo => ({
  id: 1, board_step_id: 8, title: "Ana", description: desc, due_date: null, date_status: null,
  conversation_ids: [900], conversations: [],
});

const analise = (p: Partial<Analise> = {}): Analise => ({
  chegouPreco: true, sinalCompra: false, linkEnviado: false, linkEnviadoEm: null,
  ultimaEhIa: true, ultimaEm: seg(1), ultimaLead: "", ultimaLeadEncerra: false, telefone: "", ...p,
});

const classificar = (a: Analise, desc = "", objecaoPrecoEm: Date | null = null) =>
  classificarCard({ card: card(desc), analise: a, perfil: null, objecaoPrecoEm, agora: AGORA });

describe("analisarMensagens", () => {
  test("nota privada não conta como resposta ao lead", () => {
    const a = analisarMensagens([
      { message_type: 1, created_at: 1, content: "Fica 12x de R$ 197" },
      { message_type: 0, created_at: 2, content: "vou ver", sender: { phone_number: "+5561999990000" } },
      { message_type: 1, created_at: 3, content: "🧭 NOTA PRO ATENDENTE", private: true },
    ])!;
    expect(a.ultimaEhIa).toBe(false);
    expect(a.chegouPreco).toBe(true);
    expect(a.telefone).toBe("+5561999990000");
  });
});

describe("classificarCard", () => {
  test("P1: lead falou por último", () => {
    const r = classificar(analise({ ultimaEhIa: false, ultimaLead: "me manda o link" }))!;
    expect(r.prioridade).toBe(1);
    expect(r.motivo).toContain("me manda o link");
  });

  test("P1: link enviado há menos de 48h", () => {
    expect(classificar(analise({ linkEnviado: true, linkEnviadoEm: seg(1) }))!.prioridade).toBe(1);
  });

  test("P2: retorno combinado para hoje", () => {
    expect(classificar(analise(), "📅 - Retomar em: 09/10/2026 (sex) — pagar no salário")!.prioridade).toBe(2);
  });

  test("P3: objeção de preço há exatamente 7 dias", () => {
    const r = classificar(analise({ ultimaEm: seg(2) }), "", new Date(AGORA.getTime() - 7 * 86_400_000));
    expect(r!.prioridade).toBe(3);
  });

  test("P4: ouviu o preço e está entre 4 e 14 dias em silêncio", () => {
    expect(classificar(analise({ ultimaEm: seg(6) }))!.prioridade).toBe(4);
    expect(classificar(analise({ ultimaEm: seg(2) }))).toBeNull();
    expect(classificar(analise({ ultimaEm: seg(20) }))).toBeNull();
    expect(classificar(analise({ ultimaEm: seg(6), chegouPreco: false }))).toBeNull();
  });
});

test("ordena por prioridade e desempata por quem quer entrar já", () => {
  const item = (prioridade: 1 | 4, quandoEntrar: string | null, nome: string) => ({
    prioridade, nome, displayId: 1, motivo: "",
    perfil: { concurso: null, formacao: null, quandoEntrar, dispostoInvestir: null },
  });
  const ordem = ordenarListaQuente([
    item(4, null, "c"), item(4, "Imediatamente", "b"), item(1, null, "a"),
  ]).map((i) => i.nome);
  expect(ordem).toEqual(["a", "b", "c"]);
  expect(pesoDoPerfil({ concurso: null, formacao: null, quandoEntrar: null, dispostoInvestir: "Até R$ 200" })).toBe(1);
});

describe("fala de encerramento não é lead esperando", () => {
  const conv = (ia: string, lead: string, extra: Record<string, unknown> = {}) =>
    analisarMensagens([
      { message_type: 1, created_at: 1, content: ia },
      { message_type: 0, created_at: 2, content: lead, ...extra },
    ])!;

  test("obrigada, emoji e reação encerram", () => {
    expect(conv("Qualquer coisa me chama.", "Obrigada!").ultimaLeadEncerra).toBe(true);
    expect(conv("Combinado.", "👍").ultimaLeadEncerra).toBe(true);
    expect(conv("Combinado.", "❤️", { content_attributes: { is_reaction: true } }).ultimaLeadEncerra).toBe(true);
    expect(classificar(analise({ ultimaEhIa: false, ultimaLeadEncerra: true, ultimaEm: seg(1) }))).toBeNull();
  });

  test("'sim' depois de pergunta NÃO encerra — é o lead que escolheu e ficou sem link", () => {
    expect(conv("Posso gerar o link pra você?", "Sim sim").ultimaLeadEncerra).toBe(false);
  });

  test("pergunta ou pedido do lead não encerra", () => {
    expect(conv("Fica 12x de R$ 197.", "?").ultimaLeadEncerra).toBe(false);
    expect(conv("Fica 12x de R$ 197.", "me manda o link").ultimaLeadEncerra).toBe(false);
  });

  test("lead esperando há mais de 30 dias sai da lista do dia", () => {
    expect(classificar(analise({ ultimaEhIa: false, ultimaEm: seg(40) }))).toBeNull();
  });
});
