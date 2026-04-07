// Conteúdo real dos templates de WhatsApp — usado para enviar mensagem normal
// quando o lead já está dentro da janela de 24h (template não é necessário)
export const CONTEUDO_TEMPLATES: Record<string, string> = {
  // --- Abertura inicial (Novo Lead) ---
  abertura_esta_estudando:
    "Olá, tudo bem?\n\nAqui é o Pedro, do time do Perito Walker.\nAcabei de ver sua aplicação pra mentoria e preciso confirmar uma informação rapidinho antes de seguir com a análise.\n\nHoje você já está estudando pra algum concurso de Perito ou ainda está se organizando?",

  // --- Sequência de recuperação: Primeira mensagem ---
  // Usados como template (janela fechada) ou mensagem normal (janela aberta)
  ta_ai: "Olá, tá por ai?",
  corrido_followup: "Opa, sei que deve estar corrido por aí, mas você conseguiu ver minha mensagem anterior?",
  olhinho_followup: "👀",
  encerramento_02:
    "Como você não respondeu, vou encerrar seu atendimento por aqui para organizar as prioridades.\nSe decidir começar sua preparação de forma estratégica, me chama aqui, ok?",

  // --- Sequência de recuperação: Conexão ---
  // Leads que já conversaram mas pararam de responder
  // Quando fora da janela 24h, reutiliza os templates da Primeira mensagem (ta_ai, corrido_followup, olhinho_followup)
  conexao_followup_1: "Oi [Nome], sumiu! Ficou alguma dúvida sobre o que conversamos?",
  conexao_followup_2: "Opa, sei que deve estar corrido, mas você conseguiu ver minha última mensagem?",
  conexao_followup_3: "👀",
  conexao_encerramento:
    "Oi [Nome], vou deixar o espaço livre por aqui. Se decidir avançar com a mentoria, é só me chamar. Sucesso nos estudos!",

  // --- Sequência de lembrete: Aguardando Pagamento ---
  lembrete_1: "Oi [Nome], o link ainda tá disponível se você quiser garantir sua vaga. Ficou alguma dúvida antes de confirmar?",
  lembrete_2: "Ei [Nome], só passando pra saber se conseguiu ver as informações que te mandei.",
  lembrete_3: "👀",
  lembrete_encerramento:
    "Oi [Nome], como não consegui retorno, vou liberar sua vaga por enquanto. Se decidir avançar com a mentoria depois, é só me chamar!",
};
