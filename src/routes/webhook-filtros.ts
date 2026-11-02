// Filtros PUROS do webhook do Chatwoot, extraídos para teste determinístico. Testar a rota
// inteira exigia mock.module de chatwoot/graph/db, que no bun VAZA entre arquivos de teste e
// poluía a suíte (webhook.test.ts derrubava testes de chatwoot/áudio). Estas funções não têm
// dependência externa — dá pra testar sem mock nenhum.
//
// Elas cobrem só as decisões de IGNORAR/prosseguir. NÃO cobrem: filtro de event, dedup
// (reivindicarMensagem, assíncrono), nem as AÇÕES de grupo-espera e /reset.

// Checagens ANTES do ramo de grupo-espera: isto é uma mensagem real do lead?
// - not_incoming: não é mensagem recebida (bot/nota/atualização).
// - reaction: reação (emoji) — conv 4677: lead reagiu ❤️ ao pitch e a IA mandou o link. NÃO é msg.
// - agent_message: o sender não é o contato da conversa (mensagem do próprio bot/agente).
export function motivoIgnorarPreGrupo(
  messageType: number | string,
  isReaction: boolean | undefined,
  senderId: number,
  contactId: number | undefined,
): "not_incoming" | "reaction" | "agent_message" | null {
  if (messageType !== 0 && messageType !== "incoming") return "not_incoming";
  if (isReaction === true) return "reaction";
  if (contactId !== undefined && senderId !== contactId) return "agent_message";
  return null;
}

// Checagens de ATIVAÇÃO (depois do ramo de grupo-espera): a IA deve atender esta conversa?
// - no_agente-on: sem o label de ativação (humano assume removendo "agente-on").
// - modo_teste: com MODO_TESTE ligado, só atende conversas marcadas "teste-agente".
export function motivoIgnorarAtivacao(
  labels: string[],
  modoTeste: boolean,
): "no_agente-on" | "modo_teste" | null {
  if (!labels.includes("agente-on")) return "no_agente-on";
  if (modoTeste && !labels.includes("teste-agente")) return "modo_teste";
  return null;
}

// --- Grupo de espera: PEDIDO vs MENÇÃO ---
//
// O gatilho era só a presença da expressão, e citar o grupo virava pedir o grupo. Na conv 6890 a
// lead escreveu "Ontem eu assisti o vídeo no YouTube [...] que você mandou no grupo de espera. Foi
// muito inspiradora a história da Fernanda" e recebeu, UM SEGUNDO depois, "Clique no link abaixo
// para entrar no grupo de espera" — ela já estava lá dentro, e acabara de provar isso.

const GRUPO_ESPERA_KEYWORDS = ["grupo de espera", "grupo de espero", "acesso ao grupo", "entrar no grupo"];

// Verbos que colocam o grupo no PASSADO/relato: o lead está contando algo que viu ou recebeu lá.
const RE_MENCAO_GRUPO = /\b(mandou|mandaram|enviou|enviaram|postou|postaram|colocou|colocaram|compartilhou|falou|falaram|vi|assisti|li|ouvi|tinha|teve|apareceu)\b/i;

// Marcas de PEDIDO. Se aparecerem, é pedido mesmo que ele também mencione o grupo
// ("vi que tem um grupo de espera, quero entrar").
const RE_PEDIDO_GRUPO = /\b(quero|queria|gostaria|preciso|pode|poderia|consigo|como|onde|manda|mande|passa|passe|envia|envie|link|entrar|participar|acessar|acesso|cadastr\w*)\b/i;

/**
 * O lead está PEDINDO o link do grupo de espera?
 *
 * Conservador de propósito: só recusa quando a mensagem é claramente um RELATO sobre o grupo e
 * não tem nenhuma marca de pedido. Mandar o link a mais é constrangedor; não mandar para quem
 * pediu deixa o lead de fora, que é pior.
 */
export function pedeGrupoDeEspera(content: string): boolean {
  const c = (content ?? "").toLowerCase();
  if (!GRUPO_ESPERA_KEYWORDS.some((kw) => c.includes(kw))) return false;
  if (RE_MENCAO_GRUPO.test(c) && !RE_PEDIDO_GRUPO.test(c)) return false;
  return true;
}

// --- Grupo de espera: MÉDICO vs GERAL ---
//
// Médicos (trilha Médico Legista) têm uma lista de espera própria. O gatilho chega antes da IA
// conversar, então a decisão usa o que já se sabe do lead: label "medico", formação do formulário
// ou `qual_formacao` do contato (ver ehMedicoLead), e a própria mensagem ("grupo de espera dos
// médicos", "sou médica"). Sem nenhum sinal, vai para o grupo geral.

/** A mensagem se identifica como de médico ("grupo dos médicos", "sou médica")? Só a palavra
 *  médico/médica: "medicina legal" é assunto de perito também, e biomédico/veterinário ficam fora. */
