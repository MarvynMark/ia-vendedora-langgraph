import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import type { FollowUpStateType } from "../../src/graphs/follow-up/state.ts";

// Toques de curiosidade em Conexão / pós-preço (03/10/2026): pergunta da IA, áudio mudo +
// "O que você acha?", comprovante PIX — os três na janela grátis. Sem janela, os de curiosidade
// são pulados e vai o template da posição seguinte.
const HORA = 60 * 60 * 1000;

let msJanela = 0;
const textos: string[] = [];
const templates: string[] = [];
const arquivos: Array<{ nome: string; tipo: string; ptt?: boolean }> = [];
const historico: string[] = [];
const updates: Array<{ description?: string; due_date?: string }> = [];

const chatwootReal = await import("../../src/services/chatwoot.ts");
mock.module("../../src/services/chatwoot.ts", () => ({
  ...chatwootReal,
  enviarTemplate: async (_c: unknown, _i: unknown, nome: string) => { templates.push(nome); },
  enviarMensagem: async (_c: unknown, _i: unknown, texto: string) => { textos.push(texto); },
  enviarArquivo: async (_c: unknown, _i: unknown, _d: unknown, nome: string, tipo: string, o?: { isRecordedAudio?: boolean }) => {
    arquivos.push(o?.isRecordedAudio ? { nome, tipo, ptt: true } : { nome, tipo });
  },
  pausaComDigitando: async () => {},
  verificarLeadRespondeuUltimo: async () => false,
  ultimaMensagemAgente: async () => "",
  msRestantesJanela24h: async () => msJanela,
  atualizarKanbanTask: async (_c: unknown, _t: unknown, dados: { description?: string; due_date?: string }) => { updates.push(dados); },
}));
mock.module("../../src/db/memoria.ts", () => ({
  houveAiRecente: async () => false,
  salvarMensagem: async (_t: string, m: { content: string }) => { historico.push(m.content); },
  buscarHistorico: async () => [],
}));
mock.module("../../src/db/formulario.ts", () => ({
  buscarCamposFormulario: async () => ({ concurso: "PC GO", dificuldade: null }),
  buscarDadosFormulario: async () => "",
}));

const fetchReal = globalThis.fetch;
globalThis.fetch = (async () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;

const { agenteFollowup } = await import("../../src/graphs/follow-up/graph.ts");
const { PERGUNTA_POS_AUDIO, REGISTRO_AUDIO_MUDO, REGISTRO_PIX } = await import("../../src/lib/followup-curiosidade.ts");

function state(contador: number, etapa = "Conexão"): FollowUpStateType {
  return {
    messages: [], accountId: 1, boardId: 1, taskId: 100,
    board_step: { id: 10, name: etapa },
    title: "Ana Clara",
    description: `🔁 - Follow-ups: ${contador}`,
    dueDate: "", telefone: "+5562999999999",
    conversationId: 3896, inboxId: 11, displayId: 3896,
    funilSteps: [{ id: 10, name: "Conexão" }, { id: 12, name: "Nutrir" }],
    idEtapaPerdido: 11, idEtapaNutrir: 12,
    tipoFollowup: "followup", respostaAgente: "",
  } as FollowUpStateType;
}

beforeEach(() => {
  for (const l of [textos, templates, arquivos, historico, updates]) l.length = 0;
  msJanela = 0;
});

describe("Conexão COM janela", () => {
  test("toque 2: áudio mudo e, depois dele, \"O que você acha?\"", async () => {
    msJanela = 15 * HORA;
    await agenteFollowup(state(1));
    expect(arquivos).toEqual([{ nome: "audio.ogg", tipo: "audio/ogg", ptt: true }]);
    expect(textos).toEqual([PERGUNTA_POS_AUDIO]);
    expect(templates).toEqual([]);
    // O histórico diz que o áudio é mudo, pra o agente assumir a brincadeira se o lead perguntar.
    expect(historico).toEqual([REGISTRO_AUDIO_MUDO, PERGUNTA_POS_AUDIO]);
    expect(updates.at(-1)?.description).toContain("Follow-ups: 2");
  });

  test("toque 3: o PDF do comprovante PIX, sem texto", async () => {
    msJanela = 5 * HORA;
    await agenteFollowup(state(2));
    expect(arquivos).toEqual([{ nome: "COMPROVANTE-PIX.pdf", tipo: "application/pdf" }]);
    expect(textos).toEqual([]);
    expect(templates).toEqual([]);
    expect(historico).toEqual([REGISTRO_PIX]);
    expect(updates.at(-1)?.description).toContain("Follow-ups: 3");
  });

  test("pós-preço segue a mesma sequência", async () => {
    msJanela = 15 * HORA;
    await agenteFollowup(state(1, "Aguardando Pagamento"));
    expect(arquivos.map((a) => a.nome)).toEqual(["audio.ogg"]);
  });
});

describe("Conexão SEM janela", () => {
  test("posições de curiosidade são puladas: vai o template da posição seguinte", async () => {
    await agenteFollowup(state(1));
    expect(arquivos).toEqual([]);
    expect(templates).toEqual(["conexao_2"]);
    expect(updates.at(-1)?.description).toContain("Follow-ups: 4");
  });
});

afterAll(() => { globalThis.fetch = fetchReal; });
