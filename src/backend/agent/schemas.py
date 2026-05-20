"""
Agent type system — Pydantic models that frame the entire cognitive layer.

Action / Plan / Observation / Reflection / Checkpoint shapes; if it isn't here
it isn't a stable contract. Frontend mirrors these in shared/types/agent.ts.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import IntEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Enums (StrEnum-like via Literal where Pydantic v2 plays nicer) ────────────

class RiskLevel(IntEnum):
    SAFE = 1
    LOW = 3
    MEDIUM = 5
    HIGH = 7  # reserved


# String-valued enums use Literal aliases — Pydantic v2 + JSON serialisation
# treats them as plain strings, which keeps audit blobs LLM-friendly.

Substate = Literal[
    "thinking",
    "acting",
    "reflecting",
    "waiting_user",
    "paused",
    "idle",
    # Phase 9.2.3 (F-14): distinct from `waiting_user` so the operator can
    # tell at a glance whether the task is parked on quota exhaustion
    # (auto-resumes on probe) vs. a real user-input prompt.
    "blocked_quota",
]

TaskStatus = Literal[
    "planning",
    "running",
    "paused",
    "awaiting_user",
    # Phase 9.2.1 — task can't make LLM progress because both primary and
    # fallback are quota-exhausted/cooling. Distinct from `failed` because
    # the runtime auto-resumes when a probe call succeeds.
    "blocked_quota",
    "done",
    "failed",
    "stopped",
    # Phase 9.4a — background task exceeded its configured timeout and was
    # finalized by the runtime. Distinct from `failed` so the UI + analytics
    # can distinguish "code broke" from "ran out of wall-clock budget".
    "timeout",
]

SubGoalStatus = Literal[
    "pending",
    "active",
    "done",
    "failed",
    "skipped",
]

ObservationTypeT = Literal[
    "result",
    "error",
    "reflection",
    "user_input",
    "env_change",
    "system",
]

ReflectionVerdict = Literal[
    "continue",
    "revise_subgoal",
    "revise_strategy",
    "abandon_task",
    "wait_user",
]

Track = Literal["foreground", "background"]

CheckpointReason = Literal[
    "auto_reflect",
    "manual",
    "pause",
    "shutdown",
    # Phase 5 R1 — sandbox subprocess completion (linux/executor.py).
    # Lets `executor.checkpoint(session_id)` persist a Checkpoint row
    # without abusing one of the planner-loop reasons.
    "sandbox_complete",
]


# ── Sub-goal / plan ───────────────────────────────────────────────────────────

class SubGoal(BaseModel):
    id: str = Field(default_factory=_uuid)
    description: str
    rationale: str
    expected_actions: int = 3
    status: SubGoalStatus = "pending"
    acceptance_criteria: str = ""
    actions_used: int = 0


class InnerMonologue(BaseModel):
    """Structured thinking captured alongside each plan step."""
    what_i_see: str = ""
    what_i_plan: str = ""
    why_this_works: str = ""
    what_could_fail: str = ""
    objection: str | None = None  # devil's-buddy soft review, MEDIUM+ risk only
    confidence: float = 1.0  # 0..1


class PlanStep(BaseModel):
    step_idx: int
    sub_goal_id: str | None = None
    action: str
    args: dict[str, Any] = Field(default_factory=dict)
    intent: str = ""
    monologue: InnerMonologue = Field(default_factory=InnerMonologue)
    retried_from: int | None = None
    ts: datetime = Field(default_factory=_utcnow)


class StrategicPlan(BaseModel):
    sub_goals: list[SubGoal]
    estimated_total_actions: int = 0
    risk_assessment: str = ""
    # Phase 28-IDEAL — Extreme Professionalism additions.
    architectural_rationale: str = "" # High-level justification for the chosen approach (ADR-lite)
    required_capabilities: list[str] = Field(default_factory=list) # Declared tool/package dependencies


# ── Observations ─────────────────────────────────────────────────────────────

class Observation(BaseModel):
    step_idx: int
    type: ObservationTypeT
    source: str
    content: str
    confidence: float = 1.0
    entities: list[str] = Field(default_factory=list)
    ts: datetime = Field(default_factory=_utcnow)


# ── Action result + preconditions ────────────────────────────────────────────

PreconditionFailureMode = Literal["skip", "reflect", "ask_user", "abandon"]


class Precondition(BaseModel):
    key: str
    required: Any = None
    failure_mode: PreconditionFailureMode = "abandon"


class ActionResult(BaseModel):
    ok: bool
    output: Any | None = None
    error: str | None = None
    error_class: str | None = None
    elapsed_ms: int = 0
    # Phase 28-IDEAL — mark actions that significantly exceeded expectations.
    performance_warning: str | None = None
    sandboxed: bool | None = None
    side_effects: list[str] = Field(default_factory=list)


# ── Self-model + thought-budget ──────────────────────────────────────────────

class EmotionVector(BaseModel):
    """
    Phase 9.3a — PHANTOM's structured emotional state.

    NOT a simulation of consciousness. This is a four-axis bounded modulation
    of agent style (monologue tone, prompt emphasis). Values in [0, 1]; events
    apply bounded deltas; a background decay loop drifts each axis back toward
    a baseline over time. Planner prompts inject a one-line Ukrainian summary
    + the raw numbers so the LLM can colour its reasoning but never lets
    emotion drive action selection.
    """
    focus: float = 0.7       # task concentration; high = flow state
    curiosity: float = 0.5   # drive to explore / learn
    concern: float = 0.2     # worry / alertness level
    fatigue: float = 0.0     # accumulated cognitive load
    updated_at: datetime = Field(default_factory=_utcnow)

    def clamp(self) -> "EmotionVector":
        """Return a copy with every axis coerced back into [0, 1]."""
        def _c(v: float) -> float:
            return max(0.0, min(1.0, float(v)))
        return EmotionVector(
            focus=_c(self.focus),
            curiosity=_c(self.curiosity),
            concern=_c(self.concern),
            fatigue=_c(self.fatigue),
            updated_at=self.updated_at,
        )

    def summary(self) -> str:
        """One-line human-readable summary, Ukrainian.

        Label rules are conservative: only axis values >= 0.6 are called out,
        so short summaries stay uncluttered. Combinations get a compound
        descriptor; all-baseline yields "спокійний".
        """
        labels: list[str] = []
        if self.focus >= 0.8:
            labels.append("у потоці")
        elif self.focus >= 0.6:
            labels.append("зосереджений")
        if self.curiosity >= 0.6:
            labels.append("цікаво")
        if self.concern >= 0.6:
            labels.append("стурбований")
        if self.fatigue >= 0.6:
            labels.append("втомлений")
        if not labels:
            return "спокійний"
        return ", ".join(labels)


class Relationship(BaseModel):
    """
    Phase 9.3a — per-user relational memory.

    Populated by authenticated-call hooks (interaction count + last
    interaction timestamp) plus explicit preference additions. Trust
    level is a reserved axis — 9.3b will nudge it via intervention
    feedback. Auto-inferred preferences are deferred (LLM classification
    is out of 9.3a scope).
    """
    user_id: str
    trust_level: float = 0.5
    interaction_count: int = 0
    last_interaction_at: datetime | None = None
    known_preferences: list[str] = Field(default_factory=list)


class SelfModel(BaseModel):
    identity: str = "PHANTOM, embedded AI operating system"
    hardware: dict[str, Any] = Field(default_factory=dict)
    capabilities: list[str] = Field(default_factory=list)
    risk_tolerance: RiskLevel = RiskLevel.MEDIUM
    current_track: Track = "foreground"
    active_connections: list[str] = Field(default_factory=list)
    recent_task_summary: str | None = None
    # Phase 9.2 — Ukrainian primary persona, English technical-term fallback.
    language_primary: str = "uk"
    language_fallback: str = "en"
    
    # Phase 30 — Org-Chart Role Integration
    # agent_role_id: ID from agent_roles table (e.g. 'role-back', 'role-ceo')
    # agent_role_context: Full context object including extension prompt and orders.
    agent_role_id: str | None = None
    agent_role_context: dict[str, Any] | None = None
    
    # Phase 9.3a (AD-01) — persistent caveats injected into every planner
    # prompt. Observations slide off the 10-item tactical window on long
    # tasks; the SelfModel is read in full every turn, so resume hints
    # (e.g. "browser session reset") survive. Cleared by the relevant
    # action once the caveat is no longer applicable (see executor's
    # browser.navigate clear path).
    active_caveats: list[str] = Field(default_factory=list)
    # Phase 9.3a — structured emotional state (focus/curiosity/concern/
    # fatigue). Event-driven updates from runtime._broadcast triggers;
    # background decay loop drifts each axis toward baseline.
    emotion: EmotionVector = Field(default_factory=EmotionVector)
    # Phase 9.3a — per-user Relationship. Keyed by user_id. Updated by
    # auth-hooked dependency on every authenticated call that reaches the
    # agent so the planner can tailor prompts.
    relationships: dict[str, Relationship] = Field(default_factory=dict)
    # Phase 28-STABILITY — proven dead ends for this task.
    dead_ends: list[str] = Field(default_factory=list)
    # Phase 9.3a — FIFO short strings, max 10. Populated by heuristics
    # (user-text keyword match, system-state thresholds, recurring task
    # failures). Items decay if not refreshed in 24h.
    active_concerns: list[str] = Field(default_factory=list)
    # Phase 9.3a — last N successful task summaries, max 5. Read-only
    # signal for 9.3b proactive decisions ("recently on a roll → confident
    # enough to suggest X").
    recent_successes: list[str] = Field(default_factory=list)
    # Phase 28-IDEAL — track performance trends per action name.
    # { "action_name": [ms1, ms2, ... ms5] }
    performance_history: dict[str, list[int]] = Field(default_factory=dict)


class ThoughtBudget(BaseModel):
    estimated_actions: int = 0
    actions_used: int = 0
    force_reflect_ratio: float = 2.0
    reflections_done: int = 0


# ── Reflection ──────────────────────────────────────────────────────────────

class ReflectionResult(BaseModel):
    verdict: ReflectionVerdict = "continue"
    summary: str = ""
    progress_assessment: str = ""
    recurring_errors: list[str] = Field(default_factory=list)
    recommendations: str = ""
    new_confidence: float = 0.5


# ── Checkpoint ───────────────────────────────────────────────────────────────

class Checkpoint(BaseModel):
    task_id: str
    created_at: datetime = Field(default_factory=_utcnow)
    reason: CheckpointReason
    self_model: SelfModel
    goal: str
    sub_goals: list[SubGoal] = Field(default_factory=list)
    active_sub_goal_id: str | None = None
    observations: list[Observation] = Field(default_factory=list)
    thought_budget: ThoughtBudget = Field(default_factory=ThoughtBudget)
    last_reflection: ReflectionResult | None = None
    step_idx: int = 0


# ── Task surface (API + WS payloads) ────────────────────────────────────────

class TaskSummary(BaseModel):
    id: str
    goal: str
    status: TaskStatus
    track: Track = "foreground"
    paused_reason: str | None = None
    error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class AuditEntry(BaseModel):
    id: int
    task_id: str
    step_idx: int
    sub_goal_id: str | None = None
    action_name: str
    args: dict[str, Any] = Field(default_factory=dict)
    intent: str | None = None
    monologue: InnerMonologue | None = None
    result: ActionResult
    risk_level: int
    elapsed_ms: int
    retried_from: int | None = None
    timestamp: datetime


class TaskDetail(BaseModel):
    task: TaskSummary
    sub_goals: list[SubGoal] = Field(default_factory=list)
    self_model: SelfModel | None = None
    observations: list[Observation] = Field(default_factory=list)
    thought_budget: ThoughtBudget | None = None
    last_audit: list[AuditEntry] = Field(default_factory=list)


# ── Task Report (Phase 16) ───────────────────────────────────────────────────
#
# Composed at task finalization (or on-demand via GET /agent/task/{id}/report).
# Surfaced to the user as a "result screen" that does NOT auto-dismiss — the
# operator must explicitly acknowledge it (close / continue-as-conversation).
# Two generation strategies: LLM-narrative (rich prose) and deterministic
# fallback (audit-derived bullets) so the report ALWAYS shows even when both
# AI providers are quota-exhausted (П-1 offline-resilience principle).

ReportGenerationStrategy = Literal["llm", "deterministic", "hybrid"]


class KeyDecision(BaseModel):
    """A reflection or pivotal decision worth surfacing in the report."""
    step_idx: int = 0
    sub_goal_id: str | None = None
    verdict: ReflectionVerdict = "continue"
    summary: str = ""
    confidence: float = 0.5
    objection: str | None = None
    ts: datetime | None = None


class EvidenceLink(BaseModel):
    """A pointer to artefact produced/referenced during the run."""
    kind: Literal["audit", "observation", "checkpoint", "url", "file", "other"] = "audit"
    ref: str = ""  # audit_id, observation step_idx, checkpoint id, URL, path
    label: str = ""


class AuditCompact(BaseModel):
    """Slim audit row for report timeline (full row available via /audit)."""
    audit_id: int = 0
    step_idx: int = 0
    action: str = ""
    ok: bool = True
    elapsed_ms: int = 0
    intent: str = ""


class TaskReport(BaseModel):
    """Structured report rendered after task completion. Phase 16."""
    task_id: str
    goal: str
    status: TaskStatus
    track: Track = "foreground"
    duration_ms: int = 0
    achievements: list[str] = Field(default_factory=list)
    obstacles: list[str] = Field(default_factory=list)
    key_decisions: list[KeyDecision] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    evidence_links: list[EvidenceLink] = Field(default_factory=list)
    audit_trail_compact: list[AuditCompact] = Field(default_factory=list)
    llm_narrative: str | None = None
    generated_at: datetime = Field(default_factory=_utcnow)
    generation_strategy: ReportGenerationStrategy = "deterministic"
    # Aggregate counts useful for the hero strip (avoid recompute on FE).
    sub_goals_done: int = 0
    sub_goals_total: int = 0
    actions_total: int = 0
    actions_failed: int = 0


# ── Council / Multi-Agent Team (Phase 17) ────────────────────────────────────
#
# A "Council" is a small group (3-7) of AgentRoles that deliberate ONE round
# before the agent commits to a decision. Distinct from "Swarm" — which spawns
# parallel independent task branches and merges them later. Council is a
# debate; Swarm is parallel work.

RoleName = Literal[
    "planner",
    "critic",
    "executor",
    "researcher",
    "risk_assessor",
    "aesthete",      # UI / visual / creative voice
    "skeptic",
    "moderator",     # picks consensus
    "verifier",      # post-action sanity check (Quality Gate)
]

OrchestratorMode = Literal["single", "council", "swarm"]

CouncilSituationKind = Literal[
    "strategic_revise",     # reflection asked for a strategy revision
    "before_destructive",   # next action is risky / irreversible
    "low_confidence",       # monologue confidence < threshold
    "info_need",            # agent needs to ask user something
    "quality_gate",         # output review (Quality Gate Loop)
    "user_invoked",         # operator explicitly demanded a Council round
    # Phase 23-D — risk-tolerance gate fires Council BEFORE phone/desktop
    # approval so a verdict of "abort"/"revise" can short-circuit a
    # destructive ask before the operator even sees it.
    "high_risk_action",
]


class RoleStatement(BaseModel):
    """Single role's contribution within one Council round."""
    role: RoleName
    text: str
    confidence: float = 0.5
    objection_to: list[RoleName] = Field(default_factory=list)
    suggests_action: dict[str, Any] | None = None
    ts: datetime = Field(default_factory=_utcnow)


