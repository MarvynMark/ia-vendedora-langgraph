import { describe, test, expect } from "bun:test";
import { gerarPromptAgentePrincipal } from "../../src/graphs/main-agent/prompt.ts";

describe("main agent prompt", () => {
  test("gera prompt com variáveis dinâmicas", () => {
    const prompt = gerarPromptAgentePrincipal({
      tarefa: {
        board_step: { name: "Qualificado" },
        board_step_id: 42,
        title: "Limpeza - João",
        description: "Procedimento: Limpeza",
        due_date: "2026-03-10T10:00:00-03:00",
      },
      etapasDescricao: "Qualificado: 42\nAgendado: 43",
      dataHoraAtual: "sábado, 8 de março de 2026 17:30:00 BRT",
    });

    // Verifica secções críticas do prompt
    expect(prompt).toContain("Você é a Maria, secretária virtual");
    expect(prompt).toContain("Clínica Moreira");
    expect(prompt).toContain("Buscar_janelas_disponiveis");
    expect(prompt).toContain("Criar_agendamento");
    expect(prompt).toContain("Escalar_humano");
    expect(prompt).toContain("Atualizar_tarefa");
    expect(prompt).toContain("Reagir_mensagem");

    // Verifica substituições dinâmicas
    expect(prompt).toContain("Qualificado (ID: 42)");
    expect(prompt).toContain("Limpeza - João");
    expect(prompt).toContain("Procedimento: Limpeza");
    expect(prompt).toContain("sábado, 8 de março de 2026");

    // Verifica que NÃO contém expressões n8n
    expect(prompt).not.toContain("{{ $('Info')");
    expect(prompt).not.toContain("{{ $now");
  });

  test("prompt contém SOP completo", () => {
    const prompt = gerarPromptAgentePrincipal({
      tarefa: {},
      etapasDescricao: "",
      dataHoraAtual: "",
    });

    expect(prompt).toContain("FLUXO DE ATENDIMENTO INICIAL");
    expect(prompt).toContain("FLUXO DE AGENDAMENTO");
    expect(prompt).toContain("FLUXO DE CANCELAMENTO");
    expect(prompt).toContain("FLUXO DE CONFIRMAÇÃO DE PRESENÇA");
    expect(prompt).toContain("FLUXO DE DÚVIDAS");
    expect(prompt).toContain("OBSERVAÇÕES FINAIS");
    expect(prompt).toContain("KANBAN");
  });

  test("prompt tem ~27k caracteres", () => {
    const prompt = gerarPromptAgentePrincipal({
      tarefa: {},
      etapasDescricao: "",
      dataHoraAtual: "",
    });
    expect(prompt.length).toBeGreaterThan(25000);
    expect(prompt.length).toBeLessThan(30000);
  });
});
