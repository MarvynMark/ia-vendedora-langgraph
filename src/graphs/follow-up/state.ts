import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

export const FollowUpState = Annotation.Root({
  ...MessagesAnnotation.spec,

  // --- Dados do webhook (kanban_task_overdue) ---
  accountId: Annotation<number>,
  boardId: Annotation<number>,
  taskId: Annotation<number>,
  board_step: Annotation<{ id: number; name: string }>,
  title: Annotation<string>,
  description: Annotation<string>,
  dueDate: Annotation<string>,

  // --- Dados do contato ---
  telefone: Annotation<string>,
  conversationId: Annotation<number>,
  inboxId: Annotation<number>,
  displayId: Annotation<number>,

  // --- Dados do funil ---
  funilSteps: Annotation<Array<{ id: number; name: string; cancelled?: boolean }>>,
  idEtapaPerdido: Annotation<number>,

  // --- Classificação ---
  tipoFollowup: Annotation<"followup" | "lembrete" | "boas_vindas" | "template_abertura" | "ignorar">,

  // --- Resposta ---
  respostaAgente: Annotation<string>,
});

export type FollowUpStateType = typeof FollowUpState.State;
