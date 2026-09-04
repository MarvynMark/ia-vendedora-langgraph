// Detecta que o lead esbarrou numa objeção, para avisar o grupo do comercial e um humano poder
// entrar antes de o lead sumir.
//
// Função PURA e sem I/O de propósito, mesmo motivo de alerta-novo-aluno.ts: é a regra que decide
// se o time é interrompido, então precisa ser testável sem tocar Chatwoot nem o grafo.
//
// Por que regex e não LLM: é o padrão do projeto para regra que precisa ser confiável, e uma
// chamada de modelo por turno traria de volta o custo e o risco de alucinação que acabamos de
// tirar do formatador (convs 6907/6941/6943).

export type TipoObjecao = "preco" | "adiamento" | "pagamento";

export const ROTULO_OBJECAO: Record<TipoObjecao, string> = {
  preco: "travou no preço",
  adiamento: "adiou a decisão",
  pagamento: "travou na forma de pagamento",
};

function normalizar(texto: string): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acento: "não" e "nao" viram a mesma coisa
    .replace(/\s+/g, " ")
    .trim();
}

// Frases em que as palavras-gatilho aparecem SEM ser objeção. Testadas antes de qualquer padrão:
// "achei caro no começo mas vale a pena" é entusiasmo, "não vou pensar duas vezes" é compra.
const EXCECOES: RegExp[] = [
  /\bmas vale a pena\b/,
  /\bvale (muito )?a pena\b/,
  /\bnao vou pensar duas vezes\b/,
  /\bnem vou pensar\b/,
  /\bnao precisa pensar\b/,
  /\bja pensei\b/,
  /\bparei de pensar\b/,
  /\bpensando bem\b/,
  /\bja (decidi|resolvi)\b/,
  /\bnao (e|acho) caro\b/,
  /\bmais barato que\b/,
  /\bnao (tenho|tive) duvida\b/,
];

// "quanto custa" / "qual o valor" é PERGUNTA de preço, não objeção — o lead pedindo o pitch.
// Avisar o comercial aqui seria avisar de um lead avançando bem.
const PERGUNTA_DE_PRECO =
  /\b(quanto (custa|fica|e|sai|seria)|qual (o|e o) (valor|preco|investimento)|quais (os )?(valores|precos)|me (fala|diz|passa) (o )?(valor|preco)|tem (algum )?(valor|preco))\b/;

