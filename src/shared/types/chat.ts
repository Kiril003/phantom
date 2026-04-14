import { SystemState, StateTransition } from './system';

export type ResponseForm =
  | 'text'
  | 'markdown'
  | 'chart'
  | 'diagram'
  | 'map'
  | 'terminal'
  | 'code'
  | 'metric_cards'
  | 'mixed';

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  response_form: ResponseForm;
  metadata: {
    state_at_time: SystemState;
    context_snapshot_id: string;
    ai_provider: 'gemini' | 'ollama';
    latency_ms: number;
    tokens_used: number;
    tone: string;
    input_method: 'voice' | 'text' | 'encoder';
  };
  attachments: ChatAttachment[];
  created_at: string;
}

export interface ChatAttachment {
  type:
    | 'chart_data'
    | 'map_markers'
    | 'terminal_output'
    | 'code_block'
    | 'metric_card';
  data: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  summary: string | null;
  state_history: StateTransition[];
}