class CouncilSituation(BaseModel):
    """Snapshot of state pushed into a Council round."""
    kind: CouncilSituationKind
    task_id: str
    summary: str
    context: dict[str, Any] = Field(default_factory=dict)
    proposed_action: dict[str, Any] | None = None
    monologue: InnerMonologue | None = None
    sub_goal_id: str | None = None
    step_idx: int = 0


class CouncilDecision(BaseModel):
    """Outcome of a Council round."""
    situation: CouncilSituation
    verdict: Literal["proceed", "revise", "abort", "ask_user"] = "proceed"
    statements: list[RoleStatement] = Field(default_factory=list)
    consensus_summary: str = ""
    consensus_confidence: float = 0.5
    chosen_action: dict[str, Any] | None = None
    rounds_used: int = 1
    generation_strategy: Literal["llm", "deterministic", "hybrid"] = "deterministic"
    ts: datetime = Field(default_factory=_utcnow)


# ── Information Need Resolution (Phase 17a.5) ───────────────────────────────
#
# When an agent doesn't know something, it tries (in order): cache → web search
# → ask user. The "ask user" path uses a typed prompt with rich UI variants so
# operators are nudged toward the easiest possible reply.

InfoNeedKind = Literal[
    "text",
    "single_choice",
    "multi_choice",
    "file_pick",
    "range",
    "confirm",
    "visual_pick",
]


