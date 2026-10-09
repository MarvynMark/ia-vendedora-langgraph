// Linha do Diagnóstico Inicial (Respondi) na planilha "[MENTORADOS] [FORMULÁRIO] - ALUNOS", a
// mesma aba que recebia o Google Forms antigo. As 28 colunas do Forms continuam valendo: cada
// pergunta do Respondi que tem equivalente vai para a coluna antiga, e as que não têm ganham
// coluna nova no fim, com o título da pergunta como cabeçalho. Puro: a rede fica em
// services/google-sheets.ts.

import type { Respostas } from "./diagnostico-inicial.ts";

// Pergunta do Respondi → coluna do Forms antigo. Só equivalências de sentido. "Como organiza seus
// estudos hoje?" NÃO vai para "maiores dificuldades em relação ao planejamento": responde outra
// coisa e misturaria as duas séries. A ordem importa: a primeira regra que casar vence.
export const DE_PARA: ReadonlyArray<{ pergunta: RegExp; coluna: RegExp }> = [
  { pergunta: /^nome/i, coluna: /^nome completo/i },
  { pergunta: /^idade/i, coluna: /^idade/i },
  { pergunta: /whats|telefone|celular/i, coluna: /^telefone/i },
  { pergunta: /e-?mail/i, coluna: /^e-?mail/i },
  { pergunta: /forma[çc][ãa]o/i, coluna: /área de formação/i },
  // "Concurso alvo" e "PRIORITÁRIO" viraram "pensa em prestar" (vários) e "para qual edital deseja
  // o planejamento individualizado" (um só) em 09/10/2026: a mesma pergunta do plano no Forms.
  { pergunta: /^concurso alvo|concursos pensa em prestar/i, coluna: /concurso de interesse/i },
  { pergunta: /seu foco hoje|planejamento individualizado/i, coluna: /para qual plano/i },
  { pergunta: /atrapalha sua const[âa]ncia/i, coluna: /maiores desafios/i },
  { pergunta: /disciplinas.*facilidade/i, coluna: /matérias.*afinidade/i },
  { pergunta: /disciplinas.*dificuldade/i, coluna: /matérias.*dificuldade/i },
  { pergunta: /h[áa] quanto tempo estuda/i, coluna: /há quanto tempo você estuda/i },
  { pergunta: /j[áa] foi aprovad/i, coluna: /já foi aprovado/i },
  { pergunta: /voc[êe] trabalha atualmente/i, coluna: /trabalha ou dedica/i },
  // Perguntas trazidas do Forms para o Respondi em 09/10/2026, para as séries continuarem
  // comparáveis. "Razão, sonho, motivo" e "Tem filhos" deixaram de ir para as colunas 19 e 8:
  // as perguntas novas abaixo respondem exatamente o que o Forms perguntava ali.
  { pergunta: /perito criminal ou m[ée]dico legista|planejamento [ée] para qual cargo/i, coluna: /perito criminal ou médico legista/i },
  { pergunta: /situa[çc][ãa]o familiar/i, coluna: /casado\(a\), solteiro/i },
  { pergunta: /quantos dias voc[êe] estudou/i, coluna: /quantos dias da semana/i },
  { pergunta: /quer resolver com a mentoria/i, coluna: /objetivo com a mentoria/i },
  { pergunta: /outra mentoria/i, coluna: /já fez alguma mentoria/i },
  { pergunta: /espera do seu mentor/i, coluna: /espera do mentor/i },
];

export const COLUNA_DATA = /^carimbo de data/i;
export const COLUNA_ORIGEM = "Origem";
export const COLUNA_CONCURSO_IA = "Concurso prioritário (identificado pela IA)";
export const COLUNA_ROTEIRO_IA = "Roteiro de boas-vindas (IA)";
export const ORIGEM_RESPONDI = "Respondi (DIM)";

// Cabeçalho vazio ou o "Coluna 28" que sobrou do Forms: espaço livre, pode ser reaproveitado.
const LIVRE = /^\s*$|^coluna \d+$/i;

/** "09/10/2026 14:03:27" no horário de Brasília, o mesmo formato do carimbo do Google Forms. */
export function carimboBrasilia(data: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(data).map(x => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Texto que o aluno digitou nunca vira fórmula: a gravação usa USER_ENTERED (para o carimbo virar
 * data, como no Forms), e uma resposta começando com "=", "+", "-" ou "@" seria interpretada.
 * O apóstrofo faz o Sheets guardar como texto e não aparece na célula.
 */
export function comoTexto(valor: string): string {
  return /^[=+\-@]/.test(valor) ? `'${valor}` : valor;
}

/**
 * Monta a linha a anexar e o cabeçalho, já com as colunas novas que faltarem.
 * `cabecalho` é a linha 1 atual da aba. Devolve `cabecalhoMudou` para só regravar a linha 1
 * quando surgir pergunta nova (a primeira resposta do Respondi, ou o formulário mudou).
 */
export function montarLinhaPlanilha(opts: {
  cabecalho: string[];
  respostas: Respostas;
  concurso: string | null;
  roteiro: string | null;
  recebidoEm: Date;
}): { cabecalho: string[]; cabecalhoMudou: boolean; linha: string[] } {
  const cabecalho = [...opts.cabecalho];
  // Corta os espaços livres do fim, para a coluna nova entrar logo depois da última ocupada.
  while (cabecalho.length && LIVRE.test(cabecalho[cabecalho.length - 1]!)) cabecalho.pop();
  const tamanhoOriginal = cabecalho.length;
  const valores = new Map<number, string>();

  const colunaDe = (titulo: string): number => {
    const i = cabecalho.findIndex(c => c.trim() === titulo.trim());
    if (i >= 0) return i;
    cabecalho.push(titulo);
    return cabecalho.length - 1;
  };

  const iData = cabecalho.findIndex(c => COLUNA_DATA.test(c));
  valores.set(iData >= 0 ? iData : colunaDe("Carimbo de data/hora"), carimboBrasilia(opts.recebidoEm));

  for (const { pergunta, resposta } of opts.respostas) {
    const regra = DE_PARA.find(r => r.pergunta.test(pergunta));
    const iAntiga = regra ? cabecalho.findIndex(c => regra.coluna.test(c)) : -1;
    // Coluna antiga já ocupada por outra pergunta: a segunda ganha a sua, para não sobrescrever.
    const i = iAntiga >= 0 && !valores.has(iAntiga) ? iAntiga : colunaDe(pergunta);
    valores.set(i, comoTexto(resposta));
  }

  valores.set(colunaDe(COLUNA_ORIGEM), ORIGEM_RESPONDI);
  if (opts.concurso) valores.set(colunaDe(COLUNA_CONCURSO_IA), opts.concurso);
  if (opts.roteiro) valores.set(colunaDe(COLUNA_ROTEIRO_IA), comoTexto(opts.roteiro));

  const linha = cabecalho.map((_, i) => valores.get(i) ?? "");
  // Sem colunas novas, o cabeçalho devolvido é o original (com os espaços livres do fim).
  const cabecalhoMudou = cabecalho.length > tamanhoOriginal;
  return { cabecalho: cabecalhoMudou ? cabecalho : opts.cabecalho, cabecalhoMudou, linha };
}
