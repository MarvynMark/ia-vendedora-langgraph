import { describe, test, expect } from "bun:test";
import {
  montarOutputDoTurno,
  TOOLS_QUE_ENVIAM_TEXTO_AO_LEAD,
} from "../../src/graphs/main-agent/output.ts";

// Textos REAIS da conv 5385, onde o defeito apareceu: o LLM devolveu o mesmo conteúdo no
// `content` da mensagem E no `mensagem_antes` do tool_call, e os dois foram para o lead.
const ANTES_5385 =
  "Acabei de ver que você é formado em Medicina e que essa é a primeira vez que está estudando para concursos. Isso é mais comum do que parece, e quase nunca é falta de esforço.";
const CONTENT_5385 =
  "Ótimo, Luiz! Vi que você é formado em Medicina e que essa é a primeira vez que está estudando para concursos. Isso é mais comum do que parece, e quase nunca é falta de esforço. Vou te explicar melhor.";
const PERGUNTA_FINAL = "Você também sente essa falta de direcionamento na hora de estudar?";

function ai(content: string, tool_calls: Array<{ name: string; args?: Record<string, unknown> }> = []) {
  return { _getType: () => "ai", content, tool_calls };
}
function toolMsg(content: string) {
  return { _getType: () => "tool", content };
}

describe("montarOutputDoTurno — regressão da conv 5385", () => {
  const newMsgs = [
    ai(CONTENT_5385, [
      { name: "Enviar_audio_walker_1", args: { mensagem_antes: ANTES_5385 } },
    ]),
    ai(PERGUNTA_FINAL),
  ];

  test("o preâmbulo do tool_call de mídia NÃO vai para o output", () => {
    const { output } = montarOutputDoTurno(newMsgs);
    expect(output).toBe(PERGUNTA_FINAL);
    expect(output).not.toContain("formado em Medicina");
  });

  test("expõe o preâmbulo descartado e o mensagem_antes", () => {
    const { preambulosDescartados, mensagensAntes } = montarOutputDoTurno(newMsgs);
    expect(preambulosDescartados).toEqual([CONTENT_5385]);
    expect(mensagensAntes).toEqual([ANTES_5385]);
  });
});

describe("montarOutputDoTurno — tools que NÃO enviam texto ao lead", () => {
  test("preserva o content que acompanha Atualizar_tarefa", () => {
    const { output, preambulosDescartados } = montarOutputDoTurno([
      ai("Perfeito, então bora fechar", [{ name: "Atualizar_tarefa", args: { etapa: 4 } }]),
      ai("Qual forma de pagamento fica melhor pra você?"),
    ]);
    expect(output).toContain("Perfeito, então bora fechar");
    expect(output).toContain("Qual forma de pagamento");
    expect(preambulosDescartados).toEqual([]);
  });

  test("preserva o content que acompanha Reagir_mensagem", () => {
    const { output } = montarOutputDoTurno([
      ai("Que bom saber disso", [{ name: "Reagir_mensagem", args: { emoji: "❤️" } }]),
    ]);
    expect(output).toBe("Que bom saber disso");
  });
});

describe("montarOutputDoTurno — salvaguarda quando a mensagem final vem vazia", () => {
  test("preâmbulo 100% duplicado → output vazio (mídia + mensagem_antes já chegaram)", () => {
    const { output } = montarOutputDoTurno([
      ai(ANTES_5385, [{ name: "Enviar_audio_walker_1", args: { mensagem_antes: ANTES_5385 } }]),
    ]);
    expect(output).toBe("");
  });

  test("preâmbulo com informação NOVA → recupera só a parte nova", () => {
    const { output } = montarOutputDoTurno([
      ai(`${ANTES_5385} ${PERGUNTA_FINAL}`, [
        { name: "Enviar_audio_walker_1", args: { mensagem_antes: ANTES_5385 } },
      ]),
    ]);
    expect(output).toBe(PERGUNTA_FINAL);
  });

  test("preâmbulo misto: só a frase não-duplicada sobra", () => {
    const { output } = montarOutputDoTurno([
      ai(
        "Isso é mais comum do que parece, e quase nunca é falta de esforço. E hoje, quanto tempo por dia você consegue estudar?",
        [{ name: "Enviar_audio_walker_1", args: { mensagem_antes: ANTES_5385 } }],
      ),
    ]);
    expect(output).toBe("E hoje, quanto tempo por dia você consegue estudar?");
  });
});

describe("montarOutputDoTurno — comportamento geral", () => {
  test("turno sem tool_call concatena com \\n\\n (idêntico ao de antes)", () => {
    const { output } = montarOutputDoTurno([ai("Primeira parte"), ai("Segunda parte")]);
    expect(output).toBe("Primeira parte\n\nSegunda parte");
  });

  test("ignora ToolMessage e content não-string", () => {
    const { output } = montarOutputDoTurno([
      toolMsg("Áudio 1 do Walker enviado com sucesso."),
      { _getType: () => "ai", content: [{ type: "text" }] as unknown },
      ai(PERGUNTA_FINAL),
    ] as never);
    expect(output).toBe(PERGUNTA_FINAL);
  });

  test("tool de mídia sem mensagem_antes: descarta o preâmbulo mas não registra nada", () => {
    const { output, mensagensAntes } = montarOutputDoTurno([
      ai("vou te mandar", [{ name: "Enviar_video_plataforma", args: {} }]),
      ai(PERGUNTA_FINAL),
    ]);
    expect(output).toBe(PERGUNTA_FINAL);
    expect(mensagensAntes).toEqual([]);
  });

  test("lista vazia → output vazio", () => {
    expect(montarOutputDoTurno([]).output).toBe("");
  });
});

describe("TOOLS_QUE_ENVIAM_TEXTO_AO_LEAD", () => {
  test("cobre exatamente as 4 tools de mídia", () => {
    expect([...TOOLS_QUE_ENVIAM_TEXTO_AO_LEAD].sort()).toEqual([
      "Enviar_audio_walker_1",
      "Enviar_audio_walker_2",
      "Enviar_imagem_entregaveis",
      "Enviar_video_plataforma",
    ]);
  });
});