class InfoNeedOption(BaseModel):
    """One option for single_choice / multi_choice / visual_pick."""
    id: str
    label: str
    description: str = ""
    preview_url: str | None = None  # image / video / asset hint for visual_pick
    example: str | None = None      # short illustrative quote
    badge: str | None = None        # eyebrow tag like "найдешевше" / "swiftest"


class InfoNeed(BaseModel):
    """Typed prompt the agent shows the operator."""
    id: str = Field(default_factory=_uuid)
    task_id: str
    kind: InfoNeedKind
    question: str
    hint: str | None = None
    options: list[InfoNeedOption] = Field(default_factory=list)
    default: Any | None = None
    required: bool = True
    range_min: float | None = None
    range_max: float | None = None
    range_step: float | None = None
    placeholder: str | None = None
    ts: datetime = Field(default_factory=_utcnow)
    expires_at: datetime | None = None
    resolution_strategy: Literal["ask", "search_first_then_ask"] = "ask"


class InfoNeedResponse(BaseModel):
    """Operator's reply to an InfoNeed."""
    info_need_id: str
    task_id: str
    kind: InfoNeedKind
    answer: Any  # string | list[str] | dict | float | bool, validated per kind
    submitted_at: datetime = Field(default_factory=_utcnow)


# ── Block C-1 — Mission + Phase Pydantic schemas ─────────────────────────────
#
# MissionBrief    — what the operator submits (input gate).
# MissionPlan     — what the strategic planner emits (decomposed phases).
# PhaseSpec       — per-phase plan shape, mirrors Phase ORM minus DB metadata.
#
# acceptance_criteria_raw on PhaseSpec intentionally stays as list[dict] —
# Block D will formalise the AcceptanceCriterion model. Keeping it raw here
# avoids a breaking schema change when D lands.

