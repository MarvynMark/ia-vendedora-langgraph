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