export function mensagemEhDeMedico(content: string): boolean {
  const c = (content ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /(^|[^a-z])medic[oa]s?([^a-z]|$)/.test(c) && !/veterin/.test(c);
}

/** Texto com o link do grupo de espera certo para o lead. Mantém "grupo de espera" no texto: é
 *  por essa expressão que o webhook detecta que o link já foi enviado. */
export function mensagemGrupoDeEspera(
  ehMedico: boolean,
  links: { geral: string; medicos: string },
): string {
  return ehMedico
    ? `Clique no link abaixo para entrar no grupo de espera de médicos:\n\n${links.medicos}`
    : `Clique no link abaixo para entrar no grupo de espera:\n\n${links.geral}`;
}

// --- Convite de evento: botão "Confirmar" do template ---
//
// O template do convite (imagem + "Toque em confirmar 👇🏻") tem um botão de resposta rápida.
// Quem toca manda só a palavra "Confirmar", e o link da live tem que chegar mesmo que a conversa
// esteja sem "agente-on" (a maioria dos leads do disparo não tem) — por isso a resposta é fixa,
// decidida aqui, e não pela IA. Cada template de convite aponta para a sua mensagem com o link.

export const CONVITES_EVENTO: Record<string, string> = {
  encontro_legista_2110:
    "Presença confirmada! ✅\n\n" +
    "*Próximos concursos de Médico Legista e tira-dúvidas*\n" +
    "📅 Quarta-feira, 21/10, às 21h30, ao vivo no YouTube\n" +
    "🎙️ Walker Duarte (perito criminal) e Natália Basan (médica legista)\n\n" +
    "O link é este 👇🏻\nhttps://www.youtube.com/watch?v=yyRL-WCCrG0\n\n" +
    "Entra agora e toca no sininho para o YouTube te avisar quando começar.",
  encontro_legista_aovivo_2110:
    "🔴 *Estamos AO VIVO agora!*\n\n" +
    "*Próximos concursos de Médico Legista e tira-dúvidas*\n" +
    "🎙️ Walker Duarte (perito criminal) e Natália Basan (médica legista)\n\n" +
    "Entra por aqui e manda sua dúvida no chat 👇🏻\nhttps://www.youtube.com/watch?v=yyRL-WCCrG0",
};

const JANELA_CONVITE_SEG = 4 * 86_400;

interface MensagemConversa {
  id?: number;
  message_type: number;
  content?: string | null;
  created_at?: number;
  additional_attributes?: { template_params?: { name?: string } } | null;
}

/**
 * O lead tocou "Confirmar" num convite de evento que recebeu nos últimos 4 dias? Devolve a
 * mensagem com o link, ou null. Responde uma vez só: se o link já saiu depois do convite, null.
 */
export function respostaConfirmacaoEvento(
  content: string,
  mensagens: MensagemConversa[],
  agoraSeg: number,
): string | null {
  if (!/^confirmar$/i.test((content ?? "").trim())) return null;
  const saidas = mensagens
    .filter((m) => m.message_type === 1)
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  for (let i = saidas.length - 1; i >= 0; i--) {
    const nome = saidas[i]!.additional_attributes?.template_params?.name;
    const resposta = nome ? CONVITES_EVENTO[nome] : undefined;
    if (!resposta) continue;
    if (agoraSeg - (saidas[i]!.created_at ?? 0) > JANELA_CONVITE_SEG) return null;
    const link = resposta.match(/https:\/\/\S+/)?.[0] ?? resposta;
    const jaRespondeu = saidas.slice(i + 1).some((m) => (m.content ?? "").includes(link));
    return jaRespondeu ? null : resposta;
  }
  return null;
}

// --- Convites da Black 2026: botão "Ver detalhes" do template ---
//
// Mesmo princípio do "Confirmar": o template UTILITY é curto e transacional ("Seu registro … foi
// confirmado"); o toque no botão abre a janela de 24h e aí sai a sequência livre — a arte, as
// mensagens e, por último, o link do grupo do público certo. Resposta fixa, sem a IA, com ou sem
// "agente-on". Disparo: src/scripts/disparo-convite-black.ts.

export interface SequenciaConvite {
  /** URL pública da arte (anexo de nota privada da conv 3896: o blob do Chatwoot não expira). */
  imagem: string;
  /** Link do grupo; vai na última mensagem e serve para saber se a sequência já saiu. */
  link: string;
  mensagens: (primeiroNome: string | null) => string[];
}

const saudacao = (nome: string | null) => (nome ? `Excelente, ${nome}!! 🚀` : "Excelente!! 🚀");

export const CONVITES_BLACK: Record<string, SequenciaConvite> = {
  convite_black_leads: {
    imagem: "https://chat.stkd.site/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBNEhxQVE9PSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--4f1ca9a6613a519c67b63cb23a342acc8c1f9ca4/convite_black_leads.jpg",
    link: "https://chat.whatsapp.com/KNtt3cuiTPO41AHWEzq0Y5",
    mensagens: (nome) => [
      saudacao(nome),
      "🎉 Você acaba de entrar na lista da *BLACK VESTIGIUM 2026*",
      "📅 *Anota na agenda:* domingo, 08/11, às 20h, AO VIVO no YouTube com o Perito Walker.",
      "⚠️ *ATENÇÃO:* o link da live e TODOS os avisos da Black vão SOMENTE no Grupo VIP.",
      "Quem não entra no grupo fica sem o link da live e sem os avisos da oferta 😬\n\nEntra agora, é rápido 👇🏻\nhttps://chat.whatsapp.com/KNtt3cuiTPO41AHWEzq0Y5",
    ],
  },
  convite_black_alunos: {
    imagem: "https://chat.stkd.site/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBNExxQVE9PSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--90a1911243c53db0bf88878975e01d561677431d/convite_black_alunos.jpg",
    link: "https://chat.whatsapp.com/FGvOpeUse37684e2BKhEaZ",
    mensagens: (nome) => [
      saudacao(nome),
      "🎉 Você está na lista da *BLACK EXCLUSIVA DE ALUNOS* Vestigium",
      "📅 *Anota na agenda:* sexta, 06/11, às 10h, as condições de alunos são liberadas ANTES do público.",
      "⚠️ *ATENÇÃO:* a condição de alunos sai SOMENTE no grupo de alunos. Ela não vai para o grupo da Black nem para o Instagram.",
      "Quem não entra no grupo fica sem a condição exclusiva 😬\n\nEntra agora, é rápido 👇🏻\nhttps://chat.whatsapp.com/FGvOpeUse37684e2BKhEaZ",
    ],
  },
  convite_black_medicos: {
    imagem: "https://chat.stkd.site/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBNFBxQVE9PSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--78d8d7ce8d6f8ada45c82f213764d5e2a6817e24/convite_black_medicos.jpg",
    link: "https://chat.whatsapp.com/Cu9GVmjY0bMHkD80mQ96yv",
    mensagens: (nome) => [
      saudacao(nome),
      "🎉 Você está na lista da *BLACK DE MÉDICO LEGISTA* Vestigium",
      "📅 *Anota na agenda:* domingo, 08/11, às 20h, liberamos a MELHOR condição do ano para médicos.",
      "⚠️ *ATENÇÃO:* a condição e TODOS os avisos vão SOMENTE no grupo de médicos.",
      "Quem não entra no grupo fica sem a condição e sem os avisos 😬\n\nEntra agora, é rápido 👇🏻\nhttps://chat.whatsapp.com/Cu9GVmjY0bMHkD80mQ96yv",
    ],
  },
};
// v2: o v1 foi reclassificado para MARKETING ("a melhor condição do ano" no corpo); mesma sequência.
CONVITES_BLACK.convite_black_medicos_v2 = CONVITES_BLACK.convite_black_medicos!;
// *_acesso: botão "Quero meu acesso". "Ver detalhes" colidia com um gatilho antigo do app
// Vestigium WTD (regressivas de jan/2025), que respondia junto com um vídeo e outro grupo.
CONVITES_BLACK.convite_black_leads_acesso = CONVITES_BLACK.convite_black_leads!;
CONVITES_BLACK.convite_black_alunos_acesso = CONVITES_BLACK.convite_black_alunos!;
CONVITES_BLACK.convite_black_medicos_acesso = CONVITES_BLACK.convite_black_medicos!;

/** Texto dos botões de resposta rápida dos convites da Black. */
export const BOTAO_CONVITE_BLACK = /^(ver detalhes|quero meu acesso)$/i;

/** Primeiro nome apresentável a partir do nome do contato; null se for número ou vazio. */
export function primeiroNome(nome: string | null | undefined): string | null {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}]{2,}$/u.test(p)) return null;
  return p[0]!.toUpperCase() + p.slice(1).toLowerCase();
}