MissionStatus = Literal[
    "planning",
    "running",
    "paused",
    "done",
    "failed",
    "abandoned",
]


class BudgetConstraints(BaseModel):
    """Optional resource cap for a mission."""
    max_usd: float | None = None
    max_wall_hours: float | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class MissionBrief(BaseModel):
    """What the operator provides when initiating a mission.

    Only ``brief`` is required. The planner derives ``success_criteria`` and
    emits them via ``MissionPlan`` after the first LLM call.
    """
    brief: str = Field(..., description="Operator's original prompt, verbatim.")
    quality_bar: str = Field(
        default="",
        description="Operator's qualitative 'what good looks like'. May be empty.",
    )
    deadline_at: datetime | None = Field(
        default=None,
        description="Optional wall-clock deadline (UTC).",
    )
    budget_constraints: BudgetConstraints | None = Field(
        default=None,
        description="Optional resource caps (USD, wall hours, etc.).",
    )


class PhaseSpec(BaseModel):
    """Planner-emitted spec for a single mission phase.

    Mirrors the Phase ORM shape minus DB-managed metadata (id, mission_id,
    started_at, finished_at). ``acceptance_criteria_raw`` is intentionally
    untyped until Block D formalises AcceptanceCriterion.
    """
    description: str
    rationale: str = ""
    success_criteria: str = ""
    expected_duration_h: float = 0.0
    # Declared output files: [{"path": "...", "kind": "file|blend|...", "produced": false}]
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    # Block D will replace this with list[AcceptanceCriterion]; raw for now.
    acceptance_criteria_raw: list[dict[str, Any]] = Field(default_factory=list)


