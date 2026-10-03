// TRAVA DE MARCADOR DO ROTEIRO — nenhum colchete do prompt chega ao lead.
//
// O roteiro é escrito com marcadores entre colchetes pro modelo preencher ("[eco curto da dor
// dele]", "[do concurso]", "[o problema que ele relatou, com a palavra dele]"). Quando a fala do
// lead não dá um eco óbvio ("Não tenho nada no momento"), o modelo copia a bolha com o marcador
// literal (conv 9486, 02/10: a Mensagem 7 inteira saiu com os três colchetes). O filtro de jargão
// só pegava a bolha que era INTEIRA um colchete; aqui vale qualquer colchete no meio do texto.
//
// Mensagem de WhatsApp de venda não tem colchete legítimo. A única exceção é link em markdown
// ("[texto](url)"), que não é marcador.

const MARCADOR = /\[[^\]\n]{1,200}\](?!\()/;
const MARCADOR_GLOBAL = /\[[^\]\n]{1,200}\](?!\()/g;

export function temMarcadorDoRoteiro(texto: string): boolean {
  return MARCADOR.test(texto ?? "");
}

export function marcadoresDoRoteiro(texto: string): string[] {
  return (texto ?? "").match(MARCADOR_GLOBAL) ?? [];
}

/**
 * Último recurso, quando nem a reescrita preencheu: arranca o marcador e conserta a pontuação em
 * volta. "[eco], e olha, a hora é agora" → "E olha, a hora é agora"; "quando o edital [do
 * concurso] sair" → "quando o edital sair". O texto fica menos pessoal, mas nunca expõe o roteiro.
 */
export function removerMarcadoresDoRoteiro(texto: string): string {
  return (texto ?? "")
    .split("\n")
    .map((linha) => {
      if (!temMarcadorDoRoteiro(linha)) return linha;
      // Linha que era só marcador some de vez (null), sem deixar buraco no texto.
      const limpa = linha
        .replace(MARCADOR_GLOBAL, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([,;:])\s*([.!?])/g, "$2")
        .replace(/^[\s,;:.]+/, "")
        .replace(/([.!?]\s+)[,;:]\s*/g, "$1")
        .trim();
      return limpa ? limpa.charAt(0).toUpperCase() + limpa.slice(1) : null;
    })
    .filter((linha): linha is string => linha !== null)
    .join("\n")
    .trim();
}

export function instrucaoPreencherMarcadores(texto: string): string {
  const achados = marcadoresDoRoteiro(texto).slice(0, 4).join(", ");
  return (
    `[SISTEMA: sua resposta saiu com marcador do roteiro entre colchetes (${achados}). Isso iria ` +
    "literal pro WhatsApp do lead. Reescreva a MESMA resposta substituindo cada colchete pelo " +
    "conteúdo real desta conversa: a dor que o lead contou com a palavra dele, o concurso dele. Se " +
    "ele não trouxe uma dor, use a maior dificuldade do formulário; se não houver dado, reescreva a " +
    "frase sem aquele trecho. Nenhum colchete pode aparecer. Não chame nenhuma ferramenta.]"
  );
}
