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
    "Oi [Nome], imagino que a rotina tá corrida{{, ainda mais pra quem quer a aprovação em [concurso]}}.\n\nSeparei um tempo pra olhar o seu caso com calma. Me dá um oi rapidinho que eu te mostro o que enxerguei?",
  // Prova social em TEXTO (sem cabeçalho de imagem — evita o erro Meta #132000 do Chatwoot 4.15.1).
  fup2_prova_social:
    "Ei [Nome], essa semana mais alunos meus passaram na frente estudando com direção, não sozinhos.\n\nSeu perfil tem tudo pra entrar nesse caminho. Quer que eu te mostre como?",
  fup3_urgencia:
    "Oi [Nome], não cheguei a ter um retorno seu, e tá tudo bem. Se em algum momento fizer sentido organizar os estudos{{ pro [concurso]}} com um direcionamento, é só me dar um sinal que eu te ajudo. Fico por aqui, no seu tempo.",

  // --- Compartilhados por outras sequências (lembrete/conexão/pós-preço) ---
  ta_ai: "Olá, tá por ai?",
  olhinho_followup: "👀",
  encerramento_02:
    "Oi [Nome], não quero te encher, então vou deixar a porta aberta por aqui. Se em algum momento fizer sentido organizar seus estudos com um direcionamento, é só me dar um sinal que eu te ajudo, no seu tempo.",

  // --- Sequência de recuperação: Conexão (janela aberta) ---
  // Leads que já conversaram mas pararam de responder
  // Os quatro toques abrem de formas DIFERENTES de propósito: quando todos começavam com
  // "Oi [Nome]," o lead reconhecia o padrão de cobrança automática já na primeira linha
  // (conv 6675, dois toques no mesmo dia e com a mesma abertura).
  conexao_followup_1: "Oi [Nome], lembrei de você{{ e da sua preparação pra [concurso]}}. Ficou alguma dúvida do que a gente conversou, ou foi mais questão de tempo?",
  // Toque 2 (novo): não cobra resposta, entrega uma ideia. Quebra a sequência de perguntas.
  conexao_followup_valor:
    "Uma coisa que eu vejo direto em quem estuda sozinho{{ pro [concurso]}}: a pessoa não estuda pouco, estuda sem ordem. Revisa o que já sabe e adia o que mais cai. É exatamente isso que eu organizo no primeiro plano que monto pra você.",
  conexao_followup_2:
    "Deixa eu te perguntar direto, [Nome]: o que mais te travou até agora, foi o valor, o tempo ou ficou alguma dúvida sobre a mentoria?",
  conexao_followup_3: "Se ainda fizer sentido pra você, [Nome], consigo te mostrar o próximo passo de forma bem tranquila. Quer?",
  conexao_encerramento:
    "Oi [Nome], vou te dar um espaço, sem pressão nenhuma. Se ficou alguma dúvida do que a gente conversou, ou se mais pra frente você quiser retomar, é só me chamar que eu te ajudo.",

  // --- Sequência de recuperação: Conexão (janela fechada — Meta templates) ---
  conexao_duvida: "Ficou alguma dúvida sobre o que conversamos? Pode me chamar aqui sem compromisso",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)

  // --- Sequência pós-preço: Conexão (janela aberta) ---
  // Acionada quando lead viu o pitch de preço e sumiu (description contém "status: proposta_apresentada")
  // Toque 1: a GARANTIA de 7 dias. Saiu do pitch de propósito — despejada junto com o preço ela
  // é gasta antes de existir hesitação; aqui ela chega exatamente quando o lead travou, e
  // transforma "comprar" em "experimentar", que é uma decisão bem menor.
  pos_preco_garantia:
    "Oi [Nome], pensei aqui e queria que você soubesse de uma coisa: você pode entrar, testar a mentoria por 7 dias e, se sentir que não é pra você, eu devolvo seu investimento, sem precisar justificar nada. Sem risco pra você. Você estaria disposto a ver se faz sentido pra você?",
  // Reforço da proposta (sem downsell, sem escassez). Segue como fallback pago do toque 1 — é o
  // template já aprovado na Meta; a garantia acima vai como texto livre dentro da janela de 24h.
  pos_preco_reforco: "Oi [Nome], só voltei aqui rapidinho. Lembra que na mentoria você não estuda no escuro: eu te digo exatamente o que priorizar{{ pro [concurso]}} e acompanho de perto. Ficou alguma dúvida sobre a proposta que te mandei?",
  pos_preco_followup_1: "Oi [Nome], ficou alguma dúvida sobre o investimento ou sobre como a mentoria funciona? Me pergunta aqui que eu te respondo.",
  pos_preco_followup_2:
    "Ei [Nome], se o valor pesou de cabeça, dá pra dividir em até 12x no boleto ou no PIX, uma parcela por mês, sem precisar de limite no cartão. Quer que eu te mostre como fica?",
  pos_preco_followup_3:
    "Oi [Nome], e lembra: o risco é zero. Você tem 7 dias de garantia pra testar a mentoria por dentro, e se sentir que não é pra você, eu devolvo o valor, sem precisar justificar nada. Faz mais sentido assim?",
  // Toque D+7: prova social (caso anônimo + 93%), reengaja pelo resultado, sem pressão.
  pos_preco_prova_social:
    "Oi [Nome], deixa eu te contar uma coisa rápida: teve gente que entrou comigo com a mesma dúvida que a sua e hoje já tá evoluindo firme. No último Perito Criminal do RS, 93% dos meus alunos passaram pras próximas fases. Quer que eu te mostre por onde você começaria{{ pro [concurso]}}?",
  // Toque D+14: fecho por VALOR/porta aberta (não "última chamada" — fecho/pressão dá ~0% de resposta).
  pos_preco_ultima_chamada:
    "Oi [Nome], não vou ficar te cutucando. Se em algum momento fizer sentido retomar{{ sua preparação pro [concurso]}}, é só me dar um sinal que eu te ajudo no primeiro passo, no seu tempo. Fico por aqui.",
  // Sem [Nome]: também é usada como template PAGO fora da janela (fallback), onde o código
  // não substitui a variável — igual aos demais fallbacks (conexao_duvida, lembrete_acesso...).
  pos_preco_urgencia:
    "Oi, não quero te apressar. Só me diz o que ficou pesando, o valor ou alguma dúvida, que eu vejo a melhor forma de encaixar pro teu momento.",
  pos_preco_encerramento:
    "Oi [Nome], sem pressão nenhuma: se foi o valor que pesou ou ficou alguma dúvida, me fala que a gente vê junto a melhor forma pro teu momento. E se preferir retomar mais pra frente, é só me chamar.",

  // --- Sequência pós-preço: Conexão (janela fechada — Meta templates) ---
  pos_preco_duvida: "Ficou alguma dúvida sobre o investimento? Me conta aqui que a gente resolve",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)

  // --- Retomada agendada: o lead combinou um retorno numa data (card tem "retomar: ...") ---
  // Reconhece o combinado (não contradiz nem fala de link fantasma) — corrige o caso "Confirmar o quê?".
  retomada_agendada:
    "Oi [Nome], como a gente tinha combinado, tô passando aqui pra retomar. Ficou alguma dúvida sobre a mentoria{{ pro [concurso]}}, ou quer que eu já te ajude a dar o próximo passo?",

  // --- Recuperação: versão enxuta (downsell 6 meses / Semestral) ---
  // Toque 2 (se o lead não respondeu à cutucada). NÃO enviar para médicos (guarda no graph.ts).
  // Meta template: recuperacao_enxuta (pt_BR, {{1}}=nome, só corpo).
  recuperacao_enxuta: "Oi [Nome], e se desse pra começar por um caminho mais leve? Tenho o plano de 6 meses, com o mesmo acompanhamento meu, num valor bem menor. Quer ver como fica{{ pro [concurso]}}?",

  // --- Sequência de lembrete: Aguardando Pagamento (janela aberta) ---
  lembrete_1: "Oi [Nome], deixei tudo pronto do meu lado pra você começar. Me diz com sinceridade: travou alguma coisa na hora de finalizar, ou foi mais questão de tempo?",
  lembrete_2:
    "Oi [Nome], se travou alguma coisa na hora de pagar (o boleto não gerou, o cartão não passou, qualquer coisa), me manda um print ou me fala aqui que eu resolvo com você na hora.",
  lembrete_3: "Oi [Nome], deixo tudo prontinho do meu lado pra quando você quiser começar. Se ficou alguma dúvida ou travou algo no pagamento, é só me chamar que eu te ajudo, sem pressa.",
  lembrete_urgencia:
    "Oi [Nome], sei que a correria toma conta. Se quiser finalizar quando der, é só me chamar que eu te ajudo sem complicação. O que ficou pendente?",
  lembrete_encerramento:
    "Oi [Nome], vou te dar um tempo pra pensar sem pressão. Se travou algo no pagamento ou ficou alguma dúvida, me fala que eu resolvo com você.",

  // --- Sequência de lembrete: Aguardando Pagamento (janela fechada — Meta templates) ---
  lembrete_acesso:
    "Quando você confirmar o pagamento, te envio todos os acessos na hora pra começar ainda hoje",
  lembrete_urgencia_meta:
    "Oi, sei que a correria toma conta. Se quiser finalizar quando der, é só me chamar que eu te ajudo sem complicação. O que ficou pendente?",
  // fallbacks: olhinho_followup + encerramento_02 (já definidos acima)

  // --- Nutrir (esteira de longo prazo, SEMPRE fora da janela de 24h → só template Meta aprovado) ---
  // Leads que estavam no funil e esfriaram. Consultivo, sem pressão. {{1}} = primeiro nome.
  nutrir_reengajamento:
    "Oi [Nome], lembrei de você por aqui. Como andam os planos com os estudos? Sem compromisso nenhum, só queria saber como você tá.",
  nutrir_reconsulta:
    "Oi [Nome], faz um tempo que a gente não conversa. Se o momento tiver melhorado e você ainda quiser entrar na mentoria comigo, é só me dar um sinal, sem pressão.",
  nutrir_ebook:
    "Oi [Nome], separei um material meu sobre perícia que pode te ajudar a dar os primeiros passos, de forma gratuita: https://www.csiacademy.com.br/ebooks",
  // Vídeo de prova social criado SEM variável na Meta (bodyVars 0) → sem [Nome].
  nutrir_video_aprovada:
    "Oi, gravei um bate-papo com uma aluna que passou no concurso, vale muito ver a trajetória dela na prática: https://www.youtube.com/watch?v=NEuvOrENWdc",
  // Reescrito 20/08 (a copy antiga teve 0 resposta em 17 envios): agora abre com uma pergunta
  // FÁCIL de responder ("firme ou travou?") em vez do passivo "me chama se fizer sentido".
  nutrir_reabertura:
    "Oi [Nome], tô abrindo uma turma nova da mentoria e lembrei de você. Antes de qualquer coisa, queria saber: como tá indo a sua preparação, seguiu firme ou acabou travando um pouco?",
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

  // Nutrir — todos com {{1}} = primeiro nome. Aprovar na Meta (pt_BR).
  nutrir_reengajamento: { language: "pt_BR", bodyVars: 1 },
  nutrir_reconsulta: { language: "pt_BR", bodyVars: 1 },
  nutrir_ebook: { language: "pt_BR", bodyVars: 1 },
  nutrir_video_aprovada: { language: "pt_BR", bodyVars: 0 },
  nutrir_reabertura: { language: "pt_BR", bodyVars: 1 },
};
