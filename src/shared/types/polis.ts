/** ПОЛІС — universal agency substrate. Shared contracts frontend ⇄ backend. */

export type PolisDomain =
  | 'dev'
  | 'research'
  | 'analytics'
  | 'document'
  | 'game'
  | 'generic';

export type PolisNodeKind =
  | 'workstream'
  | 'gate'
  | 'artifact'
  | 'checkpoint'
  | 'submission';

export type PolisNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'review'
  | 'done'
  | 'failed'
  | 'skipped';

export type PolisGateKind = 'operator' | 'budget' | 'quality' | 'risk';

export interface PolisCrewSpec {
  roles: string[];
  size: number;
  lead?: string;
}

export interface PolisNodeBudget {
  max_tokens: number;
  max_llm_calls: number;
  spent_tokens: number;
  spent_llm_calls: number;
}

export interface PolisNode {
  id: string;
  kind: PolisNodeKind;
  title: string;
  domain: PolisDomain;
  depends_on: string[];
  status: PolisNodeStatus;
  crew?: PolisCrewSpec;
  gate_kind?: PolisGateKind;
  budget: PolisNodeBudget;
  artifact_paths: string[];
  eta_minutes: number;
  attempts: number;
  max_attempts: number;
  output_summary?: string;
  error?: string;
  started_at?: string;
  finished_at?: string;
}

export type PolisMissionStatus =
  | 'planning'
  | 'running'
  | 'paused'
  | 'awaiting_gate'
  | 'done'
  | 'failed'
  | 'killed';

export interface PolisMission {
  id: string;
  title: string;
  brief: string;
  pipeline: string;
  domain: PolisDomain;
  status: PolisMissionStatus;
  nodes: PolisNode[];
  progress: number;
  critical_path: string[];
  eta_minutes: number;
  budget: PolisNodeBudget;
  created_at: string;
  updated_at: string;
}

/* ── KeyVault ─────────────────────────────────────────────────────────── */

export type ManagedKeyState =
  | 'active'
  | 'cooling'
  | 'exhausted'
  | 'invalid'
  | 'disabled';

export interface ManagedKeyMetrics {
  requests_1m: number;
  requests_1h: number;
  requests_24h: number;
  tokens_24h: number;
  failures_24h: number;
  last_used_at?: string;
}

export interface ManagedKeyPublic {
  id: string;
  provider: string;
  label: string;
  priority: number;
  state: ManagedKeyState;
  cooldown_until?: string;
  key_hint: string;
  metrics: ManagedKeyMetrics;
}

/* ── Governor / city ──────────────────────────────────────────────────── */

export interface PolisCitizen {
  id: string;
  name: string;
  role: string;
  district: PolisDomain | 'plaza';
  activity: 'idle' | 'working' | 'reviewing' | 'blocked';
  mission_id?: string;
  node_id?: string;
  missions_done: number;
}

export interface PolisGovernorState {
  wave_size: number;
  max_wave: number;
  running_nodes: number;
  queued_nodes: number;
  night_mode: boolean;
}

export interface PolisGate {
  id: string;
  mission_id: string;
  node_id: string;
  kind: PolisGateKind;
  question: string;
  payload_preview?: string;
  opened_at: string;
}

export interface PolisSnapshot {
  missions: PolisMission[];
  citizens: PolisCitizen[];
  keys: ManagedKeyPublic[];
  gates: PolisGate[];
  governor: PolisGovernorState;
}

/* ── WS deltas (channel: "polis") ─────────────────────────────────────── */

export type PolisWsType =
  | 'snapshot'
  | 'node_status'
  | 'mission_status'
  | 'gate_opened'
  | 'gate_closed'
  | 'key_state'
  | 'citizen_update'
  | 'wave'
  | 'budget_alert';

export interface PolisWsEvent {
  type: PolisWsType;
  data: Record<string, unknown>;
}
