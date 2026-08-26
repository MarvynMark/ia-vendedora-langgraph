import { planosCitados, type PlanoId } from "./planos.ts";

// TRAVA DE CARDÁPIO: no máximo UM plano com preço por turno.
//
// Diagnóstico de 25/08: dos 36 leads que ouviram o pitch da IA desde 17/08, só 1 ouviu um único
// preço; 21 ouviram dois e 14 ouviram três ou mais (a conv 5917 ouviu OITO). O gatilho é sempre o
// mesmo: o lead pergunta "tem outro plano?" e o agente responde listando Anual + Semestral +
// Trimestral e fecha com "qual desses encaixa melhor?", devolvendo a decisão pro lead. O prompt já
// proíbe isso e é desobedecido, então a trava é em código: ancora no primeiro plano cujo preço
// aparece no turno e derruba as frases que trouxerem preço de outro plano.
//
// O escopo é o TURNO, não a conversa: o downsell legítimo (Semestral depois de o lead recusar o
// Anual) acontece num turno posterior e continua permitido.
//
// Vive aqui, e não junto dos filtros `bloco*` de services/chatwoot.ts, porque é lógica pura —
// e porque os testes que mockam o módulo de chatwoot inteiro apagariam esta função.
const planoAncoradoNoTurno = new Map<string, PlanoId>();
const travouNoTurno = new Set<string>();

/** Zera a âncora de plano. Chamado no início de cada envio de texto ao lead. */
export function iniciarTurnoDePreco(idConversa: string | number): void {
  planoAncoradoNoTurno.delete(String(idConversa));
  travouNoTurno.delete(String(idConversa));
}

/** True se a frase traz o preço de um plano DIFERENTE do já ancorado neste turno. */
export function blocoIntroduzSegundoPlano(idConversa: string | number, bloco: string): boolean {
  const chave = String(idConversa);
  const ancorado = planoAncoradoNoTurno.get(chave) ?? null;
  const citados = planosCitados(bloco, ancorado);
  if (citados.length === 0) return false; // frase sem preço: sempre passa
  if (!ancorado) {
    // A PRIMEIRA frase com preço sempre passa, mesmo que traga dois planos de uma vez: derrubá-la
    // deixaria o lead sem preço nenhum, que é pior que ouvir dois. Ela ancora o turno e as demais
    // ficam travadas — o cardápio de 8 preços da conv 5917 vira, no pior caso, o par da frase.
    planoAncoradoNoTurno.set(chave, citados[0]!);
    return false;
  }
  const trava = citados.some((p) => p !== ancorado);
  if (trava) travouNoTurno.add(chave);
  return trava;
}

// "Qual desses planos encaixa melhor no seu momento?" — o fecho que devolve a decisão pro lead.
// O prompt proíbe, mas quando o LLM desobedece e a trava acima derruba os outros planos, essa
// pergunta fica órfã ("qual desses?" com um plano só na tela), o que é pior que o cardápio.
const RE_ESCOLHA_DE_CARDAPIO =
  /qu(al|ais)\s+(desses|dessas|destes|destas|delas|deles)\b|qual\s+(plano|op[çc][ãa]o)\s+(voc[êe]|faz|encaixa|prefere)/i;

/** True se a frase pede ao lead que escolha entre planos que a trava acabou de remover do turno. */
export function blocoPerguntaEscolhaDeCardapio(idConversa: string | number, bloco: string): boolean {
  if (!travouNoTurno.has(String(idConversa))) return false;
  return RE_ESCOLHA_DE_CARDAPIO.test(bloco ?? "");
}
