import { describe, test, expect } from "bun:test";
import { criarToolsAgenteClinica, criarToolsFollowup } from "../../src/tools/factory.ts";

describe("tool factory - main agent", () => {
  test("cria 9 tools", () => {
    const tools = criarToolsAgenteClinica({
      idMensagem: "1",
      idConta: "8",
      idConversa: "1",
      idContato: "1",
      idInbox: "1",
      telefone: "+5511999999999",
      nome: "Teste",
      mensagem: "Olá",
      tarefa: {},
    });

    expect(tools.length).toBe(9);
  });

  test("tools têm nomes corretos", () => {
    const tools = criarToolsAgenteClinica({
      idMensagem: "1",
      idConta: "8",
      idConversa: "1",
      idContato: "1",
      idInbox: "1",
      telefone: "+5511999999999",
      nome: "Teste",
      mensagem: "Olá",
      tarefa: {},
    });

    const nomes = tools.map(t => t.name).sort();
    expect(nomes).toEqual([
      "Atualizar_agendamento",
      "Atualizar_tarefa",
      "Buscar_agendamentos_do_contato",
      "Buscar_janelas_disponiveis",
      "Cancelar_agendamento",
      "Criar_agendamento",
      "Escalar_humano",
      "Reagir_mensagem",
      "Refletir",
    ]);
  });

  test("Atualizar_tarefa inclui etapas na descrição", () => {
    const tools = criarToolsAgenteClinica({
      idMensagem: "1",
      idConta: "8",
      idConversa: "1",
      idContato: "1",
      idInbox: "1",
      telefone: "+5511999999999",
      nome: "Teste",
      mensagem: "Olá",
      tarefa: {
        board: {
          steps: [
            { id: 1, name: "Qualificado" },
            { id: 2, name: "Agendado" },
          ],
        },
      },
    });

    const atualizar = tools.find(t => t.name === "Atualizar_tarefa");
    expect(atualizar).toBeDefined();
    expect(atualizar!.description).toContain("Qualificado: 1");
    expect(atualizar!.description).toContain("Agendado: 2");
  });

  test("Buscar_janelas_disponiveis tem descrição verbatim do n8n", () => {
    const tools = criarToolsAgenteClinica({
      idMensagem: "1",
      idConta: "8",
      idConversa: "1",
      idContato: "1",
      idInbox: "1",
      telefone: "+5511999999999",
      nome: "Teste",
      mensagem: "Olá",
      tarefa: {},
    });

    const buscar = tools.find(t => t.name === "Buscar_janelas_disponiveis");
    expect(buscar).toBeDefined();
    expect(buscar!.description).toContain("Utilize essa ferramenta para buscar as janelas disponíveis");
    expect(buscar!.description).toContain("Evite utilizar com janelas de tamanho muito grandes");
  });

  test("Buscar_agendamentos_do_contato tem descrição verbatim do n8n", () => {
    const tools = criarToolsAgenteClinica({
      idMensagem: "1",
      idConta: "8",
      idConversa: "1",
      idContato: "1",
      idInbox: "1",
      telefone: "+5511999999999",
      nome: "Teste",
      mensagem: "Olá",
      tarefa: {},
    });

    const buscar = tools.find(t => t.name === "Buscar_agendamentos_do_contato");
    expect(buscar).toBeDefined();
    expect(buscar!.description).toContain("buscar os agendamentos já existentes para o contato atual");
    expect(buscar!.description).toContain("evitar agendamentos duplicados");
  });

  test("Atualizar_agendamento tem descrição verbatim do n8n", () => {
    const tools = criarToolsAgenteClinica({
      idMensagem: "1",
      idConta: "8",
      idConversa: "1",
      idContato: "1",
      idInbox: "1",
      telefone: "+5511999999999",
      nome: "Teste",
      mensagem: "Olá",
      tarefa: {},
    });

    const atualizar = tools.find(t => t.name === "Atualizar_agendamento");
    expect(atualizar).toBeDefined();
    expect(atualizar!.description).toContain("atualizar informações no título e descrição do evento");
    expect(atualizar!.description).toContain("Não pode ser utilizada para atualizar o horário");
  });

  test("Criar_agendamento tem descrição verbatim do n8n", () => {
    const tools = criarToolsAgenteClinica({
      idMensagem: "1",
      idConta: "8",
      idConversa: "1",
      idContato: "1",
      idInbox: "1",
      telefone: "+5511999999999",
      nome: "Teste",
      mensagem: "Olá",
      tarefa: {},
    });

    const criar = tools.find(t => t.name === "Criar_agendamento");
    expect(criar).toBeDefined();
    expect(criar!.description).toContain("com duração do evento conforme já especificado nas instruções gerais");
    expect(criar!.description).toContain("NUNCA CHAME ESSA FERRAMENTA MAIS DE UMA VEZ");
  });
});

describe("tool factory - follow-up", () => {
  test("cria 1 tool", () => {
    const tools = criarToolsFollowup({
      accountId: 8,
      boardId: 1,
      taskId: 1,
      funilSteps: [{ id: 1, name: "Qualificado" }],
      board_step: { id: 1, name: "Qualificado" },
    });

    expect(tools.length).toBe(1);
    expect(tools[0]!.name).toBe("Atualizar_tarefa");
  });
});
