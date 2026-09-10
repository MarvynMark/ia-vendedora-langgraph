// Tier do lead a partir da resposta de "disposto a investir" no formulário de aplicação.
//
// A pergunta voltou ao formulário em 10/09/2026. Ela tinha sido removida em fd5f750 (24/07) com a
// justificativa registrada de que "a qualificação hoje é da IA, não de humano, então virou um fluxo
// só para todos" — premissa que caiu quando o funil passou a agendar sessão estratégica com humano.
//
// ⚠️ O tier NÃO decide quem é convidado para a sessão: quem decide isso é `env.FUNIL_CALL`. Ele
// existe para MEDIR. Sem separar os dois grupos não dá para comparar taxa de aceite, comparecimento
// e fechamento no fim do teste — e é essa comparação que decide se o funil segue convidando todo
// mundo ou volta a filtrar. Usar o tier como porta jogaria fora 1 em cada 9 vendas: dos 671
// compradores rotulados na planilha, 75 (11,2%) tinham respondido que NÃO teriam condição.
//
// Base histórica (fev–jun/2026, 1.997 leads da planilha de aplicação, medindo compradores sobre o
// total de cada tier — medida imune à cobertura irregular de rotulagem):
//   "sim" → 151/1096 = 13,8%  IC95% [11,7% – 15,8%]
//   "não" →  18/901  =  2,0%  IC95% [ 1,1% –  2,9%]
//   lift 6,9x · χ² = 88,6 · p < 0,0001
//
// As duas alternativas do formulário são texto fixo e o histórico depende delas: mudar o texto das
// opções quebra a comparabilidade com a série acima.

export type TierLead = "sim" | "nao";

export const ETIQUETA_TIER: Record<TierLead, string> = {
  sim: "investe-sim",
  nao: "investe-nao",
};

// Etiquetas NOVAS de propósito. As antigas "sim"/"nao" foram aposentadas junto com a remoção da
// pergunta e repontadas para "agente-on"; reusar aquele nome religaria gatilhos velhos.

/**
 * Classifica a resposta da pergunta de investimento.
 * Retorna `null` quando o lead não respondeu (formulário antigo, campo ausente ou vazio) — nesse
 * caso o lead não entra em nenhum dos dois grupos da medição.
 */
export function tierDoLead(resposta: string | null | undefined): TierLead | null {
  const texto = (resposta ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (!texto) return null;
  // Casa pelo INÍCIO da resposta ("Sim, é o que eu quero!" / "Infelizmente não no momento!") e não
  // por busca solta: a alternativa negativa é uma frase inteira, e procurar "nao" em qualquer
  // posição casaria também em respostas livres se o formulário virar campo aberto um dia.
  if (texto.startsWith("sim")) return "sim";
  if (texto.startsWith("infelizmente") || texto.startsWith("nao")) return "nao";
  return null;
}
