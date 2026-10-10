import { describe, test, expect } from "bun:test";
import {
  estadoDoConcurso, grupoInvestimento, inicioDoDiaSP, resumirFunil, montarMensagemNumeros, montarMensagemAgenda,
} from "../../src/lib/relatorio-comercial.ts";
import type { KanbanTaskResumo } from "../../src/services/chatwoot.ts";

describe("estadoDoConcurso", () => {
  test("lê o texto livre do formulário", () => {
    expect(estadoDoConcurso("PCDF")).toBe("DF");
    expect(estadoDoConcurso("Polícia Civil do Rio de Janeiro")).toBe("RJ");
    expect(estadoDoConcurso("IGP Rio Grande do Sul")).toBe("RS");
    expect(estadoDoConcurso("PCDF e PCERJ")).toBe("Vários");
    expect(estadoDoConcurso("qualquer um que abrir")).toBe("Qualquer um");
    expect(estadoDoConcurso("")).toBe("Não informado");
  });
});

test("grupoInvestimento junta as 3 versões da pergunta", () => {
  expect(grupoInvestimento("Sim, é o que eu quero!")).toBe("Sim");
  expect(grupoInvestimento("SIM, GOSTARIA")).toBe("Sim");
  expect(grupoInvestimento("Infelizmente não no momento!")).toBe("Não");
  expect(grupoInvestimento("AGORA NÃO")).toBe("Não");
  expect(grupoInvestimento("Até R$ 200")).toBe("Até R$ 200");
  expect(grupoInvestimento(null)).toBe("Sem resposta");
});

test("inicioDoDiaSP é meia-noite de São Paulo", () => {
  expect(inicioDoDiaSP(new Date("2026-10-09T02:00:00Z")).toISOString()).toBe("2026-10-08T03:00:00.000Z");
  expect(inicioDoDiaSP(new Date("2026-10-09T15:00:00Z")).toISOString()).toBe("2026-10-09T03:00:00.000Z");
});

const card = (step: number, desc = "", mudou?: string): KanbanTaskResumo => ({
  id: Math.random(), board_step_id: step, title: "x", description: desc, due_date: null, date_status: null,
  step_changed_at: mudou, conversation_ids: [], conversations: [],
});

test("resumirFunil conta etapas, link enviado, follow-up e o que mudou ontem", () => {
  const ini = new Date("2026-10-08T03:00:00Z");
  const fim = new Date("2026-10-09T03:00:00Z");
  const f = resumirFunil([
    card(8, "👤 - Descrição: link enviado"),
    card(8, "🔁 - Follow-ups: 2"),
    card(10, "🔁 - Follow-ups: 3\n✅ - Follow-ups concluídos (3/3) em 08/10/2026, sem resposta"),
    card(9, "", "2026-10-08T20:00:00Z"),
    card(9, "", "2026-10-01T20:00:00Z"),
    card(11, "", "2026-10-08T10:00:00Z"),
  ], ini, fim);
  expect(f.porEtapa.aguardandoPagamento).toBe(2);
  expect(f.linkEnviado).toBe(1);
  expect(f.emFollowup).toBe(1);
  expect(f.ganhosNoPeriodo).toBe(1);
  expect(f.perdidosNoPeriodo).toBe(1);
});

test("mensagem de números traz concurso, cargo e respostas do formulário", () => {
  const ap = (concurso: string, formacao: string, investe: string) => ({
    concurso, formacao, dispostoInvestir: investe, quandoEntrar: "Imediatamente", criadoEm: new Date(),
  });
  const funil = resumirFunil([], new Date(0), new Date(0));
  const texto = montarMensagemNumeros({
    dataRef: new Date("2026-10-08T03:00:00Z"),
    aplicacoes: [ap("PCDF", "Medicina", "Sim"), ap("PCDF", "Biologia", "Até R$ 200"), ap("PCES", "Química", "Não")],
    funil,
  });
  expect(texto).toContain("RELATÓRIO COMERCIAL — 08/10");
  expect(texto).toContain("Aplicações ontem: 3");
  expect(texto).toContain("2 DF · 1 ES");
  expect(texto).toContain("1 médico legista · 2 perito");
  expect(texto).toContain("3 Imediatamente");
});

test("agenda mostra o top com link e marca quem quer entrar já", () => {
  const texto = montarMensagemAgenda([
    { prioridade: 1, nome: "Ana", displayId: 42, motivo: "mandou mensagem e ninguém respondeu",
      perfil: { concurso: "PCDF", formacao: null, quandoEntrar: "Imediatamente", dispostoInvestir: null } },
  ]);
  expect(texto).toContain("AGENDA DO DIA — 1 leads");
  expect(texto).toContain("*Ana* (PCDF) ⭐");
  expect(texto).toContain("/conversations/42");
  expect(montarMensagemAgenda([])).toContain("Ninguém na lista quente hoje");
});
