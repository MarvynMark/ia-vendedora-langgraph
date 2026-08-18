import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { FollowUpStateType } from "../../src/graphs/follow-up/state.ts";

// Captura de chamadas dos módulos de rede/DB — o wrapper enviarTemplateComHistorico deve
// SEMPRE enviar o template E persistir no histórico (o bug do diagnóstico era templates Meta
// nunca salvos, deixando metade da cadência invisível para análise e para o próprio agente).
const enviarTemplateCalls: unknown[][] = [];
const salvarCalls: Array<{ telefone: string; content: string }> = [];

// graph.ts importa vários named exports de chatwoot.ts; stubamos todos (só enviarTemplate é usado aqui).
mock.module("../../src/services/chatwoot.ts", () => ({
  enviarTemplate: async (...args: unknown[]) => { enviarTemplateCalls.push(args); },
  buscarKanbanBoard: async () => ({}),
  enviarMensagem: async () => {},
  contarMensagensIncoming: async () => 0,
  verificarJanela24h: async () => false,
  msRestantesJanela24h: async () => 0,
  verificarLeadRespondeuUltimo: async () => false,
  ultimaMensagemAgente: async () => "",
  atualizarKanbanTask: async () => {},
}));
mock.module("../../src/db/memoria.ts", () => ({
  salvarMensagem: async (telefone: string, msg: { content: string }) => {
    salvarCalls.push({ telefone, content: msg.content });
  },
  buscarHistorico: async () => [],
}));

const { enviarTemplateComHistorico } = await import("../../src/graphs/follow-up/graph.ts");

function state(telefone: string): FollowUpStateType {
  return {
    messages: [], accountId: 8, boardId: 1, taskId: 1,
    board_step: { id: 8, name: "Aguardando Pagamento" },
    title: "Ana", description: "", dueDate: "", telefone,
    conversationId: 100, inboxId: 1, displayId: 1,
    funilSteps: [], idEtapaPerdido: 0,
    tipoFollowup: "lembrete", respostaAgente: "",
  };
}

describe("enviarTemplateComHistorico", () => {
  beforeEach(() => { enviarTemplateCalls.length = 0; salvarCalls.length = 0; });

  test("envia o template E persiste o texto no histórico", async () => {
    await enviarTemplateComHistorico(state("+5511999999999"), "pos_preco_reforco", "Oi Ana, ficou alguma dúvida?", "Ana");
    expect(enviarTemplateCalls.length).toBe(1);
    expect(salvarCalls.length).toBe(1);
    expect(salvarCalls[0]).toEqual({ telefone: "+5511999999999", content: "Oi Ana, ficou alguma dúvida?" });
  });

  test("não persiste quando não há telefone (mas ainda tenta enviar)", async () => {
    await enviarTemplateComHistorico(state(""), "encerramento", "Texto qualquer", "Ana");
    expect(enviarTemplateCalls.length).toBe(1);
    expect(salvarCalls.length).toBe(0);
  });

  test("não persiste texto vazio", async () => {
    await enviarTemplateComHistorico(state("+5511999999999"), "encerramento", "   ", "Ana");
    expect(salvarCalls.length).toBe(0);
  });
});
