// Conteúdo real dos templates de WhatsApp — usado para enviar mensagem normal
// quando o lead já está dentro da janela de 24h (template não é necessário)
export const CONTEUDO_TEMPLATES: Record<string, string> = {
  abertura_esta_estudando:
    "Olá, tudo bem?\n\nAqui é o Pedro, do time do Perito Walker.\nAcabei de ver sua aplicação pra mentoria e preciso confirmar uma informação rapidinho antes de seguir com a análise.\n\nHoje você já está estudando pra algum concurso de Perito ou ainda está se organizando?",
  ta_ai: "Olá, tá por ai?",
  corrido_followup: "Opa, sei que deve estar corrido por aí, mas você conseguiu ver minha mensagem anterior?",
  olhinho_followup: "👀",
  encerramento_02:
    "Como você não respondeu, vou encerrar seu atendimento por aqui para organizar as prioridades.\nSe decidir começar sua preparação de forma estratégica, me chama aqui, ok?",
};
