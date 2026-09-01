import { planosCitados, type PlanoId } from "./planos.ts";

// TRAVA DE CARDÁPIO: no máximo DOIS planos com preço por turno.
//
// Diagnóstico de 25/08: dos 36 leads que ouviram o pitch da IA desde 17/08, 14 ouviram TRÊS ou
// mais preços (a conv 5917 ouviu OITO). O gatilho é sempre o mesmo: o lead pergunta "tem outro
// plano?" e o agente responde listando Anual + Semestral + Trimestral e fecha com "qual desses
// encaixa melhor?", devolvendo a decisão pro lead. O prompt proíbe e é desobedecido, então a
// trava é em código.
//
// O pitch apresenta DOIS planos de propósito (o Anual recomendado + o Semestral como alternativa,
// decididos pela descoberta de material), então o limite é dois — o terceiro é que vira cardápio.
// O Trimestral só pode aparecer num turno posterior, depois de o lead recusar o Semestral.
//
// O escopo é o TURNO, não a conversa: o downsell legítimo acontece num turno seguinte e continua
// permitido.
//
// Vive aqui, e não junto dos filtros `bloco*` de services/chatwoot.ts, porque é lógica pura —
// e porque os testes que mockam o módulo de chatwoot inteiro apagariam esta função.
const MAX_PLANOS_POR_TURNO = 2;

const planosDoTurno = new Map<string, PlanoId[]>();
const travouNoTurno = new Set<string>();

/** Zera os planos já apresentados. Chamado no início de cada envio de texto ao lead. */
export function iniciarTurnoDePreco(idConversa: string | number): void {
  planosDoTurno.delete(String(idConversa));
  travouNoTurno.delete(String(idConversa));
}

/** True se a frase traz o preço de um plano ALÉM dos dois já apresentados neste turno. */
export function blocoIntroduzSegundoPlano(idConversa: string | number, bloco: string): boolean {
  const chave = String(idConversa);
  const jaVistos = planosDoTurno.get(chave) ?? [];
  const citados = planosCitados(bloco, jaVistos[0] ?? null);
  if (citados.length === 0) return false; // frase sem preço: sempre passa

  const novos = citados.filter((p) => !jaVistos.includes(p));
  if (novos.length === 0) return false; // repete um plano que já foi: passa (ex.: parcelado do mesmo)

  // A PRIMEIRA frase com preço sempre passa, mesmo que traga os dois planos de uma vez: derrubá-la
  // deixaria o lead sem preço nenhum, que é pior que ouvir dois.
  if (jaVistos.length === 0) {
    planosDoTurno.set(chave, citados);
    return false;
  }

  if (jaVistos.length + novos.length <= MAX_PLANOS_POR_TURNO) {
    planosDoTurno.set(chave, [...jaVistos, ...novos]);
    return false;
  }

  travouNoTurno.add(chave);
  return true;
}

// "Qual desses planos encaixa melhor no seu momento?" — quando a trava acima derruba um plano,
// uma pergunta de escolha que se referia a ele fica órfã ("qual desses?" apontando pra algo que o
// lead não recebeu), o que é pior que o cardápio.
const RE_ESCOLHA_DE_CARDAPIO =
  /qu(al|ais)\s+(desses|dessas|destes|destas|delas|deles)\b|qual\s+(plano|op[çc][ãa]o)\s+(voc[êe]|faz|encaixa|prefere)/i;

// O fecho OFICIAL do pitch ("Qual desses encaixa melhor pro seu momento? O Anual Completo ou o
// Semestral? Pode ser transparente comigo.") casa com o regex acima, mas nomeia os dois planos que
// SOBREVIVEM à trava — nunca é órfão. Sem esta exceção, um turno em que a trava barrasse um
// terceiro plano deixaria o lead com os preços e sem nenhuma pergunta.
const RE_FECHO_OFICIAL = /transparente comigo/i;

/** True se a frase pede ao lead que escolha entre planos que a trava acabou de remover do turno. */
export function blocoPerguntaEscolhaDeCardapio(idConversa: string | number, bloco: string): boolean {
  if (!travouNoTurno.has(String(idConversa))) return false;
  if (RE_FECHO_OFICIAL.test(bloco ?? "")) return false;
  return RE_ESCOLHA_DE_CARDAPIO.test(bloco ?? "");
}
