import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

export const MainAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,

  // --- Dados do webhook ---
  idMensagem: Annotation<string>,
  idMensagemReferenciada: Annotation<string | null>,
  idConta: Annotation<string>,
  idConversa: Annotation<string>,
  idContato: Annotation<string>,
  idInbox: Annotation<string>,
  telefone: Annotation<string>,
  nome: Annotation<string>,
  mensagem: Annotation<string>,
  mensagemDeAudio: Annotation<boolean>,
  timestamp: Annotation<string>,
  tipoArquivo: Annotation<string | null>,
  idAnexo: Annotation<string | null>,
  urlArquivo: Annotation<string | null>,
  etiquetas: Annotation<string[]>,
  atributosContato: Annotation<Record<string, unknown>>,
  atributosConversa: Annotation<string>,
  dadosFormulario: Annotation<string>,
  tarefa: Annotation<Record<string, unknown>>,
  funil: Annotation<Record<string, unknown>>,

  // --- Dados de controle ---
  mensagemProcessada: Annotation<string>,
  mensagemReferenciada: Annotation<string | null>,
  mensagensAgregadas: Annotation<string>,

  // --- Controle de fluxo ---
  stale: Annotation<boolean>,
  lockTentativas: Annotation<number>,
  locked: Annotation<boolean>,
  outputAgente: Annotation<string>,
  novasMensagens: Annotation<boolean>,

  // --- Erro ---
  erroFatal: Annotation<boolean>,

  // --- Resposta ---
  respostaFormatada: Annotation<string>,
  ssml: Annotation<string>,
  audioBuffer: Annotation<Uint8Array | null>,
});

export type MainAgentStateType = typeof MainAgentState.State;
