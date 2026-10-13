// Regras PURAS do corretor (sem banco, sem rede): leitura dos comandos do aluno, linhas e nota.
// Ficam aqui para serem testadas sem mock — a conta da nota não pode depender da IA.
import type { AvaliacaoIA, MotivoZero, PerfilConcurso, QuestaoBanco } from "./tipos.ts";

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

const RE_CODIGO_QUESTAO = /^[ge]\d{1,2}$/i;

export type Comando =
  | { tipo: "iniciar"; concurso: string | null; codigo: string | null }
  | { tipo: "corrigir" }
  | { tipo: "pronto" }
  | { tipo: "cancelar" };

/**
 * "/corrigir", "/corrigir pcdf", "/corrigir pcdf G05" e "/corrigir G05" iniciam. Só a barra inicia:
 * no Suporte 1 a palavra "corrigir" aparece em conversa normal com a equipe. Sozinha, sem barra,
 * "CORRIGIR" é a confirmação da transcrição (o mesmo gatilho que o GPT usava).
 */
export function interpretarComando(texto: string): Comando | null {
  const t = normalizar(texto);
  if (t === "corrigir" || t === "corrigir!") return { tipo: "corrigir" };
  if (t === "pronto" || t === "/pronto" || t === "pronto!") return { tipo: "pronto" };
  if (t === "/cancelar" || t === "cancelar") return { tipo: "cancelar" };

  const m = t.match(/^\/\s?corrigir\b(.*)$/);
  if (!m) return null;
  const args = (m[1] ?? "").split(" ").filter(Boolean);
  let concurso: string | null = null;
  let codigo: string | null = null;
  for (const a of args) {
    if (RE_CODIGO_QUESTAO.test(a)) codigo = padronizarCodigo(a);
    else if (!concurso) concurso = a;
  }
  return { tipo: "iniciar", concurso, codigo };
}

/** "g5" → "G05". */
export function padronizarCodigo(codigo: string): string {
  const letra = codigo[0]!.toUpperCase();
  return `${letra}${codigo.slice(1).padStart(2, "0")}`;
}

/** Resposta a "qual concurso?": número da lista, código ou parte do nome. */
export function interpretarConcurso(texto: string, perfis: PerfilConcurso[]): PerfilConcurso | null {
  const t = normalizar(texto);
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= perfis.length) return perfis[n - 1]!;
  return perfis.find((p) => p.codigo === t || normalizar(p.nome).includes(t) && t.length >= 3) ?? null;
}

/** Resposta a "qual sua área?": código ("103"), posição na lista ("3") ou parte do nome ("computação"). */
export function interpretarArea(texto: string, perfil: PerfilConcurso): string | null {
  const t = normalizar(texto).replace(/^codigo /, "");
  const codigos = Object.keys(perfil.areas);
  if (codigos.includes(t)) return t;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= codigos.length) return codigos[n - 1]!;
  // Por nome: alguma palavra marcante da área aparece no texto ("sou de computação" → 103).
  // Palavra inteira, para "química" não casar com "bioquímica"; "ciência(s)" não distingue nada.
  const palavrasAluno = new Set(t.split(/[^a-z]+/).map(singular));
  const achadas = codigos.filter((c) => normalizar(perfil.areas[c]!)
    .split(/[^a-z]+/)
    .filter((p) => p.length >= 5 && !p.startsWith("ciencia"))
    .some((p) => palavrasAluno.has(singular(p))));
  return achadas.length === 1 ? achadas[0]! : null;
}

function singular(palavra: string): string {
  return palavra.length > 5 ? palavra.replace(/s$/, "") : palavra;
}

/** Texto do aluno é um código do banco ("G05", "e3")? Devolve padronizado ou null. */
export function codigoQuestaoNoTexto(texto: string): string | null {
  const t = normalizar(texto).replace(/^questao /, "");
  return RE_CODIGO_QUESTAO.test(t) ? padronizarCodigo(t) : null;
}

/** Questão do banco. As específicas (E..) repetem o código entre áreas: precisa da área. */
export function buscarQuestao(perfil: PerfilConcurso, codigo: string, area: string | null): QuestaoBanco | null {
  if (codigo.startsWith("G")) return perfil.banco.find((q) => q.codigo === codigo && q.area === null) ?? null;
  if (!area) return null;
  return perfil.banco.find((q) => q.codigo === codigo && q.area === area) ?? null;
}

/**
 * Linhas de uma resposta DIGITADA. Se o aluno já quebrou as linhas como na folha (ao menos o
 * mínimo do edital), respeitamos; senão estimamos quebrando o texto na largura de uma linha
 * manuscrita — e a devolutiva avisa que o TL é estimado.
 */
