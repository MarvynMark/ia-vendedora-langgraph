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
  // Personalização: [Nome] = primeiro nome; {{ ...[concurso]... }} = segmento opcional que só
  // aparece se o concurso do lead for conhecido (via substituirCampos). NA JANELA FECHADA (template
  // Meta) a personalização de concurso NÃO chega ao lead (a Meta usa o template aprovado com só {{1}}).
  fup1_reforco:
    "Oi [Nome], imagino que a rotina tá corrida{{, ainda mais pra quem quer a aprovação em [concurso]}}.\n\nMas separei um tempo pra ver seu caso e não quero que você perca essa chance. Me dá um oi rapidinho?",
  // Prova social em TEXTO (sem cabeçalho de imagem — evita o erro Meta #132000 do Chatwoot 4.15.1).
  fup2_prova_social:
    "Ei [Nome], essa semana mais alunos meus passaram na frente estudando com direção, não sozinhos.\n\nSeu perfil tem tudo pra entrar nesse caminho. Quer que eu te mostre como?",
  fup3_urgencia:
    "Oi [Nome], uma pergunta rápida: você já sabe montar um cronograma de estudos pro seu concurso{{ de [concurso]}}? É onde a maioria se perde. Quer que eu te mostre por onde começar?",

  // --- Compartilhados por outras sequências (lembrete/conexão/pós-preço) ---
  ta_ai: "Olá, tá por ai?",
  olhinho_followup: "👀",
  encerramento_02:
    "Antes de eu encerrar seu atendimento por aqui: ficou com alguma dúvida que eu possa esclarecer? Se ainda fizer sentido pra você começar, é só me dar um sinal.",

  // --- Sequência de recuperação: Conexão (janela aberta) ---
  // Leads que já conversaram mas pararam de responder
  conexao_followup_1: "Oi [Nome], lembrei de você{{ e da sua preparação pra [concurso]}}. Ficou alguma dúvida do que a gente conversou, ou foi mais questão de tempo?",
  conexao_followup_2:
    "Oi [Nome], deixa eu te perguntar direto: o que mais te travou até agora, foi o valor, o tempo ou ficou alguma dúvida sobre a mentoria?",
  conexao_followup_3: "Oi [Nome], se ainda fizer sentido pra você, consigo te mostrar o próximo passo de forma bem tranquila. Quer?",
  conexao_encerramento:
    "Oi [Nome], antes de eu deixar o espaço livre por aqui: ficou alguma dúvida que eu possa esclarecer? Se ainda fizer sentido pra você, é só me dar um sinal.",

  // --- Sequência de recuperação: Conexão (janela fechada — Meta templates) ---
  conexao_duvida: "Ficou alguma dúvida sobre o que conversamos? Pode me chamar aqui sem compromisso",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)

  // --- Sequência pós-preço: Conexão (janela aberta) ---
  // Acionada quando lead viu o pitch de preço e sumiu (description contém "status: proposta_apresentada")
  // Toque 1: cutucada leve reforçando a proposta enviada (sem downsell, sem escassez).
  pos_preco_reforco: "Oi [Nome], só voltei aqui rapidinho. Lembra que na mentoria você não estuda no escuro: eu te digo exatamente o que priorizar{{ pro [concurso]}} e acompanho de perto. Ficou alguma dúvida sobre a proposta que te mandei?",
  pos_preco_followup_1: "Oi [Nome], ficou alguma dúvida sobre o investimento ou sobre como a mentoria funciona? Me pergunta aqui que eu te respondo.",
  pos_preco_followup_2:
    "Ei [Nome], se o valor pesou de cabeça, dá pra dividir em até 12x no boleto ou no PIX, uma parcela por mês, sem precisar de limite no cartão. Quer que eu te mostre como fica?",
  pos_preco_followup_3:
    "Oi [Nome], e lembra: o risco é zero. Você tem 7 dias de garantia pra testar a mentoria por dentro, e se sentir que não é pra você, eu devolvo o valor, sem precisar justificar nada. Faz mais sentido assim?",
  // Sem [Nome]: também é usada como template PAGO fora da janela (fallback), onde o código
  // não substitui a variável — igual aos demais fallbacks (conexao_duvida, lembrete_acesso...).
  pos_preco_urgencia:
    "Oi, não quero te apressar. Só me diz o que ficou pesando, o valor ou alguma dúvida, que eu vejo a melhor forma de encaixar pro teu momento.",
  pos_preco_encerramento:
    "Oi [Nome], antes de encerrar: foi o valor que pesou ou ficou alguma dúvida? Se ainda fizer sentido, me dá um sinal que a gente vê a melhor forma pra você.",

  // --- Sequência pós-preço: Conexão (janela fechada — Meta templates) ---
  pos_preco_duvida: "Ficou alguma dúvida sobre o investimento? Me conta aqui que a gente resolve",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)

  // --- Recuperação: versão enxuta (downsell 6 meses / Semestral) ---
  // Toque 2 (se o lead não respondeu à cutucada). NÃO enviar para médicos (guarda no graph.ts).
  // Meta template: recuperacao_enxuta (pt_BR, {{1}}=nome, só corpo).
  recuperacao_enxuta: "Oi [Nome], e se desse pra começar por um caminho mais leve? Tenho o plano de 6 meses, com o mesmo acompanhamento meu, num valor bem menor. Quer ver como fica{{ pro [concurso]}}?",

  // --- Sequência de lembrete: Aguardando Pagamento (janela aberta) ---
  lembrete_1: "Oi [Nome], o link ainda tá ativo. Ficou com alguma dúvida antes de confirmar?",
  lembrete_2:
    "Oi [Nome], vi que você ainda não finalizou. Travou em alguma coisa na hora de finalizar? Me fala que eu te ajudo.",
  lembrete_3: "Oi [Nome], deixo tudo pronto pra você começar quando quiser. Ficou alguma dúvida antes de finalizar?",
  lembrete_urgencia:
    "Oi [Nome], sei que a correria toma conta. Se ainda quiser garantir seu acesso, é só me chamar que eu te ajudo a finalizar sem complicação. O que ficou pendente?",
  lembrete_encerramento:
    "Oi [Nome], vou te dar um tempo pra pensar sem pressão. Se travou algo no pagamento ou ficou alguma dúvida, me fala que eu resolvo com você.",

  // --- Sequência de lembrete: Aguardando Pagamento (janela fechada — Meta templates) ---
  lembrete_acesso:
    "Quando você confirmar o pagamento, te envio todos os acessos na hora pra começar ainda hoje",
  lembrete_urgencia_meta:
    "Oi, sei que a correria toma conta. Se ainda quiser garantir seu acesso, é só me chamar que eu te ajudo a finalizar sem complicação. O que ficou pendente?",
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
  /** Nº de variáveis {{n}} no CORPO do template aprovado na Meta. Se 0, o enviarTemplate
   *  NÃO manda processed_params (evita erro quando o template não tem variável — ex.: um
   *  template reaprovado sem {{1}} recebendo {{1}} do caller). */
  bodyVars?: number;
}

