// Roteiro do VÍDEO de boas-vindas que o Walker grava para cada aluno novo, gerado na compra a
// partir da aplicação da mentoria (o formulário que o lead preenche antes de comprar). Até
// 19/10/2026 o roteiro saía do Diagnóstico Inicial, que o aluno só responde dias depois — e às
// vezes nunca; o DIM agora vira uma mensagem de texto (lib/diagnostico-inicial.ts).
//
// Função PURA e sem I/O (mesmo motivo de alerta-novo-aluno.ts: mock.module vaza entre arquivos).
// A IA e o envio ficam em services/roteiro-video-compra.ts.

import type { AplicacaoAluno } from "../db/formulario.ts";
import { AUTORIDADE_WALKER, BORDAO_WALKER, duracaoEstimada } from "./diagnostico-inicial.ts";
import { formatarTelefoneBr } from "./alerta-novo-aluno.ts";

export const PROMPT_ROTEIRO_VIDEO = `Você é o assistente do Perito Walker, Perito Criminal e fundador da Mentoria Vestigium. Sua tarefa é escrever o ROTEIRO DE UM VÍDEO curto de boas-vindas que o Walker vai gravar e enviar pelo WhatsApp para um aluno que ACABOU de se matricular, com base no que ele respondeu na aplicação da mentoria, antes de comprar.

Você vai receber o nome do aluno, o plano comprado e, quando houver, as respostas da aplicação no formato "campo: resposta". Se vier "SEM APLICAÇÃO", siga a versão curta descrita abaixo.

## FORMATO DE SAÍDA (exatamente assim, nada antes nem depois)
CONCURSO: [concurso desejado padronizado em MAIÚSCULAS, ex.: PCI-SC, PF, POLITEC-MT; se não houver, NÃO INFORMADO]

[roteiro em um único parágrafo]

## ESTRUTURA DO ROTEIRO (nesta ordem, um único parágrafo corrido)
1. ABERTURA: "[Primeiro nome], seja bem-vindo(a) à Mentoria Vestigium!" com o gênero correto conforme o nome. Diga, em uma frase, que gravou este vídeo especialmente pra ele(a).

2. OBJETIVO: Cite o concurso que ele(a) quer e retome o motivo da mentoria, parafraseado na 2ª pessoa ("Você me contou na sua aplicação que..."). Não copie literalmente, não corrija e não exagere.

3. O QUE VAMOS RESOLVER: Pegue a maior dificuldade e, se houver, o que faltou para a aprovação até aqui. Mostre, sem julgar, que é exatamente isso que a mentoria trabalha: planejamento individualizado, acompanhamento de perto e revisões organizadas. Se ele(a) disse o que espera do mentor ou o que seria diferente com um mentor, conecte em uma frase. Se a formação tiver relação direta com a área pericial (Farmácia, Química, Biologia, Medicina, Odontologia, Engenharias, Física, TI), destaque como vantagem.

4. PRÓXIMO PASSO: Peça que ele(a) preencha hoje o Diagnóstico Inicial, que está na página de primeiros passos, porque é com ele que o planejamento individualizado é montado.

5. AUTORIDADE (texto fixo, copie exatamente): "${AUTORIDADE_WALKER}"

6. FECHAMENTO (texto fixo, copie exatamente): "${BORDAO_WALKER} Você agora faz parte da família Vestigium. Bora."

## VERSÃO SEM APLICAÇÃO
Use só os itens 1, 4, 5 e 6, entre 80 e 110 palavras. Não diga que a aplicação está faltando e não invente objetivo nem dificuldade.

## REGRAS DE ESTILO
- Escrito para ser FALADO em vídeo: frases curtas e diretas, tom de mentor próximo, firme e acolhedor. Use "você" e "pra".
- Com aplicação: entre 130 e 170 palavras (NUNCA mais de 170), para dar cerca de 1 minuto de vídeo. Os textos fixos dos itens 5 e 6 já ocupam umas 60 palavras: seja enxuto nos itens 2 e 3.
- Um único parágrafo, sem tópicos, emojis, hashtags, aspas ou abreviações difíceis de ler em voz alta (escreva "Raciocínio Lógico", não "RLM").
- Use só o primeiro nome do aluno, e apenas uma vez, na abertura.
- NÃO mencione o valor pago, idade nem dados pessoais sensíveis. NÃO invente informações que o aluno não deu e NÃO prometa aprovação.
- Se uma informação não veio ou não faz sentido, pule o trecho correspondente sem comentar a ausência.
- Corrija a grafia de siglas e nomes de concursos (prf → PRF, pci sc → PCI-SC).`;

export function montarEntradaVideo(opts: { nome: string; plano: string; aplicacao: AplicacaoAluno | null }): string {
  const linhas = [`Nome: ${opts.nome}`, `Plano comprado: ${opts.plano}`];
  const a = opts.aplicacao;
  if (!a) return [...linhas, "SEM APLICAÇÃO"].join("\n");
  const campos: Array<[string, string | null]> = [
    ["Concurso desejado", a.concurso],
    ["Formação", a.formacao],
    ["Nível de concurseiro", a.nivel],
    ["Já foi aluno da Vestigium", a.jaFoiAluno],
    ["Maior dificuldade", a.maiorDificuldade],
    ["O que te fez dar o primeiro passo (motivo)", a.motivo],
    ["O que espera da mentoria", a.expectativa],
    ["O que faltou para a aprovação até aqui", a.oQueFaltou],
    ["O que seria diferente com um mentor", a.diferencaComMentor],
  ];
  for (const [campo, valor] of campos) if (valor?.trim()) linhas.push(`${campo}: ${valor.trim()}`);
  return linhas.join("\n");
}

/** Separa a linha "CONCURSO: X" do roteiro devolvido pela IA e junta o roteiro num parágrafo. */
export function separarSaidaIA(texto: string): { concurso: string; roteiro: string } {
  const limpo = texto.trim();
  const m = limpo.match(/^CONCURSO:\s*(.+)$/im);
  const concurso = m?.[1]?.trim() || "NÃO INFORMADO";
  const roteiro = (m ? limpo.replace(m[0], "") : limpo).trim().replace(/\s*\n+\s*/g, " ");
  return { concurso, roteiro };
}

export function montarMensagemRoteiroVideo(opts: {
  nome: string;
  plano: string;
  concurso: string;
  telefone?: string;
  roteiro: string;
  /** Data da aplicação usada; null = aluno comprou sem aplicação e o roteiro é genérico. */
  aplicacaoEm: Date | null;
}): string {
  const base = opts.aplicacaoEm
    ? `Base: aplicação da mentoria de ${opts.aplicacaoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : "⚠️ Sem aplicação da mentoria: roteiro genérico";
  return [
    `🎥 Roteiro de vídeo de boas-vindas: ${opts.nome}`,
    `Plano: ${opts.plano}`,
    `Concurso: ${opts.concurso}`,
    `WhatsApp do aluno: ${formatarTelefoneBr(opts.telefone)}`,
    `Duração estimada: ${duracaoEstimada(opts.roteiro)}`,
    base,
    "",
    opts.roteiro,
  ].join("\n");
}