/**
 * O lead tocou "Ver detalhes" num convite da Black recebido nos últimos 4 dias? Devolve o nome do
 * template e a sequência, ou null. Uma vez só: se o link do grupo já saiu depois do convite, null.
 */
export function respostaVerDetalhes(
  content: string,
  mensagens: MensagemConversa[],
  agoraSeg: number,
  /** id da mensagem do convite em que o lead tocou (content_attributes.in_reply_to). */
  emRespostaA?: number | null,
): { template: string; sequencia: SequenciaConvite } | null {
  if (!BOTAO_CONVITE_BLACK.test((content ?? "").trim())) return null;
  const saidas = mensagens
    .filter((m) => m.message_type === 1)
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  // Com o id do convite tocado, responde exatamente a ele; sem, ao convite mais recente.
  const alvo = emRespostaA ? saidas.findIndex((m) => m.id === emRespostaA) : -1;
  for (let i = alvo >= 0 ? alvo : saidas.length - 1; i >= 0; i--) {
    const nome = saidas[i]!.additional_attributes?.template_params?.name;
    const sequencia = nome ? CONVITES_BLACK[nome] : undefined;
    if (!sequencia) continue;
    if (agoraSeg - (saidas[i]!.created_at ?? 0) > JANELA_CONVITE_SEG) return null;
    const jaRespondeu = saidas.slice(i + 1).some((m) => (m.content ?? "").includes(sequencia.link));
    return jaRespondeu ? null : { template: nome!, sequencia };
  }
  return null;
}
