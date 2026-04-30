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
    # Phase 9.3a — FIFO short strings, max 10. Populated by heuristics
    # (user-text keyword match, system-state thresholds, recurring task
    # failures). Items decay if not refreshed in 24h.
    active_concerns: list[str] = Field(default_factory=list)
    # Phase 9.3a — last N successful task summaries, max 5. Read-only
    # signal for 9.3b proactive decisions ("recently on a roll → confident
    # enough to suggest X").
    recent_successes: list[str] = Field(default_factory=list)


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
]
