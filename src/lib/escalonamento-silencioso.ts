// Escalar_humano é uma ação SILENCIOSA: pausa o atendimento e avisa a equipe no grupo. O lead
// não pode saber que foi transferido.
//
// O prompt já dizia isso em maiúsculas ("NÃO avise o lead que vai transferir... Proibido frases
// como 'vou te encaminhar'") e o modelo escreveu mesmo assim, na conv 4014, logo depois de o lead
// perceber que falava com uma IA:
//
//   lead › Tá respondendo via IA / KKKK / PQP
//   IA   › Vou passar essa questão para um humano da equipe te ajudar diretamente com isso.
//   IA   › Eles vão entrar em contato com você em breve para resolver essa diferença no valor.
//
// Isso confirma o que o lead acabou de acusar e entrega a operação. Prompt não segura; aqui a
// bolha é removida antes de sair, com ou sem a tool chamada — anunciar transferência é errado
// mesmo quando o modelo esqueceu de escalar (nesse caso o grafo escala por ele).

/** Frases que revelam a passagem para um humano. Só o que ENTREGA a transferência. */
const RE_ANUNCIA_ESCALACAO = [
  // "vou passar/encaminhar/transferir (isso|você|sua dúvida) para (um humano|a equipe|o suporte|alguém)"
  /\b(vou|vamos|irei|posso)\s+(te\s+)?(passar|encaminhar|transferir|direcionar|repassar|chamar)\b[^.!?]{0,60}\b(humano|pessoa|equipe|suporte|atendente|colega|respons[áa]vel|especialista|gestor|setor|algu[ée]m|outro)\b/i,
  // "alguém/a equipe vai entrar em contato / te responder / te ajudar / assumir"
  /\b(algu[ée]m|uma pessoa|a equipe|o time|o suporte|eles|um atendente|um humano|um especialista|um colega)\b[^.!?]{0,60}\b(vai|v[ãa]o|ir[áa]|ir[ãa]o)\s+(entrar em contato|te (responder|ajudar|atender|retornar|procurar|chamar)|assumir|continuar|falar (com )?voc[êe]|cuidar)/i,
  // "já estou chamando/acionando alguém", "vou ver isso com a equipe"
  /\b(j[áa]\s+)?(estou|t[ôo]|vou)\s+(chamando|acionando|avisando|falando com|verificando com|consultando)\b[^.!?]{0,40}\b(equipe|suporte|humano|respons[áa]vel|gestor|algu[ée]m|time)\b/i,
  // "um momento que já te respondem", "aguarda que já te retornam"
  /\b(um (momento|instante)|aguarda|aguarde|s[óo] um pouco)\b[^.!?]{0,40}\b(j[áa]\s+)?(te\s+)?(respondem|retornam|atendem|chamam)\b/i,
  // "vou verificar isso com a equipe/o responsável e te retorno"
  /\bte (retorno|respondo|dou um retorno|trago a resposta)\b[^.!?]{0,40}\b(equipe|suporte|respons[áa]vel|gestor|humano)\b/i,
];

export function anunciaEscalacao(linha: string): boolean {
  return RE_ANUNCIA_ESCALACAO.some((re) => re.test(linha ?? ""));
}

/**
 * Remove do texto as frases que revelam a escalação. Trabalha por FRASE, não por linha: o modelo
 * costuma emendar o anúncio no meio de uma bolha útil ("Entendi sua dúvida. Vou passar para a
 * equipe."), e descartar o turno inteiro deixaria o lead sem resposta nenhuma.
 *
 * Devolve TAMBÉM o que foi removido, e quem chama deve olhar `removidas` — nunca comparar o texto
 * de volta com o original. A primeira versão fazia essa comparação e, como a limpeza normaliza
 * espaços, qualquer espaço duplo do modelo parecia "anúncio removido": na conv 8660 um parágrafo
 * separado por "\n \n" escalou a conversa de uma lead que estava conversando normalmente.
 */
export function removerAnuncioDeEscalacao(texto: string): { texto: string; removidas: string[] } {
  const removidas: string[] = [];
  const original = texto ?? "";
  const limpo = original
    .split("\n")
    .map((linha) => {
      if (!linha.trim()) return linha;
      const frases = linha.split(/(?<=[.!?])\s+/);
      const limpas = frases.filter((f) => {
        if (!anunciaEscalacao(f)) return true;
        removidas.push(f.trim());
        return false;
      });
      // Sem remoção, a linha volta INTACTA (nada de normalizar espaçamento à toa).
      return limpas.length === frases.length ? linha : limpas.join(" ").trim();
    })
    .join("\n");
  // Só arruma quebras e pontas quando realmente mexemos no texto.
  const texto_ = removidas.length ? limpo.replace(/\n{3,}/g, "\n\n").trim() : original;
  return { texto: texto_, removidas };
}
