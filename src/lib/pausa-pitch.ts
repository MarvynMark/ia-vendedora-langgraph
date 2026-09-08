// O PITCH PASSA A SER HUMANO. Quando a IA está prestes a dizer um valor ou mandar um link de
// pagamento, ela para: manda uma ponte curta, se cala (perde a label agente-on) e o grupo do
// comercial é avisado para um atendente assumir.
//
// Por quê: a IA qualifica bem e fecha mal. No diagnóstico de agosto, nenhuma das 36 conversas que
// receberam o pitch da IA virou venda, e a maior parte dos leads sumia logo depois do preço. A
// qualificação (áudios, vídeo, entregáveis, descoberta de material e de situação) continua com
// ela; a conversa de dinheiro vai para uma pessoa.
//
// Funções puras e sem I/O, mesmo motivo de alerta-novo-aluno.ts e objecoes.ts: é o texto que o
// lead lê e o que o time recebe, então precisa ser testável sem tocar Chatwoot nem o grafo.

/**
 * A última coisa que o lead ouve da IA antes de o humano entrar.
 *
 * Regras que ela precisa respeitar, todas já valendo no roteiro:
 * - NÃO revela que houve escalação nem que "alguém vai te atender" (escalação é silenciosa);
 * - NÃO promete prazo ("já volto", "em 5 minutos") — quem responde é uma pessoa, e pode ser só no
 *   dia seguinte se o lead chegar de madrugada ou no fim de semana;
 * - NÃO cita valor, plano ou link, senão o pitch já teria começado;
 * - termina apontando pra frente, porque mensagem morta faz o lead sumir.
 */
export const PONTE_PITCH_HUMANO =
  "Perfeito. Deixa eu olhar aqui o teu caso pra te indicar o plano certo e a melhor condição, " +
  "que aí eu te passo tudo certinho.";

export interface DadosAlertaPitch {
  nome: string;
  telefone: string;
  /** O que o lead disse no turno que levou ao pitch. */
  fala: string;
  /** Concurso do formulário, quando houver. */
  concurso?: string;
  /** "tem material" / "sem material", quando a descoberta já aconteceu. */
  material?: string;
  /** Deep link da conversa no Chatwoot. */
  link: string;
}

export function montarAlertaPitch(dados: DadosAlertaPitch): string {
  const nome = dados.nome?.trim() || "(sem nome)";
  const fala = dados.fala.replace(/<\/?mensagem-de-audio>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);

  const contexto = [
    dados.concurso?.trim() ? `*Concurso*: ${dados.concurso.trim()}` : "",
    dados.material?.trim() ? `*Material*: ${dados.material.trim()}` : "",
  ].filter(Boolean);

  return [
    `🔴 *PITCH — assumir agora* — ${nome} (${dados.telefone})`,
    "",
    "O lead foi qualificado e chegou na hora do preço. A IA foi pausada e não vai mandar mais nada.",
    ...(contexto.length ? ["", ...contexto] : []),
    "",
    `*Última mensagem do lead*:`,
    `"${fala}"`,
    "",
    `👉 ${dados.link}`,
  ].join("\n");
}

/**
 * A IA está pausada nesta conversa? É a mesma regra do webhook do Chatwoot — quem manda é a label
 * `agente-on`, e o humano assume removendo ela.
 *
 * Vive aqui, pura, porque o follow-up também precisa dela: ele é disparado pelo Kanban e não
 * passava por essa checagem, então uma conversa escalada (ou pausada no pitch) continuava
 * recebendo toque automático por cima do atendente que tinha assumido.
 */
export function iaEstaPausada(labels: string[] | undefined | null): boolean {
  return !(labels ?? []).includes("agente-on");
}

/** Nota privada no histórico do próprio lead, pra quem abrir a conversa entender o que houve. */
export function montarNotaPitch(fala: string): string {
  return (
    "🔴 *Atendimento pausado — hora do pitch*\n\n" +
    "O lead passou pela qualificação e chegou no momento do preço. A IA parou aqui de propósito: " +
    "o pitch é feito por uma pessoa.\n\n" +
    `*Última mensagem do lead*:\n"${fala.replace(/<\/?mensagem-de-audio>/g, "").trim()}"`
  );
}
