import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { FollowUpStateType } from "../../src/graphs/follow-up/state.ts";

// Cadência da etapa "Primeira mensagem" (03/10/2026, conv 9560): com janela aberta, dois toques
// grátis no primeiro dia (reforço + "Oiii"); sem janela, a régua antiga de template por dia.
const HORA = 60 * 60 * 1000;

let msJanela = 0;
let msDesdeAbertura = Infinity;
const textos: string[] = [];
const templates: string[] = [];
const updates: Array<{ description?: string; due_date?: string }> = [];

const chatwootReal = await import("../../src/services/chatwoot.ts");
mock.module("../../src/services/chatwoot.ts", () => ({
  ...chatwootReal,
  enviarTemplate: async (_c: unknown, _i: unknown, nome: string) => { templates.push(nome); },
  enviarMensagem: async (_c: unknown, _i: unknown, texto: string) => { textos.push(texto); },
  contarMensagensIncoming: async () => 0,
  msRestantesJanela24h: async () => msJanela,
  msDesdePrimeiraSaida: async () => msDesdeAbertura,
  atualizarKanbanTask: async (_c: unknown, _t: unknown, dados: { description?: string; due_date?: string }) => { updates.push(dados); },
}));
mock.module("../../src/db/memoria.ts", () => ({
  salvarMensagem: async () => {},
  buscarHistorico: async () => [],
}));
mock.module("../../src/db/formulario.ts", () => ({
  buscarCamposFormulario: async () => ({ concurso: "PC MA", dificuldade: null }),
  buscarDadosFormulario: async () => "",
}));

const { agenteTemplateAbertura } = await import("../../src/graphs/follow-up/graph.ts");

function state(contador: number): FollowUpStateType {
  return {
    messages: [], accountId: 1, boardId: 1, taskId: 7518,
    board_step: { id: 7, name: "Primeira mensagem" },
    title: "Ana Clara Barros Souza",
    description: `🟣 - Concurso: PC MA\nfollowup-templates: ${contador}`,
    dueDate: "", telefone: "+5591987045416",
    conversationId: 9560, inboxId: 11, displayId: 9560,
    funilSteps: [{ id: 7, name: "Primeira mensagem" }, { id: 10, name: "Conexao" }, { id: 12, name: "Nutrir" }],
    idEtapaPerdido: 11, idEtapaNutrir: 12,
    tipoFollowup: "template_abertura", respostaAgente: "",
  } as FollowUpStateType;
}

beforeEach(() => {
  textos.length = 0; templates.length = 0; updates.length = 0;
  msJanela = 0; msDesdeAbertura = Infinity;
});

describe("Primeira mensagem COM janela (pediu o grupo de espera)", () => {
  test("toque 1: reforço como texto grátis, sem template", async () => {
    msJanela = 20 * HORA;
    await agenteTemplateAbertura(state(0));
    expect(templates).toEqual([]);
    expect(textos[0]).toContain("Me dá um oi rapidinho");
    expect(updates.at(-1)?.description).toContain("followup-templates: 1");
  });

  test("toque 2: o \"Oiii\" curto, ainda grátis, agendado antes de a janela fechar", async () => {
    msJanela = 6 * HORA;
    await agenteTemplateAbertura(state(1));
    expect(templates).toEqual([]);
    expect(textos).toHaveLength(1);
    expect(textos[0]!.length).toBeLessThan(60);
    expect(updates.at(-1)?.description).toContain("followup-templates: 2");
  });
});

describe("Primeira mensagem SEM janela (lead só de formulário)", () => {
  test("antes de 24h da abertura: não envia nada, só adia", async () => {
    msDesdeAbertura = 3 * HORA;
    await agenteTemplateAbertura(state(0));
    expect(templates).toEqual([]);
    expect(textos).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.description).toBeUndefined();
  });

  test("depois de 24h: reforço por template, como antes", async () => {
    msDesdeAbertura = 25 * HORA;
    await agenteTemplateAbertura(state(0));
    expect(templates).toEqual(["fup1_reforco"]);
  });

  test("posição do \"Oiii\" sem janela: pula direto pra urgência (nenhum template a mais)", async () => {
    await agenteTemplateAbertura(state(1));
    expect(templates).toEqual(["fup3_urgencia"]);
    expect(textos).toEqual([]);
    expect(updates.at(-1)?.description).toContain("followup-templates: 3");
  });

  test("depois da urgência: encerramento", async () => {
    await agenteTemplateAbertura(state(3));
    expect(templates).toEqual(["encerramento"]);
  });
});
