import { describe, test, expect } from "bun:test";
import { criarToolsAgenteVestigium, criarToolsFollowup } from "../../src/tools/factory.ts";

const CONTEXTO_BASE = {
  idMensagem: "1",
  idConta: "8",
  idConversa: "1",
  idContato: "1",
  idInbox: "1",
  telefone: "+5511999999999",
  nome: "Teste",
  mensagem: "Olá",
  tarefa: {},
};

describe("tool factory - main agent", () => {
  test("cria 9 tools", () => {
    const tools = criarToolsAgenteVestigium(CONTEXTO_BASE);
    expect(tools.length).toBe(9);
  });

  test("tools têm nomes corretos (incluindo os 2 áudios do Walker)", () => {
    const tools = criarToolsAgenteVestigium(CONTEXTO_BASE);

    const nomes = tools.map(t => t.name).sort();
    expect(nomes).toEqual([
      "Atualizar_tarefa",
      "Buscar_contexto_similar",
      "Enviar_audio_walker_1",
      "Enviar_audio_walker_2",
      "Enviar_imagem_entregaveis",
      "Enviar_video_plataforma",
      "Escalar_humano",
      "Reagir_mensagem",
      "Refletir",
    ]);
  });

  test("Atualizar_tarefa inclui etapas na descrição", () => {
    const tools = criarToolsAgenteVestigium({
      ...CONTEXTO_BASE,
      tarefa: {
        board: {
          steps: [
            { id: 1, name: "Conexão" },
            { id: 2, name: "Aguardando Pagamento" },
          ],
        },
      },
    });

    const atualizar = tools.find(t => t.name === "Atualizar_tarefa");
    expect(atualizar).toBeDefined();
    expect(atualizar!.description).toContain("Conexão: 1");
    expect(atualizar!.description).toContain("Aguardando Pagamento: 2");
  });

  test("as tools de áudio do Walker (1 e 2) existem e enviam nota de voz", () => {
    const tools = criarToolsAgenteVestigium(CONTEXTO_BASE);

    for (const numero of [1, 2]) {
      const audio = tools.find(t => t.name === `Enviar_audio_walker_${numero}`);
      expect(audio).toBeDefined();
      expect(audio!.description).toContain("nota de voz");
    }
    // O áudio 3 foi removido do fluxo
    expect(tools.find(t => t.name === "Enviar_audio_walker_3")).toBeUndefined();
  });
});

describe("tool factory - follow-up", () => {
  test("cria 1 tool", () => {
    const tools = criarToolsFollowup({
      accountId: 8,
      boardId: 1,
      taskId: 1,
      funilSteps: [{ id: 1, name: "Conexão" }],
      board_step: { id: 1, name: "Conexão" },
    });

    expect(tools.length).toBe(1);
    expect(tools[0]!.name).toBe("Atualizar_tarefa");
  });
});
