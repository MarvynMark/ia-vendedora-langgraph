// Conteúdo real dos templates de WhatsApp — usado para enviar mensagem normal
// quando o lead já está dentro da janela de 24h (template não é necessário)
export const CONTEUDO_TEMPLATES: Record<string, string> = {
  // --- Abertura inicial (Novo Lead) — variável {{1}} = primeiro nome do lead ---
  // Gancho de curiosidade ("tem uma coisa que eu queria te falar"): puxa muito mais
  // resposta que a pergunta genérica anterior ("já está estudando ou se organizando?").
  // Nome/idioma na Meta: abertura02 / pt_BR.
  abertura02:
    "Oi, [Nome]! Aqui é o Perito Walker. Recebi seu formulário da mentoria e estou lendo suas respostas.\n\nTem uma coisa ali que você escreveu que quero te falar.\nEstá podendo agora? 👀",

  // --- Sequência de recuperação: Primeira mensagem (lead não respondeu a abertura) ---
  // variável {{1}} = primeiro nome. Cada mensagem traz um ângulo NOVO (reforço → prova social
  // → urgência), em vez de só perguntar "cadê você?". Template (janela fechada) ou msg normal (aberta).
  fup1_reforco:
    "Oi [Nome], imagino que a rotina tá corrida.\n\nMas separei um tempo pra ver seu caso e não quero que você perca essa chance. Me dá um oi rapidinho?",
  fup2_prova_social:
    "Ei [Nome], essa semana tivemos mais alunos aprovando em Perito.\n\nO que eles têm em comum é que começaram com direção, não sozinhos. Ainda dá tempo de você entrar nesse caminho. Quer que eu te mostre como?",
  fup3_urgencia:
    "Olha [Nome], tô organizando minha agenda de análises e não quero deixar seu caso de fora.\n\nSe ainda quer a aprovação como Perito, me manda um \"sim\" que eu priorizo seu direcionamento hoje.",

  // --- Compartilhados por outras sequências (lembrete/conexão/pós-preço) ---
  ta_ai: "Olá, tá por ai?",
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

// Metadados por template aprovado na Meta (idioma e cabeçalho de mídia, quando houver).
// enviarTemplate() consulta este mapa: templates ausentes aqui usam o default (pt_BR, sem mídia),
// então as sequências antigas continuam funcionando sem alteração.
export interface TemplateMeta {
  /** Código do idioma como cadastrado na Meta (ex: "pt_BR", "en"). */
  language: string;
  /** URL PÚBLICA da imagem do cabeçalho (só para templates com header de mídia). */
  mediaUrl?: string;
  mediaType?: "image" | "video" | "document";
}

export const TEMPLATE_META: Record<string, TemplateMeta> = {
  // Abertura criada em Portuguese (BR)
  abertura02: { language: "pt_BR" },
  // Sequência de recuperação criada em English (o texto do corpo é português mesmo)
  fup1_reforco: { language: "en" },
  // fup2 tem cabeçalho de imagem (prova social visual) — precisa da URL pública da imagem
  fup2_prova_social: {
    language: "en",
    mediaUrl: "", // TODO: preencher com a URL pública da imagem (ex: hospedar no s3.stkd.site)
    mediaType: "image",
  },
  fup3_urgencia: { language: "en" },
};
