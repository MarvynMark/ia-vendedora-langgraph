import { describe, test, expect } from "bun:test";
import { gerarPromptFollowup, PROMPT_LEMBRETE, PROMPT_POS_CONSULTA } from "../../src/graphs/follow-up/prompts.ts";

describe("follow-up prompts", () => {
  test("prompt follow-up contém secções corretas", () => {
    const prompt = gerarPromptFollowup({
      funilSteps: [
        { id: 1, name: "Qualificado" },
        { id: 2, name: "Agendado" },
        { id: 3, name: "Perdido (reativar)" },
      ],
      board_step: { id: 1, name: "Qualificado" },
      title: "Limpeza - Maria",
      description: "Follow-ups enviados: 1",
      dueDate: "2026-03-08T10:00:00-03:00",
    });

    expect(prompt).toContain("Maria, secretaria virtual");
    expect(prompt).toContain("SECAO A");
    expect(prompt).toContain("SECAO B");
    expect(prompt).toContain("Atualizar_tarefa");

    // Verificar substituições
    expect(prompt).toContain("Limpeza - Maria");
    expect(prompt).toContain("Follow-ups enviados: 1");
    expect(prompt).toContain("Qualificado: 1");
    expect(prompt).toContain("Agendado: 2");

    // Sem expressões n8n
    expect(prompt).not.toContain("{{ $(");
    expect(prompt).not.toContain("{{ $now");
  });

  test("prompt lembrete é estático e contém secções corretas", () => {
    expect(PROMPT_LEMBRETE).toContain("lembrete");
    expect(PROMPT_LEMBRETE).toContain("consulta");
    expect(PROMPT_LEMBRETE).toContain("Clínica Moreira");
    // Deve ser estático - sem expressões dinâmicas
    expect(PROMPT_LEMBRETE).not.toContain("${");
    expect(PROMPT_LEMBRETE).not.toContain("{{ $(");
  });

  test("prompt pós-consulta é estático e contém secções corretas", () => {
    expect(PROMPT_POS_CONSULTA).toContain("pós-consulta");
    expect(PROMPT_POS_CONSULTA).toContain("compareceu");
    expect(PROMPT_POS_CONSULTA).toContain("Clínica Moreira");
    // Deve ser estático
    expect(PROMPT_POS_CONSULTA).not.toContain("${");
    expect(PROMPT_POS_CONSULTA).not.toContain("{{ $(");
  });
});
