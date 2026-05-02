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
  | 'idle'
  // Phase 9.2.3 (F-14) — distinct from waiting_user so the operator can
  // tell quota-parked tasks apart from human-input-required tasks.
  | 'blocked_quota';

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

// Phase 18-COMPLETE — long-running action progress heartbeats.
export type AgentProgressKind = 'checkpoint' | 'eta_update';

export interface AgentProgressUpdate {
  task_id: string;
  kind: AgentProgressKind;
  label: string;
  percent: number | null;
  at: number;
  extra: {
    action?: string;
    elapsed_s?: number;
    eta_remaining_s?: number;
    [key: string]: unknown;
  };
}

export interface AgentProgressSnapshot {
  task_id: string;
  track: AgentTrack;
  started_at: number | null;
  promoted_to_background_at: number | null;
  estimated_duration_s: number | null;
  eta_remaining_s: number | null;
  checkpoints: Array<{
    at: number;
    label: string;
    percent: number | null;
    extra: Record<string, unknown>;
  }>;
}

export interface AgentTaskPromotedEvent {
  task_id: string;
  reason: string;
  promoted_at: number;
}

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

export interface AgentEmotionVector {
  /** 0..1 — task concentration (high = flow state). */
  focus: number;
  /** 0..1 — drive to explore / learn. */
  curiosity: number;
  /** 0..1 — worry / alertness level. */
  concern: number;
  /** 0..1 — accumulated cognitive load. */
  fatigue: number;
  /** ISO datetime of last mutation. */
  updated_at: string;
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
  // Phase 9.3a — persistent caveats + emotion vector.
  active_caveats?: string[];
  emotion?: AgentEmotionVector;
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

/* ─── Task Report (Phase 16) ──────────────────────────────────────────────── */

export type AgentReportGenerationStrategy = 'llm' | 'deterministic' | 'hybrid';

export type AgentEvidenceKind =
  | 'audit'
  | 'observation'
  | 'checkpoint'
  | 'url'
  | 'file'
  | 'other';

export interface AgentKeyDecision {
  step_idx: number;
  sub_goal_id: string | null;
  verdict: AgentReflectionVerdict;
  summary: string;
  confidence: number;
  objection: string | null;
  ts: string | null;
}

export interface AgentEvidenceLink {
  kind: AgentEvidenceKind;
  ref: string;
  label: string;
}

export interface AgentAuditCompact {
  audit_id: number;
  step_idx: number;
  action: string;
  ok: boolean;
  elapsed_ms: number;
  intent: string;
}

export interface AgentTaskReport {
  task_id: string;
  goal: string;
  status: AgentTaskStatus;
  track: AgentTrack;
  duration_ms: number;
  achievements: string[];
  obstacles: string[];
  key_decisions: AgentKeyDecision[];
  next_steps: string[];
  evidence_links: AgentEvidenceLink[];
  audit_trail_compact: AgentAuditCompact[];
  llm_narrative: string | null;
  generated_at: string;
  generation_strategy: AgentReportGenerationStrategy;
  sub_goals_done: number;
  sub_goals_total: number;
  actions_total: number;
  actions_failed: number;
}

/* ─── Council / Multi-Agent Team (Phase 17) ───────────────────────────────── */

export type AgentRoleName =
  | 'planner'
  | 'critic'
  | 'executor'
  | 'researcher'
  | 'risk_assessor'
  | 'aesthete'
  | 'skeptic'
  | 'moderator'
  | 'verifier';

export type AgentOrchestratorMode = 'single' | 'council' | 'swarm';

export type AgentCouncilSituationKind =
  | 'strategic_revise'
  | 'before_destructive'
  | 'low_confidence'
  | 'info_need'
  | 'quality_gate'
  | 'user_invoked';

export interface AgentRoleStatement {
  role: AgentRoleName;
  text: string;
  confidence: number;
  objection_to: AgentRoleName[];
  suggests_action: Record<string, unknown> | null;
  ts: string;
}

export interface AgentCouncilSituation {
  kind: AgentCouncilSituationKind;
  task_id: string;
  summary: string;
  context: Record<string, unknown>;
  proposed_action: Record<string, unknown> | null;
  monologue: AgentInnerMonologue | null;
  sub_goal_id: string | null;
  step_idx: number;
}

export interface AgentCouncilDecision {
  situation: AgentCouncilSituation;
  verdict: 'proceed' | 'revise' | 'abort' | 'ask_user';
  statements: AgentRoleStatement[];
  consensus_summary: string;
  consensus_confidence: number;
  chosen_action: Record<string, unknown> | null;
  rounds_used: number;
  generation_strategy: 'llm' | 'deterministic' | 'hybrid';
  ts: string;
}

/* ─── Information Need Resolution (Phase 17a.5) ──────────────────────────── */

export type AgentInfoNeedKind =
  | 'text'
  | 'single_choice'
  | 'multi_choice'
  | 'file_pick'
  | 'range'
  | 'confirm'
  | 'visual_pick';

export interface AgentInfoNeedOption {
  id: string;
  label: string;
  description: string;
  preview_url: string | null;
  example: string | null;
  badge: string | null;
}

export interface AgentInfoNeed {
  id: string;
  task_id: string;
  kind: AgentInfoNeedKind;
  question: string;
  hint: string | null;
  options: AgentInfoNeedOption[];
  default: unknown | null;
  required: boolean;
  range_min: number | null;
  range_max: number | null;
  range_step: number | null;
  placeholder: string | null;
  ts: string;
  expires_at: string | null;
  resolution_strategy: 'ask' | 'search_first_then_ask';
}

export interface AgentInfoNeedResponse {
  info_need_id: string;
  task_id: string;
  kind: AgentInfoNeedKind;
  answer: unknown;
  submitted_at: string;
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
  // Phase 16 — emitted after a terminal task event when its TaskReport is
  // composed and persisted. Frontend should surface AgentReportScreen and
  // NOT auto-dismiss the OPERATOR layout. Operator must acknowledge via
  // POST /agent/task/{id}/dismiss-report or POST .../resume-as-conversation.
  | 'task.report_ready'
  // Phase 18-COMPLETE — long-running progress heartbeats + fg→bg promotion.
  | 'task.progress'
  | 'task.promoted_to_background'
  // Phase 17 — Council deliberation lifecycle.
  | 'council.round_started'
  | 'council.role_spoke'
  | 'council.consensus_reached'
  | 'council.round_aborted'
  // Phase 17a.5 — operator-facing typed prompts.
  | 'agent.info_need'
  | 'agent.info_need_resolved'
  // Phase 17a — live plan editing audit.
  | 'plan.user_edited'
  // Phase 17a.6 — Quality Gate revision cycles.
  | 'quality_gate.revision_started'
  | 'quality_gate.revision_completed'
  // Phase 9.2.1
  | 'task.blocked_quota'
  // Audit B-18 — backoff retry envelope. runtime.py:584 emits when the
  // recovery probe has back-to-back failed N times.
  | 'task.blocked_quota_backoff'
  | 'sub_goal.abandoned'
  | 'agent.budget.warning'
  // Phase 9.2.2 (F-05) resume caveat
  | 'agent.resumed_with_caveat'
  // Phase 9.3a emotion vector update
  | 'emotion.updated'
  // Phase 9.3b proactive loop heartbeat (light cycle ping)
  | 'proactive.cycle'
  // Audit B-18 — proactive cycle wants user confirmation before firing.
  | 'proactive.pending_action'
  // Audit B-18 — proactive action spawned a background task.
  | 'proactive.action_fired'
  | 'notification';

export interface AgentEvent {
  type: AgentEventType;
  ts: number;
  payload: Record<string, unknown>;
}
