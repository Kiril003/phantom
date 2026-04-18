/**
 * Agent — Phase 9.1 Cognitive Seed.
 *
 * Mirror of src/backend/agent/schemas.py — keep these in sync.
 */

export type AgentSubstate =
  | 'thinking'
  | 'acting'
  | 'reflecting'
  | 'waiting_user'
  | 'paused'
  | 'idle';

export type AgentTaskStatus =
  | 'planning'
  | 'running'
  | 'paused'
  | 'awaiting_user'
  // Phase 9.2.1 — both primary and fallback providers are quota-exhausted
  // / cooling; runtime probes every 60s and auto-resumes when one recovers.
  | 'blocked_quota'
  | 'done'
  | 'failed'
  | 'stopped';

export type AgentSubGoalStatus =
  | 'pending'
  | 'active'
  | 'done'
  | 'failed'
  | 'skipped';

export type AgentObservationType =
  | 'result'
  | 'error'
  | 'reflection'
  | 'user_input'
  | 'env_change'
  | 'system';

export type AgentReflectionVerdict =
  | 'continue'
  | 'revise_subgoal'
  | 'revise_strategy'
  | 'abandon_task'
  | 'wait_user';

export type AgentTrack = 'foreground' | 'background';

export type AgentRiskLevel = 1 | 3 | 5 | 7; // SAFE / LOW / MEDIUM / HIGH

export interface AgentInnerMonologue {
  what_i_see: string;
  what_i_plan: string;
  why_this_works: string;
  what_could_fail: string;
  objection: string | null;
  confidence: number;
}

export interface AgentSubGoal {
  id: string;
  description: string;
  rationale: string;
  expected_actions: number;
  acceptance_criteria: string;
  status: AgentSubGoalStatus;
  actions_used: number;
}

export interface AgentPlanStep {
  step_idx: number;
  sub_goal_id: string | null;
  action: string;
  args: Record<string, unknown>;
  intent: string;
  monologue: AgentInnerMonologue;
  retried_from: number | null;
  ts: string;
}

export interface AgentObservation {
  step_idx: number;
  type: AgentObservationType;
  source: string;
  content: string;
  confidence: number;
  entities: string[];
  ts: string;
}

export interface AgentActionResult {
  ok: boolean;
  output?: unknown;
  error?: string | null;
  error_class?: string | null;
  elapsed_ms: number;
  sandboxed?: boolean | null;
  side_effects: string[];
}

export interface AgentSelfModel {
  identity: string;
  hardware: Record<string, unknown>;
  capabilities: string[];
  risk_tolerance: AgentRiskLevel;
  current_track: AgentTrack;
  active_connections: string[];
  recent_task_summary: string | null;
  language_primary: string;
  language_fallback: string;
}

export interface AgentThoughtBudget {
  estimated_actions: number;
  actions_used: number;
  force_reflect_ratio: number;
  reflections_done: number;
}

export interface AgentReflectionResult {
  verdict: AgentReflectionVerdict;
  summary: string;
  progress_assessment: string;
  recurring_errors: string[];
  recommendations: string;
  new_confidence: number;
}

export interface AgentTaskSummary {
  id: string;
  goal: string;
  status: AgentTaskStatus;
  track: AgentTrack;
  paused_reason: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AgentAuditEntry {
  id: number;
  task_id: string;
  step_idx: number;
  sub_goal_id: string | null;
  action_name: string;
  args: Record<string, unknown>;
  intent: string | null;
  monologue: AgentInnerMonologue | null;
  result: AgentActionResult;
  risk_level: number;
  elapsed_ms: number;
  retried_from: number | null;
  timestamp: string;
}

export interface AgentTaskDetail {
  task: AgentTaskSummary;
  sub_goals: AgentSubGoal[];
  self_model: AgentSelfModel | null;
  observations: AgentObservation[];
  thought_budget: AgentThoughtBudget | null;
  last_audit: AgentAuditEntry[];
}

/* ─── WS event surface ────────────────────────────────────────────────────── */

export type AgentEventType =
  | 'task.started'
  | 'strategic_plan.created'
  | 'sub_goal.started'
  | 'sub_goal.done'
  | 'thinking.started'
  | 'thinking.completed'
  | 'plan.step_created'
  | 'tool.selected'
  | 'action.started'
  | 'action.completed'
  | 'action.failed'
  | 'retry.started'
  | 'observation.added'
  | 'reflection.started'
  | 'reflection.completed'
  | 'substate.changed'
  | 'checkpoint.created'
  | 'warning.issued'
  | 'task.paused'
  | 'task.resumed'
  | 'task.waiting_user'
  | 'task.intervention_received'
  | 'task.completed'
  | 'task.stopped'
  | 'task.failed'
  | 'notification';

export interface AgentEvent {
  type: AgentEventType;
  ts: number;
  payload: Record<string, unknown>;
}
