// Regras de acentuação e crase calculadas pelo CÓDIGO, não pela IA.
//
// No teste de 13/10/2026 a IA explicou "código" como paroxítona e "caráter" como oxítona, e pôs a
// crase de "quanto às" em acentuação. Regra errada ensina o erro. Aqui a classificação sai da
// posição do acento na palavra corrigida: as vogais depois da sílaba tônica dizem se ela é
// oxítona, paroxítona ou proparoxítona. Quando o caso não cabe com segurança (hiato, til), devolve
// null e fica a explicação da IA.

const VOGAIS = "aeiouáéíóúâêôãõàü";
const TONICAS = "áéíóúâêô";

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Pares de palavras que só diferem pelos acentos (trecho do aluno → correção). */
function palavrasAcentuadas(trecho: string, correcao: string): Array<[string, string]> {
  const a = trecho.toLowerCase().match(/[a-zà-ü]+/g) ?? [];
  const b = correcao.toLowerCase().match(/[a-zà-ü]+/g) ?? [];
  if (a.length !== b.length) return [];
  return a.flatMap((x, i) => {
    const y = b[i]!;
    return x !== y && semAcento(x) === semAcento(y) ? [[x, y] as [string, string]] : [];
  });
}

/** Quantos grupos vocálicos vêm depois da vogal tônica (≈ sílabas depois da tônica). */
function silabasDepoisDaTonica(palavra: string, posTonica: number): number {
  let grupos = 0;
  let dentro = false;
  for (const ch of palavra.slice(posTonica + 1)) {
    const vogal = VOGAIS.includes(ch);
    if (vogal && !dentro) grupos++;
    dentro = vogal;
  }
  return grupos;
}

const PAROXITONA_TERMINACOES: Array<[RegExp, string]> = [
  [/(i|u)[aeo]s?$/, "ditongo"],
  [/r$/, "-r"], [/x$/, "-x"], [/n$/, "-n"], [/l$/, "-l"], [/ps$/, "-ps"],
  [/[ãõ]s?$|ãos?$/, "-ã(s)/-ão(s)"], [/is?$/, "-i(s)"], [/us$/, "-us"], [/uns?$|um$/, "-um/-uns"], [/ons?$/, "-om/-ons"],
];

export interface RegraLingua {
  tipo: "acentuação" | "crase";
  regra: string;
}

/**
 * Regra certa para um erro de acento/crase, ou null se não for um desses casos (ou se não der
 * para classificar com segurança).
 */
export function regraDeterministica(trecho: string, correcao: string): RegraLingua | null {
  const pares = palavrasAcentuadas(trecho, correcao);
  if (!pares.length) return null;
  const [, certa] = pares[0]!;

  if (certa === "à" || certa === "às") {
    return {
      tipo: "crase",
      regra: `Crase é a fusão da preposição "a" com o artigo "a(s)": quando o termo que pede a preposição (ex.: "quanto a", "referente a") vem antes de palavra feminina com artigo, escreve-se "${certa}".`,
    };
  }

  const pos = [...certa].findIndex((ch) => TONICAS.includes(ch));
  if (pos < 0) return null; // só til (ã, õ) marca nasalidade, não a sílaba tônica
  const depois = silabasDepoisDaTonica(certa, pos);

  if (depois >= 2) {
    return { tipo: "acentuação", regra: `"${certa}" é proparoxítona (tônica na antepenúltima sílaba), e toda proparoxítona leva acento.` };
  }
  if (depois === 1) {
    const term = PAROXITONA_TERMINACOES.find(([re]) => re.test(certa));
    if (!term) return null; // provável hiato (ex.: "saúde"): fica a explicação da IA
    return term[1] === "ditongo"
      ? { tipo: "acentuação", regra: `"${certa}" é paroxítona terminada em ditongo, e paroxítonas terminadas em ditongo levam acento.` }
      : { tipo: "acentuação", regra: `"${certa}" é paroxítona terminada em ${term[1]}, e paroxítonas com essa terminação levam acento.` };
  }
  if (/(a|e|o)s?$|ens?$|em$/.test(semAcento(certa))) {
    return { tipo: "acentuação", regra: `"${certa}" é oxítona (tônica na última sílaba) terminada em -a(s), -e(s), -o(s) ou -em/-ens, e essas oxítonas levam acento.` };
  }
  return null;
}

/** Troca tipo e regra dos erros de acento/crase pelos calculados aqui. */
export function corrigirRegrasDeLingua<T extends { trecho: string; correcao: string; tipo: string; regra: string }>(erros: T[]): T[] {
  return erros.map((e) => {
    const r = regraDeterministica(e.trecho, e.correcao);
    return r ? { ...e, tipo: r.tipo, regra: r.regra } : e;
  });
}
