import { describe, test, expect } from "bun:test";
import { gerarPromptAgentePrincipal } from "../../src/graphs/main-agent/prompt.ts";

describe("main agent prompt", () => {
  test("gera prompt com variáveis dinâmicas e persona do Walker", () => {
    const prompt = gerarPromptAgentePrincipal({
      tarefa: {
        board_step: { name: "Conexão" },
        board_step_id: 42,
        title: "João - PCDF",
        description: "Concurso: PCDF",
        due_date: "2026-03-10T10:00:00-03:00",
      },
      etapasDescricao: "Conexão: 42\nAguardando Pagamento: 43",
      dataHoraAtual: "quarta, 8 de julho de 2026 17:30:00 BRT",
      nomeLead: "João",
    });

    // Persona: é o Walker em 1ª pessoa, não mais o Pedro
    expect(prompt).toContain("Professor Perito Walker");
    expect(prompt).not.toContain("Você é o Pedro");

    // Ferramentas críticas, incluindo os 3 áudios do Walker
    expect(prompt).toContain("Enviar_audio_walker_1");
    expect(prompt).toContain("Enviar_audio_walker_2");
    expect(prompt).toContain("Enviar_audio_walker_3");
    expect(prompt).toContain("Enviar_video_plataforma");
    expect(prompt).toContain("Enviar_imagem_entregaveis");
    expect(prompt).toContain("Escalar_humano");
    expect(prompt).toContain("Atualizar_tarefa");
    expect(prompt).toContain("Reagir_mensagem");

    // Substituições dinâmicas
    expect(prompt).toContain("Conexão (ID: 42)");
    expect(prompt).toContain("João - PCDF");
    expect(prompt).toContain("Concurso: PCDF");
    expect(prompt).toContain("quarta, 8 de julho de 2026");

    // Não deve conter expressões n8n
    expect(prompt).not.toContain("{{ $('Info')");
    expect(prompt).not.toContain("{{ $now");
  });

  test("prompt contém o fluxo de vendas com os 3 áudios e as seções principais", () => {
    const prompt = gerarPromptAgentePrincipal({
      tarefa: {},
      etapasDescricao: "",
      dataHoraAtual: "",
    });

    // Fluxo novo (SPIN com áudios)
    expect(prompt).toContain("MENSAGEM 1");
    expect(prompt).toContain("MENSAGEM 4");
    expect(prompt).toContain("MENSAGEM 6");
    expect(prompt).toContain("COMO USAR OS SEUS ÁUDIOS");

    // Seções mantidas
    expect(prompt).toContain("PITCH DE PREÇO");
    expect(prompt).toContain("QUEBRA DE OBJEÇÕES");
    expect(prompt).toContain("KANBAN");
    expect(prompt).toContain("PRODUTOS E LINKS");
    expect(prompt).toContain("REGRAS INEGOCIÁVEIS");
  });

  test("prompt tem tamanho esperado", () => {
    const prompt = gerarPromptAgentePrincipal({
      tarefa: {},
      etapasDescricao: "",
      dataHoraAtual: "",
    });
    expect(prompt.length).toBeGreaterThan(30000);
    expect(prompt.length).toBeLessThan(50000);
  });
});
