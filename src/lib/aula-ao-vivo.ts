// Aula ao vivo "Raio-X dos Próximos Concursos de Perito Criminal" (28/09/2026, 20h, YouTube).
//
// O convite saiu pelo template `aula_raio_x_participar`, com o botão de resposta "Quero participar".
// O toque chega à IA como mensagem comum; sem este bloco ela emendaria o pitch da mentoria em quem
// só quer assistir à aula. Vale só hoje: à meia-noite some sozinho (data em código, não em prompt).

import { instanteDeParedeSP } from "../config/agenda.ts";

export const AULA_AO_VIVO = {
  link: "https://www.youtube.com/watch?v=gfc8ijeR5WM",
  inicio: instanteDeParedeSP(2026, 8, 28, 20, 0),
  fim: instanteDeParedeSP(2026, 8, 28, 23, 59),
} as const;

export function aulaAoVivoAtiva(agora = new Date()): boolean {
  return agora.getTime() <= AULA_AO_VIVO.fim.getTime() && agora.getTime() >= AULA_AO_VIVO.fim.getTime() - 24 * 3_600_000;
}

export function blocoAulaAoVivo(agora = new Date()): string {
  const comecou = agora.getTime() >= AULA_AO_VIVO.inicio.getTime();
  return `
# 🎥 AULA AO VIVO HOJE, ÀS 20H

<aula_ao_vivo>
  Hoje, às 20h, o Professor Walker faz uma aula ao vivo no YouTube: "Raio-X dos Próximos Concursos
  de Perito Criminal". Link: ${AULA_AO_VIVO.link}
  ${comecou ? "A aula JÁ ESTÁ AO VIVO agora." : "A aula ainda NÃO começou."}

  Se o lead respondeu ao convite da aula (tocou em "Quero participar", disse que vai assistir,
  perguntou do link ou do horário):
  - Responda em UMA bolha curta, calorosa, confirmando e mandando o link.
    ${comecou
      ? `Ex.: "Já estamos ao vivo! Entra aqui: ${AULA_AO_VIVO.link}"`
      : `Ex.: "Fechado! Às 20h te chamo aqui. O link já é este: ${AULA_AO_VIVO.link}"`}
  - NÃO apresente a mentoria, NÃO fale de preço e NÃO faça perguntas de qualificação nesse turno.
    O objetivo agora é só a pessoa comparecer à aula.
  - Se ele mesmo perguntar da mentoria, aí sim siga o fluxo normal.
</aula_ao_vivo>
`;
}
