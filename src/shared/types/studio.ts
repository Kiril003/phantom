/**
 * Phase 17b — Agent Studio shared types.
 *
 * Mirror of src/backend/agent/studio/models.py — keep these in sync.
 * Run-time InfoNeed prompts re-use agent.AgentInfoNeed (Phase 17a.5).
 */
import type { AgentInfoNeed } from './agent';

export type CardCategory = 'source' | 'transform' | 'decision' | 'output' | 'council';

export type AgentCardKind =
  // source
  | 'web_search' | 'rss' | 'email_inbox' | 'file_watch' | 'api_poll'
  | 'db_query' | 'mobile_sensor'
  // transform
  | 'summarize' | 'compare' | 'filter' | 'sort' | 'extract' | 'diff' | 'score'
  // decision
  | 'if' | 'branch' | 'loop' | 'retry' | 'ask_user'
  // output
  | 'write_file' | 'send_email' | 'send_telegram' | 'post_to_api'
  | 'create_report' | 'notify'
  // council
  | 'review_by_council';

export interface AgentCardLink {
  from_card_id: string;
  to_card_id: string;
  label: string | null;
}

export interface AgentCard {
  id: string;
  kind: AgentCardKind;
  category: CardCategory;
  title: string;
  description: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
  info_needs: AgentInfoNeed[];
}

export type RecipientChannel =
  | 'email'
  | 'telegram'
  | 'sms'
  | 'file'
  | 'chat_self'
  | 'phantom_notify'
  | 'webhook';

export interface Recipient {
  id: string;
  channel: RecipientChannel;
  target: string;
  label: string | null;
  enabled: boolean;
}

export type ScheduleKind = 'manual' | 'interval' | 'cron' | 'conditional' | 'one_shot_future';

export interface Schedule {
  kind: ScheduleKind;
  interval_s: number | null;
  cron_expr: string | null;
  condition: string | null;
  fire_at: string | null;
  enabled: boolean;
  timezone: string;
}

export interface CustomAgent {
  id: string;
  owner_user_id: string;
  name: string;
  description: string;
  avatar: string | null;
  tags: string[];
  goal_template: string;
  inputs_schema: AgentInfoNeed[];
  cards: AgentCard[];
  links: AgentCardLink[];
  recipients: Recipient[];
  schedule: Schedule;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  run_count: number;
  success_count: number;
  enabled: boolean;
}

export interface RunSpec {
  agent_id: string;
  inputs: Record<string, unknown>;
  track: 'foreground' | 'background';
  note: string | null;
}

export type CustomAgentRunStatus =
  | 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'timeout';

export type CustomAgentRunTrigger =
  | 'manual' | 'schedule' | 'chat' | 'api' | 'card';

export interface CustomAgentRun {
  id: string;
  agent_id: string;
  task_id: string;
  inputs: Record<string, unknown>;
  status: CustomAgentRunStatus;
  started_at: string | null;
  finished_at: string | null;
  summary: string;
  error: string | null;
  triggered_by: CustomAgentRunTrigger;
}

/** GET /studio/cards/catalog response. */
export interface CardCatalogEntry {
  kind: AgentCardKind;
  category: CardCategory;
  title: string;
  description: string;
  icon: string | null;
  /** Default config skeleton when dropping the card on the canvas. */
  default_config: Record<string, unknown>;
  /** Declarative spec for the inspector UI to render. */
  config_schema: Array<{
    key: string;
    label: string;
    kind: 'text' | 'textarea' | 'number' | 'bool' | 'select' | 'multi_select' | 'json';
    required?: boolean;
    placeholder?: string;
    options?: Array<{ id: string; label: string }>;
  }>;
}

export interface CardCatalog {
  entries: CardCatalogEntry[];
}
