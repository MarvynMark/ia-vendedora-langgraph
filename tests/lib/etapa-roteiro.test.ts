import { describe, test, expect } from "bun:test";
import { instrucaoEtapaRoteiro } from "../../src/lib/etapa-roteiro.ts";

const ia = (content: string) => ({ type: "ai", content });
const lead = (content: string) => ({ type: "human", content });
const midia = (rotulo: string) => ia(`[enviado ao lead: ${rotulo}]`);

// Conv 9909: o texto com a oferta do vídeo foi descartado (o lead falou durante o "gravando" do
// áudio 2). Áudio 2 e cronograma tinham saído; o vídeo e os entregáveis nunca saíram.
const ATE_AUDIO_2 = [
  ia("Oi, Claudia! Aqui é o Perito Walker."),
  midia("áudio 1 do Walker"),
  lead("ele tem dificuldade para estudar"),
  midia("áudio 2 do Walker"),
  midia("imagem do cronograma"),
  lead("me diz como é o passo a passo da sua mentoria"),
];

describe("instrucaoEtapaRoteiro", () => {
  test("áudio 2 saiu e o vídeo não → manda o vídeo neste turno", () => {
    const r = instrucaoEtapaRoteiro(ATE_AUDIO_2);
    expect(r).toContain("Enviar_video_plataforma");
    expect(r).toContain("áudio 2 do Walker, imagem do cronograma");
  });

  test("lead pergunta o valor no meio do roteiro → segura e manda a mídia", () => {
    const r = instrucaoEtapaRoteiro([...ATE_AUDIO_2, lead("E qual o valor?")]);
    expect(r).toContain("Já já te passo os valores");
  });

  test("vídeo saiu e entregáveis não → entregáveis", () => {
    const r = instrucaoEtapaRoteiro([...ATE_AUDIO_2, midia("vídeo da plataforma"), lead("legal")]);
    expect(r).toContain("Enviar_imagem_entregaveis");
    expect(r).not.toContain("Enviar_video_plataforma");
  });

  test("entregáveis já saíram → sem instrução", () => {
    expect(instrucaoEtapaRoteiro([...ATE_AUDIO_2, midia("vídeo da plataforma"), midia("imagem dos entregáveis")])).toBe("");
  });

  test("antes do áudio 2 → sem instrução (o roteiro normal cuida)", () => {
    expect(instrucaoEtapaRoteiro(ATE_AUDIO_2.slice(0, 3))).toBe("");
  });

  test("preço já apresentado → sem instrução (é negociação)", () => {
    const r = instrucaoEtapaRoteiro([...ATE_AUDIO_2, ia("São 12x de R$ 394 no cartão.")]);
    expect(r).toBe("");
  });
});
