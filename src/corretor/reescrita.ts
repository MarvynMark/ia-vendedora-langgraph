// Desafio de reescrita: depois da devolutiva, o aluno reescreve o trecho do ponto de virada e o
// sistema confere na hora. É a parte que mais ensina: produzir a própria versão fixa o ajuste
// (efeito de geração), e o retorno imediato fecha o ciclo antes de o aluno esquecer o contexto.
import { chamarJson } from "./openai.ts";

export interface RetornoReescrita {
  atingiu: boolean;
  oQueMelhorou: string;      // específico, com o texto dele
  ajuste: string;            // UMA coisa a ajustar; vazio se atingiu plenamente
  versaoLapidada: string;    // a tentativa dele com o mínimo de polimento (vazio se já está ótima)
}

const PROMPT_REESCRITA = `Você é o Professor Vestigium conferindo um exercício curto de reescrita de uma questão discursiva.

O aluno recebeu um ponto de virada e um desafio. Avalie a tentativa SOMENTE pelo critério de sucesso do desafio.
- "atingiu": true se o critério foi cumprido, mesmo que o texto ainda possa melhorar.
- "oQueMelhorou": o que a tentativa fez de certo em relação ao trecho original, citando as palavras dele. Específico, nunca genérico.
- "ajuste": UMA coisa para deixar a tentativa melhor (a mais importante). Vazio se não houver nada relevante.
- "versaoLapidada": a tentativa DELE com o menor polimento possível (mantenha as palavras e a estrutura dele). Vazio se já estiver ótima.
- Aponte erro de português só se houver, dentro do "ajuste".
- Tom: professor exigente que acredita no aluno. Frases curtas. Sem markdown.`;

export async function avaliarReescrita(c: {
  enunciado: string;
  pontoDeVirada: string;
  desafio: string;
  criterioSucesso: string;
  trechoOriginal: string;
  tentativa: string;
}): Promise<RetornoReescrita> {
  return chamarJson<RetornoReescrita>(
    PROMPT_REESCRITA,
    [{
      type: "text",
      text: [
        `COMANDO DA QUESTÃO:\n${c.enunciado}`,
        `PONTO DE VIRADA:\n${c.pontoDeVirada}`,
        `DESAFIO:\n${c.desafio}`,
        `CRITÉRIO DE SUCESSO:\n${c.criterioSucesso}`,
        `TRECHO ORIGINAL DO ALUNO:\n${c.trechoOriginal}`,
        `TENTATIVA DO ALUNO:\n${c.tentativa}`,
      ].join("\n\n"),
    }],
    "reescrita",
    {
      type: "object",
      properties: {
        atingiu: { type: "boolean" },
        oQueMelhorou: { type: "string" },
        ajuste: { type: "string" },
        versaoLapidada: { type: "string" },
      },
      required: ["atingiu", "oQueMelhorou", "ajuste", "versaoLapidada"],
      additionalProperties: false,
    },
  );
}