class MissionPlan(BaseModel):
    """What the strategic planner emits after decomposing the operator's brief.

    ``phases`` must be ordered (index 0 = first phase to execute).
    ``success_criteria`` is the top-level mission acceptance bar, distinct from
    per-phase criteria inside each PhaseSpec.
    """
    success_criteria: str = Field(
        ...,
        description="Top-level acceptance bar for the entire mission.",
    )
    phases: list[PhaseSpec] = Field(
        ...,
        description="Ordered phase decomposition (idx 0 = first).",
    )
    risk_assessment: str = ""


__all__ = [
    "RiskLevel",
    "Substate",
    "TaskStatus",
    "SubGoalStatus",
    "ObservationTypeT",
    "ReflectionVerdict",
    "Track",
    "CheckpointReason",
    "PreconditionFailureMode",
    "SubGoal",
    "InnerMonologue",
    "PlanStep",
    "StrategicPlan",
    "Observation",
    "Precondition",
    "ActionResult",
    "EmotionVector",
    "Relationship",
    "SelfModel",
    "ThoughtBudget",
    "ReflectionResult",
    "Checkpoint",
    "TaskSummary",
    "AuditEntry",
    "TaskDetail",
    "ReportGenerationStrategy",
    "KeyDecision",
    "EvidenceLink",
    "AuditCompact",
    "TaskReport",
    # Phase 17 — Council
    "RoleName",
    "OrchestratorMode",
    "CouncilSituationKind",
    "RoleStatement",
    "CouncilSituation",
    "CouncilDecision",
    # Phase 17a.5 — InfoNeed
    "InfoNeedKind",
    "InfoNeedOption",
    "InfoNeed",
    "InfoNeedResponse",
    # Block C-1 — Mission + Phase
    "MissionStatus",
    "BudgetConstraints",
    "MissionBrief",
    "PhaseSpec",
    "MissionPlan",
    # Vertical V10 — Mission Report
    "MissionReportPhase",
    "MissionReport",
]


