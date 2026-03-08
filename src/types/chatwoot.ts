export interface ChatwootWebhookPayload {
  event: string;
  id: number;
  content: string | null;
  content_type: string;
  content_attributes: {
    in_reply_to?: number;
    [key: string]: unknown;
  };
  message_type: number | string; // 0/"incoming", 1/"outgoing"
  created_at: number | string;
  account: {
    id: number;
  };
  conversation: {
    id: number;
    inbox_id: number;
    contact_inbox?: {
      source_id?: string;
      contact_id?: number;
    };
    labels: string[];
    custom_attributes?: Record<string, unknown>;
    display_id?: number;
  };
  sender: {
    id: number;
    name: string;
    phone_number?: string;
    custom_attributes?: Record<string, unknown>;
    additional_attributes?: { social_profiles?: { instagram?: string }; [key: string]: unknown };
  };
  attachments?: Array<{
    id: number;
    file_type: string;
    data_url: string;
  }>;
}

export interface ChatwootFollowUpPayload {
  event: "kanban_task_overdue" | "kanban_task_updated";
  account_id: number;
  board_id: number;
  task: {
    id: number;
    title: string;
    description: string | null;
    due_date: string | null;
    board_step_id: number;
    board_step: {
      id: number;
      name: string;
    };
    conversations: Array<{
      id: number;
      inbox_id: number;
      display_id: number;
      contact: {
        phone_number?: string;
        name: string;
        additional_attributes?: { social_profiles?: { instagram?: string }; [key: string]: unknown };
      };
    }>;
  };
  // Para kanban_task_updated (fazer.ai format: changed_attributes)
  changed_attributes?: {
    board_step_id?: [number, number]; // [old, new]
    board_step?: {
      previous_value?: { id: number; name: string };
      current_value?: { id: number; name: string };
    };
  };
}

export interface ContextoWebhook {
  id_mensagem: string;
  id_mensagem_referenciada: string | null;
  id_conta: string;
  id_conversa: string;
  id_contato: string;
  id_inbox: string;
  telefone: string;
  nome: string;
  mensagem: string;
  mensagem_de_audio: boolean;
  timestamp: string;
  tipo_arquivo: string | null;
  id_anexo: string | null;
  url_arquivo: string | null;
  etiquetas: string[];
  atributos_contato: Record<string, unknown>;
  atributos_conversa: string;
  tarefa: Record<string, unknown>;
  funil: Record<string, unknown>;
}
