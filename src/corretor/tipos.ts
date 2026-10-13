// Tipos do corretor de discursivas/redação do Suporte 1.
//
// O motor é um só; o que muda de um concurso para outro mora no PerfilConcurso: banca, formato da
// prova, critérios, fórmula da nota, áreas, banco de questões e o prompt do "professor". A nota é
// sempre calculada pelo CÓDIGO (calcularNota em regras.ts) a partir do que a IA avaliou — a IA não
// faz conta, para a memória de cálculo sempre fechar.

// Faixa da rubrica: a IA escolhe a faixa pelo descritor e o código garante que a nota caia dentro
// dela. Rubrica DIDÁTICA da Mentoria Vestigium (o edital não publica faixas por critério).
export interface Faixa {
  codigo: string;      // "A" … "E"
  min: number;
  max: number;
  descritor: string;
}

// Contagem dos itens EXIGIDOS do espelho, para as faixas que saem dele de forma determinística.
export interface ContagemEspelho {
  exigidos: number;
  atendidos: number;
  parciais: number;
  naoAtendidos: number;
  incorretos: number;   // inclui aprofundamento incorreto: afirmar algo errado desconta sempre
}

export interface Criterio {
  sigla: string;
  nome: string;
  maximo: number;
  avalia: string;      // o que o critério mede (do edital)
  faixas: Faixa[];
  // Faixa ditada pelo espelho: `exata` substitui a escolha da IA; `teto` é a melhor permitida e
  // `piso` a pior. Ausente = a faixa é julgamento da IA (organização, coerência…).
  faixaPeloEspelho?: (c: ContagemEspelho) => { exata?: string; teto?: string; piso?: string } | null;
}

export interface QuestaoBanco {
  codigo: string;          // "G05" (geral) ou "E01" (específica — repete entre áreas)
  area: string | null;     // código da área ("103") ou null para conhecimentos gerais
  tema: string | null;
  enunciado: string;
}

export type MotivoZero = "sem_texto" | "menos_linhas" | "fuga_tema" | "identificacao";

export interface PerfilConcurso {
  codigo: string;                     // o que o aluno digita: /corrigir pcdf
  nome: string;                       // "Perito Criminal PCDF"
  banca: string;                      // "IADES — referência histórica: Edital nº 1/2016"
  notaMaximaQuestao: number;
  linhasMin: number;
  linhasMax: number;
  // Resposta digitada no WhatsApp não tem linha de folha: estimamos quebrando o texto nesta largura.
  caracteresPorLinha: number;
  criterios: Criterio[];
  formulaTexto: string;               // como aparece na memória de cálculo
  formula: (c: { dq: number; ne: number; tl: number }) => number;
  areas: Record<string, string>;      // "103" → "Ciência da Computação/Informática"
  banco: QuestaoBanco[];
  aviso: string;                      // linha final da devolutiva (ex.: edital é referência histórica)
  // Espelho oficial de exemplo, para o montador do espelho calibrar a granularidade dos itens.
  exemploEspelhoOficial: string;
  promptSistema: (area: string | null) => string;
}

export type StatusEspelho = "ATENDIDO" | "PARCIAL" | "NAO_ATENDIDO" | "INCORRETO";
// EXIGIDO: o comando pede expressamente. APROFUNDAMENTO: valoriza, mas a ausência não desconta.
export type OrigemEspelho = "EXIGIDO" | "APROFUNDAMENTO";

// O que a IA devolve na correção (structured output). Sem nenhuma conta: notas por critério,
// erros com a linha e as marcações de zeramento que dependem de julgamento. Os campos
// pedagógicos seguem feed up / feed back / feed forward: um foco por vez, ancorado no texto do aluno.
export interface AvaliacaoIA {
  oQueAQuestaoExigia: string;
  espelho: Array<{ elemento: string; origem: OrigemEspelho; status: StatusEspelho; comentario: string }>;
  criterios: Record<string, { faixa: string; nota: number; justificativa: string }>;
  errosPortugues: Array<{ linha: number; trecho: string; correcao: string; tipo: string; regra: string }>;
  fugaAoTema: boolean;
  identificacaoIndevida: boolean;
  // O que o aluno já domina — elogio específico, com o trecho dele (reforça a estratégia certa).
  dominado: { oQue: string; trecho: string };
  // A ÚNICA mudança que mais renderia nota agora. Um foco: a memória de trabalho não dá conta de dez.
  pontoDeVirada: { problema: string; porQueImporta: string; comoFazer: string };
  // O trecho do próprio aluno reescrito com o mínimo de mudança: o contraste ensina mais que um modelo pronto.
  antesDepois: { linhas: string; antes: string; depois: string; oQueMudou: string[] };
  // Prática ativa: o aluno reescreve e o sistema confere (efeito de geração).
  desafio: { instrucao: string; criterioSucesso: string };
  outrosAjustes: string[];          // no máximo 2, para depois do ponto de virada
  evolucao: string;                 // comparação com o histórico (vazio se é a primeira correção)
  espelhoIdeal: string[];
  respostaModelo: string;
  mensagemFinal: string;            // fechamento curto do Professor Vestigium
}

// Resumo de uma correção anterior, para o histórico do aluno.
export interface CorrecaoAnterior {
  quando: Date;
  nota: number;
  pontoDeVirada: string;
  errosPorTipo: Record<string, number>;
}
