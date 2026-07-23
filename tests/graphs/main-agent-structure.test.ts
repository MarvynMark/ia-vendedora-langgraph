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
    expect(prompt).not.toContain("Enviar_audio_walker_3");
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
    // Teto atualizado: o prompt cresceu com Anual Completo, ganchos do formulário e regras de médico
    // (~72k). Mantém um limite de sanidade contra crescimento descontrolado.
    expect(prompt.length).toBeLessThan(90000);
  });

  // Regressão conv 4549: médica digitou "Mediciba" (typo) → o gate por string falhou e ela
  // recebeu o Trimestral. Agora a detecção é determinística (label + formação tolerante a typo).
  const MARCA_MEDICO = "Detectado de forma determinística";
  const baseCtx = { tarefa: {}, etapasDescricao: "", dataHoraAtual: "", nomeLead: "Leandra" };

  test("detecta médico por typo na formação (Mediciba) e pela label", () => {
    expect(gerarPromptAgentePrincipal({ ...baseCtx, dadosFormulario: "Formação: Mediciba | Concurso: MA", etiquetas: ["nao"] })).toContain(MARCA_MEDICO);
    expect(gerarPromptAgentePrincipal({ ...baseCtx, dadosFormulario: "Formação: Medicina" })).toContain(MARCA_MEDICO);
    expect(gerarPromptAgentePrincipal({ ...baseCtx, dadosFormulario: "Concurso: MA", etiquetas: ["medico"] })).toContain(MARCA_MEDICO);
  });

  test("NÃO marca médico para biomedicina/veterinária/outras formações", () => {
    expect(gerarPromptAgentePrincipal({ ...baseCtx, dadosFormulario: "Formação: Biomedicina" })).not.toContain(MARCA_MEDICO);
    expect(gerarPromptAgentePrincipal({ ...baseCtx, dadosFormulario: "Formação: Medicina Veterinária" })).not.toContain(MARCA_MEDICO);
    expect(gerarPromptAgentePrincipal({ ...baseCtx, dadosFormulario: "Formação: Engenharia Civil" })).not.toContain(MARCA_MEDICO);
  });

  // Regressão conv 4565: agente disse que o Anual "puro" tinha aulas gravadas/PDF (fez a mentoria
  // parecer cursinho). O prompt precisa proibir isso e rotear material completo pro Anual Completo.
  test("proíbe fazer a mentoria parecer cursinho completo (material só no Anual Completo)", () => {
    const p = gerarPromptAgentePrincipal({ tarefa: {}, etapasDescricao: "", dataHoraAtual: "" });
    expect(p).toContain("PROIBIDO dizer que o Anual");
    expect(p).toContain("não é um cursinho");
  });
});
