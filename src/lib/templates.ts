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

  // --- Sequência de recuperação: Conexão (janela aberta) ---
  // Leads que já conversaram mas pararam de responder
  conexao_followup_1: "Oi [Nome], ficou alguma dúvida sobre o que conversamos? Pode falar sem compromisso",
  conexao_followup_2: "Ei [Nome], sei que a rotina aperta. Quando tiver 2 minutos, me conta o que ficou pendente",
  conexao_followup_3: "👀",
  conexao_encerramento:
    "Oi [Nome], vou deixar o espaço livre por aqui. Se decidir avançar com a mentoria, é só me chamar. Sucesso nos estudos!",

  // --- Sequência de recuperação: Conexão (janela fechada — Meta templates) ---
  conexao_duvida: "Ficou alguma dúvida sobre o que conversamos? Pode me chamar aqui sem compromisso",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)

  // --- Sequência pós-preço: Conexão (janela aberta) ---
  // Acionada quando lead viu o pitch de preço e sumiu (description contém "status: proposta_apresentada")
  pos_preco_followup_1: "Oi [Nome], ficou alguma dúvida sobre o investimento?",
  pos_preco_followup_2:
    "Ei [Nome], caso o valor tenha pesado, temos o semestral em 12x de R$ 197 também — qual parcela ficaria melhor pra você?",
  pos_preco_followup_3: "👀",
  pos_preco_encerramento:
    "Oi [Nome], vou deixar o espaço livre. Se quiser retomar quando fizer sentido, é só me chamar",

  // --- Sequência pós-preço: Conexão (janela fechada — Meta templates) ---
  pos_preco_duvida: "Ficou alguma dúvida sobre o investimento? Me conta aqui que a gente resolve",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)

  // --- Sequência de lembrete: Aguardando Pagamento (janela aberta) ---
  lembrete_1: "Oi [Nome], o link ainda tá ativo. Ficou com alguma dúvida antes de confirmar?",
  lembrete_2:
    "Ei [Nome], quando confirmar o pagamento já te envio todos os acessos na hora pra você começar ainda hoje",
  lembrete_3: "👀",
  lembrete_urgencia:
    "Oi [Nome], vou liberar sua vaga amanhã se não tiver retorno. Ainda consigo segurar até lá — quer confirmar?",
  lembrete_encerramento:
    "Oi [Nome], vou liberar sua vaga por ora. Se quiser retomar, é só me chamar — o link pode ser reativado",

  // --- Sequência de lembrete: Aguardando Pagamento (janela fechada — Meta templates) ---
  lembrete_acesso:
    "Quando você confirmar o pagamento, te envio todos os acessos na hora pra começar ainda hoje",
  lembrete_urgencia_meta:
    "Vou liberar sua vaga amanhã se não tiver retorno. Ainda consigo segurar até lá — quer confirmar?",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)
};
