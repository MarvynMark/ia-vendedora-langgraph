// Tipos do corretor de discursivas/redação do Suporte 1.
//
// O motor é um só; o que muda de um concurso para outro mora no PerfilConcurso: banca, formato da
// prova, critérios, fórmula da nota, áreas, banco de questões e o prompt do "professor". A nota é
// sempre calculada pelo CÓDIGO (calcularNota em regras.ts) a partir do que a IA avaliou — a IA não
// faz conta, para a memória de cálculo sempre fechar.

export interface Criterio {
  sigla: string;
  nome: string;
  maximo: number;
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
  promptSistema: (area: string | null) => string;
}

export type StatusEspelho = "ATENDIDO" | "PARCIAL" | "NAO_ATENDIDO" | "INCORRETO";

// O que a IA devolve na correção (structured output). Sem nenhuma conta: notas por critério,
// erros com a linha e as marcações de zeramento que dependem de julgamento.
export interface AvaliacaoIA {
  oQueAQuestaoExigia: string;
  espelho: Array<{ elemento: string; status: StatusEspelho; comentario: string }>;
  criterios: Record<string, { nota: number; justificativa: string }>;
  errosPortugues: Array<{ linha: number; trecho: string; correcao: string; tipo: string; explicacao: string }>;
  fugaAoTema: boolean;
  identificacaoIndevida: boolean;
  pontosFortes: string[];
  ondePerdeu: string[];
  prioridades: string[];
  espelhoIdeal: string[];
  respostaModelo: string;
  veredito: string;
}