const PADROES: Array<{ tipo: TipoObjecao; re: RegExp }> = [
  // --- PREÇO: o valor em si é o obstáculo ---
  { tipo: "preco", re: /\b(ta|esta|e|achei|acho) (muito |meio |bem )?(caro|salgado|puxado)\b/ },
  { tipo: "preco", re: /\bcaro (demais|pra mim|pro meu bolso)\b/ },
  { tipo: "preco", re: /\bfora do meu (orcamento|alcance)\b/ },
  { tipo: "preco", re: /\bnao (tenho|teria|tenho como) (esse|este|todo esse|tanto) (valor|dinheiro)\b/ },
  { tipo: "preco", re: /\bnao (tenho|tenho como) (condicoes|condicao)\b/ },
  // O complemento é obrigatório: sem ele, "to sem tempo" viraria objeção de preço.
  { tipo: "preco", re: /\b(to|estou|tamo|tava) sem (dinheiro|grana|condicoes|condicao|verba|dindin)\b/ },
  { tipo: "preco", re: /\b(to|estou|tava) (apertad[oa]|quebrad[oa]|dur[oa])\b/ },
  // O negative lookahead evita ler "não consigo pagar por pix (pelo horário)" como falta de
  // dinheiro: ali o lead está TENTANDO pagar e travou no meio — isso é forma de pagamento, e cai
  // no padrão específico lá embaixo (conv 6363, pego no dry-run).
  { tipo: "preco", re: /\bnao (posso|consigo|da pra|tenho como|teria como) pagar(?! ?(por|no|na|com|via|em) ?(pix|boleto|cartao|credito|debito))\b/ },
  { tipo: "preco", re: /\bacima do que (eu )?(posso|consigo|esperava)\b/ },
  { tipo: "preco", re: /\btem (algo|alguma coisa|algum plano|outro plano|opcao) mais (barato|em conta|acessivel)\b/ },
  { tipo: "preco", re: /\b(o|algum) mais (barato|em conta)\b/ },
  { tipo: "preco", re: /\bnao cabe no (meu )?(bolso|orcamento)\b/ },

  // --- ADIAMENTO: o lead empurra a decisão pra frente ---
  // "ver" sozinho fica FORA: "onde vou ver o encontro ao vivo?" não é objeção, é dúvida de aluno
  // engajado (conv 6698, pego no dry-run). Só entra com complemento que indique adiamento.
  { tipo: "adiamento", re: /\bvou (pensar|analisar|avaliar)\b/ },
  { tipo: "adiamento", re: /\bvou ver (se|com calma|direitinho|direito|isso (com calma|depois))\b/ },
  { tipo: "adiamento", re: /\b(preciso|tenho que|vou ter que) (pensar|analisar|avaliar|ver melhor)\b/ },
  { tipo: "adiamento", re: /\bme da(r)? um tempo (pra|para) pensar\b/ },
  { tipo: "adiamento", re: /\b(vou|preciso|tenho que|vou ter que|tenho de) ?(ter que )?(falar|conversar|ver|combinar|alinhar|decidir) com (o |a )?(meu|minha) (esposo|esposa|marido|mulher|namorad[oa]|mae|pai|familia|companheir[oa])\b/ },
  { tipo: "adiamento", re: /\bdepois eu (vejo|te falo|retorno|penso)\b/ },
  { tipo: "adiamento", re: /\bte (falo|aviso|retorno|chamo) (depois|amanha|semana que vem|mes que vem|outro dia)\b/ },
  { tipo: "adiamento", re: /\b(mes|semana) que vem eu?( )?(vejo|falo|fecho|entro|comeco)\b/ },
  { tipo: "adiamento", re: /\bagora nao (da|posso|consigo|e possivel|e o momento)\b/ },
  { tipo: "adiamento", re: /\bnao (e|esta|ta) (o )?(meu )?momento\b/ },
  { tipo: "adiamento", re: /\bmais (pra )?frente\b/ },

  // --- PAGAMENTO: quer comprar, mas o meio de pagamento trava ---
  { tipo: "pagamento", re: /\bnao tenho (cartao|cartao de credito)\b/ },
  { tipo: "pagamento", re: /\b(sem|nao tenho) limite\b/ },
  { tipo: "pagamento", re: /\b(meu )?cartao (nao )?(tem limite|nao passa|nao cobre|esta estourado|ta estourado|nao vai dar)\b/ },
  { tipo: "pagamento", re: /\b(so|somente|apenas)( consigo| posso| tenho| da| dava| aceito| pago| faco)?( no| por| via| em)? (pix|boleto)\b/ },
  { tipo: "pagamento", re: /\b(da pra|tem como|aceita|aceitam|pode ser|posso)( pagar| fazer| parcelar)?( no| por| via| em)? (pix|boleto)\b/ },
  { tipo: "pagamento", re: /\bcartao (virou|vira|fecha|fechou) dia\b/ },
  // Tentou pagar e travou no meio (horário do PIX, boleto que não abriu). Lead quente, não objeção
  // de dinheiro — o time precisa entrar rápido aqui.
  { tipo: "pagamento", re: /\bnao (consigo|posso|deu pra|da pra|to conseguindo) (pagar|fazer|gerar) ?(por|no|na|com|via|em)? ?(pix|boleto|cartao)\b/ },
];

/**
 * Classifica a fala do lead numa das objeções que interessam ao comercial, ou null.
 *
 * Ordem importa: preço vem antes de adiamento, porque "tá caro, vou pensar" é uma objeção de
 * preço fantasiada de adiamento — é o valor que trava, e é isso que o humano precisa saber.
 */
export function classificarObjecao(texto: string): TipoObjecao | null {
  const bruto = texto ?? "";

  // [SISTEMA: ...] é injeção interna do grafo (ver graph.ts), não fala do lead.
  if (bruto.trimStart().startsWith("[SISTEMA:")) return null;

  // Áudio transcrito chega embrulhado em <mensagem-de-audio> (message-processor.ts).
  const t = normalizar(bruto.replace(/<\/?mensagem-de-audio>/g, " "));
  if (!t) return null;

  if (EXCECOES.some((re) => re.test(t))) return null;

  const achado = PADROES.find(({ re }) => re.test(t));
  if (!achado) return null;

  // Pergunta de preço só desqualifica quando não há outra objeção junto: em "quanto custa? porque
  // tá fora do meu orçamento" o lead está objetando, não só perguntando.
  if (achado.tipo === "preco" && PERGUNTA_DE_PRECO.test(t)) {
    const outra = PADROES.find(({ tipo, re }) => tipo !== "preco" && re.test(t));
    return outra ? outra.tipo : null;
  }

  return achado.tipo;
}

export interface DadosAlertaObjecao {
  tipo: TipoObjecao;
  nome: string;
  telefone: string;
  /** A fala do lead que disparou a detecção. */
  fala: string;
  /** Deep link da conversa no Chatwoot. */
  link: string;
}

export function montarAlertaObjecao(dados: DadosAlertaObjecao): string {
  const nome = dados.nome?.trim() || "(sem nome)";
  const fala = dados.fala.replace(/<\/?mensagem-de-audio>/g, "").trim().slice(0, 400);
  return [
    `⚠️ *Lead ${ROTULO_OBJECAO[dados.tipo]}* — ${nome} (${dados.telefone})`,
    "",
    `"${fala}"`,
    "",
    `👉 ${dados.link}`,
  ].join("\n");
}