# ── Vertical V10 — Mission Report schemas ─────────────────────────────────────
#
# MissionReport is the operator-facing postmortem for a completed (or stopped)
# mission. It is composed by MissionReportComposer in agent/reports.py and
# exported to PDF / HTML dashboard via agent/missions/pdf_export.py and
# agent/missions/html_dashboard.py.
#
# Design decisions:
#  • `visual_snapshot_b64` is optional per phase — most phases won't have a
#    screenshot; only those where the agent ran `mission.snapshot`.
#  • `resource_summary` is a free dict so we can extend with per-device fields
#    (GPU temp, disk iops, etc.) without a schema break.
#  • `budget_spent_usd` is None when no budget tracking was in use.


class MissionReportPhase(BaseModel):
    """Per-phase slice of the mission postmortem."""

    idx: int
    description: str
    success_criteria: str
    status: str
    duration_h: float | None
    achievements: list[str]
    decisions: list[dict[str, str]]     # [{summary, verdict, objection?}]
    artifacts: list[dict[str, str]]     # [{path, kind, size_bytes, embedded?}]
    lessons: list[str]
    failure_modes: list[str]
    visual_snapshot_b64: str | None = None  # embedded preview if available


class MissionReport(BaseModel):
    """Structured postmortem for a complete mission. Vertical V10."""

    mission_id: str
    brief: str
    success_criteria: str
    quality_bar: str | None
    status: str
    started_at: str
    finished_at: str | None
    wall_duration_h: float
    overall_summary: str
    phases: list[MissionReportPhase]
    total_artifacts: int
    total_decisions: int
    aggregate_lessons: list[str]
    resource_summary: dict[str, Any]
    council_engagements: int
    budget_spent_usd: float | None
    composed_at: str
