/**
 * Mission — shared types for the long-horizon mission machinery.
 *
 * Mirror of src/backend/agent/schemas.py (Block C-1 + Vertical V10).
 * Keep in sync with Pydantic models on the backend.
 */

export interface BudgetConstraints {
  max_usd?: number | null;
  max_wall_hours?: number | null;
  max_tokens?: number | null;
}

export interface MissionBrief {
  brief: string;
  quality_bar?: string;
  deadline_at?: string | null;
  budget_constraints?: BudgetConstraints | null;
  unsafe_mode?: boolean;
}

export type MissionStatus =
  | 'planning'
  | 'running'
  | 'paused'
  | 'awaiting_user'
  | 'blocked_quota'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'abandoned';

export interface MissionPhaseArtifact {
  path: string;
  kind: string;
  produced?: boolean;
  size_bytes?: number;
}

export interface MissionPhase {
  id: string;
  mission_id: string;
  idx: number;
  description: string;
  rationale: string;
  success_criteria: string;
  expected_duration_h: number;
  status: MissionStatus;
  artifacts_json: MissionPhaseArtifact[] | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface MissionSummary {
  id: string;
  brief: string;
  status: MissionStatus;
  created_at: string;
  finished_at: string | null;
  ledger_path: string;
  phase_count: number;
  phases_done: number;
}

export interface MissionDetail extends MissionSummary {
  quality_bar: string | null;
  deadline_at: string | null;
  budget_constraints_json: BudgetConstraints | null;
  success_criteria: string;
  phases: MissionPhase[];
  ledger_text?: string;
}

export interface MissionReportDecision {
  summary: string;
  verdict: string;
  objection?: string;
}

export interface MissionReportArtifact {
  path: string;
  kind: string;
  size_bytes?: number;
  embedded?: string;
}

export interface MissionReportPhase {
  idx: number;
  description: string;
  success_criteria: string;
  status: string;
  duration_h: number | null;
  achievements: string[];
  decisions: MissionReportDecision[];
  artifacts: MissionReportArtifact[];
  lessons: string[];
  failure_modes: string[];
  visual_snapshot_b64?: string | null;
}

export interface MissionReport {
  mission_id: string;
  brief: string;
  success_criteria: string;
  quality_bar: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  wall_duration_h: number;
  overall_summary: string;
  phases: MissionReportPhase[];
  total_artifacts: number;
  total_decisions: number;
  aggregate_lessons: string[];
  resource_summary: Record<string, unknown>;
  council_engagements: number;
  budget_spent_usd: number | null;
  composed_at: string;
}

/* ─── WS event payload shapes ─────────────────────────────────────────────── */

export interface MissionStartedEvent {
  mission_id: string;
  task_id: string;
  brief: string;
  phase_count: number;
}

export interface MissionPhaseStartedEvent {
  mission_id: string;
  phase_id: string;
  idx: number;
  description: string;
}

export interface MissionPhaseCompletedEvent {
  mission_id: string;
  phase_id: string;
  idx: number;
  duration_s: number;
}

export interface MissionCompletedEvent {
  mission_id: string;
  wall_duration_h: number;
}

export interface MissionFailedEvent {
  mission_id: string;
  reason: string;
}
