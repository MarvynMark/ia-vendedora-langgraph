// Decisão PURA: esta mensagem que SAIU para o lead precisa entrar na memória da IA?
//
// O agente guarda a própria memória em n8n_historico_mensagens e salva ali cada fala
// que ele mesmo produz. O que ele NÃO enxerga é o que sai por outro caminho: um
// atendente digitando no Chatwoot, o painel de disparo, uma automação externa. Quando
// o lead responde a essas mensagens, o agente retoma de onde parou e ignora o que foi
// dito no meio — podendo repetir ou contradizer o humano.
//
// Sem mock nenhum aqui, para dar pra testar de forma determinística.

export type MotivoNaoRegistrar =
  | "nao_e_saida"      // não é mensagem enviada ao lead
  | "nota_privada"     // nota interna: o lead nunca viu
  | "sem_texto"        // só anexo/atividade, não há o que dar de contexto ao modelo
  | "e_do_agente";     // o próprio app mandou, e ele já gravou no histórico

export function motivoNaoRegistrarSaida(
  messageType: number | string,
  senderId: number | undefined,
  privada: boolean | undefined,
  conteudo: string | null | undefined,
  idUsuarioDoApp: number,
): MotivoNaoRegistrar | null {
  if (messageType !== 1 && messageType !== "outgoing") return "nao_e_saida";
  if (privada === true) return "nota_privada";
  if (!conteudo || !conteudo.trim()) return "sem_texto";
  // O app envia autenticado como um usuário específico do Chatwoot. Tudo que sai por
  // ele já foi para o histórico pelo salvarMensagem do próprio grafo; gravar de novo
  // aqui duplicaria TODA fala da IA.
  if (senderId !== undefined && senderId === idUsuarioDoApp) return "e_do_agente";
  return null;
}