export const TEMPLATE_META: Record<string, TemplateMeta> = {
  // Abertura criada em Portuguese (BR), com {{1}} = primeiro nome.
  abertura02: { language: "pt_BR", bodyVars: 1 },
  // Sequência de recuperação criada em English (o texto do corpo é português mesmo).
  fup1_reforco: { language: "en", bodyVars: 1 },
  fup2_prova_social: { language: "en", bodyVars: 1 },
  // fup3 reaprovado com a copy nova (cronograma) — SEM {{1}}. bodyVars 0 dropa o param.
  fup3_urgencia: { language: "en", bodyVars: 0 },

  // Templates de recuperação NOVOS aprovados na Meta (usados no envio fora da janela).
  conexao_1: { language: "pt_BR", bodyVars: 1 },
  conexao_2: { language: "pt_BR", bodyVars: 0 },
  lembrete_2: { language: "pt_BR", bodyVars: 1 },
  // Cutucada de reforço + versão enxuta (downsell 6 meses) — aprovar na Meta (pt_BR, {{1}}=nome).
  pos_preco_reforco: { language: "pt_BR", bodyVars: 1 },
  recuperacao_enxuta: { language: "pt_BR", bodyVars: 1 },
  // Encerramento consultivo aprovado com {{1}} = primeiro nome.
  encerramento: { language: "pt_BR", bodyVars: 1 },

  // Fallbacks SEM variável — o caller pode passar {{1}}, mas bodyVars 0 faz o enviarTemplate dropar.
  conexao_duvida: { language: "pt_BR", bodyVars: 0 },
  lembrete_acesso: { language: "pt_BR", bodyVars: 0 },
  lembrete_urgencia_meta: { language: "pt_BR", bodyVars: 0 },
  pos_preco_duvida: { language: "pt_BR", bodyVars: 0 },
  pos_preco_urgencia: { language: "pt_BR", bodyVars: 0 },
  encerramento_02: { language: "pt_BR", bodyVars: 0 },
};