export function linhasDeTextoDigitado(texto: string, perfil: PerfilConcurso): { linhas: string[]; estimadas: boolean } {
  const doAluno = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (doAluno.length >= perfil.linhasMin) return { linhas: doAluno, estimadas: false };

  const linhas: string[] = [];
  let atual = "";
  for (const palavra of doAluno.join(" ").split(/\s+/).filter(Boolean)) {
    if (atual && (atual.length + 1 + palavra.length) > perfil.caracteresPorLinha) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = atual ? `${atual} ${palavra}` : palavra;
    }
  }
  if (atual) linhas.push(atual);
  return { linhas, estimadas: true };
}

/**
 * Linhas que entram na correção (até o máximo do edital) e quantas foram desconsideradas.
 * Linhas ESTIMADAS (texto digitado) não são cortadas: a estimativa de largura é grosseira e
 * cortar por ela jogava fora conteúdo que, na folha, talvez coubesse. O aluno só é avisado.
 */
export function linhasConsideradas(linhas: string[], perfil: PerfilConcurso, estimadas = false): { consideradas: string[]; descartadas: number } {
  if (estimadas) return { consideradas: linhas, descartadas: 0 };
  const consideradas = linhas.slice(0, perfil.linhasMax);
  return { consideradas, descartadas: Math.max(0, linhas.length - perfil.linhasMax) };
}

export function numerarLinhas(linhas: string[]): string {
  return linhas.map((l, i) => `${String(i + 1).padStart(2, "0")}. ${l}`).join("\n");
}

function arredondar(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface CalculoNota {
  criterios: Array<{ sigla: string; nome: string; nota: number; maximo: number }>;
  dq: number;
  ne: number;
  tl: number;
  nqCalculada: number;    // pela fórmula, antes de aplicar zero
  nq: number;             // nota final da questão
  zero: MotivoZero | null;
  linhasDescartadas: number;
  excedenteEstimado: number;  // texto digitado: quantas linhas estimadas passaram do máximo (sem cortar)
}

/**
 * Nota da questão pela régua do perfil. A IA só avalia; aqui: notas presas ao máximo de cada
 * critério, TL das linhas efetivamente escritas até o limite, NE só de erros dentro dele, fórmula
 * e hipóteses de zero do edital.
 */
export function calcularNota(perfil: PerfilConcurso, avaliacao: AvaliacaoIA, linhas: string[], estimadas = false): CalculoNota {
  const { consideradas, descartadas } = linhasConsideradas(linhas, perfil, estimadas);
  const escritas = consideradas.filter((l) => l.trim()).length;
  const tl = Math.min(escritas, perfil.linhasMax);
  const excedenteEstimado = estimadas ? Math.max(0, escritas - perfil.linhasMax) : 0;

  const criterios = perfil.criterios.map((c) => {
    const bruta = Number(avaliacao.criterios[c.sigla]?.nota ?? 0);
    const nota = arredondar(Math.min(c.maximo, Math.max(0, Number.isFinite(bruta) ? bruta : 0)));
    return { sigla: c.sigla, nome: c.nome, nota, maximo: c.maximo };
  });
  const dq = arredondar(criterios.reduce((s, c) => s + c.nota, 0));
  const ne = errosValidos(avaliacao, estimadas ? consideradas.length : perfil.linhasMax).length;

  let zero: MotivoZero | null = null;
  if (tl === 0) zero = "sem_texto";
  else if (tl < perfil.linhasMin) zero = "menos_linhas";
  else if (avaliacao.fugaAoTema) zero = "fuga_tema";
  else if (avaliacao.identificacaoIndevida) zero = "identificacao";

  const nqCalculada = tl > 0 ? arredondar(perfil.formula({ dq, ne, tl })) : 0;
  const nq = zero ? 0 : Math.max(0, nqCalculada);
  return { criterios, dq, ne, tl, nqCalculada, nq, zero, linhasDescartadas: descartadas, excedenteEstimado };
}

/** Erros que contam no NE: com linha dentro das linhas consideradas. */
export function errosValidos(avaliacao: AvaliacaoIA, ultimaLinha: number): AvaliacaoIA["errosPortugues"] {
  return avaliacao.errosPortugues.filter((e) => Number.isInteger(e.linha) && e.linha >= 1 && e.linha <= ultimaLinha);
}

/** 17.789 → "17,79". */
export function formatarNumero(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/**
 * Quebra um texto longo em mensagens de WhatsApp (o limite do WhatsApp é 4096 caracteres).
 * Corta entre parágrafos; só parte um parágrafo se ele sozinho passar do limite.
 */
export function dividirMensagem(texto: string, max = 4000): string[] {
  const partes: string[] = [];
  let atual = "";
  for (const paragrafo of texto.split("\n\n")) {
    const pedacos = paragrafo.length > max ? (paragrafo.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) ?? []) : [paragrafo];
    for (const p of pedacos) {
      if (atual && atual.length + 2 + p.length > max) {
        partes.push(atual);
        atual = p;
      } else {
        atual = atual ? `${atual}\n\n${p}` : p;
      }
    }
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}
