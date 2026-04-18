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
]

TaskStatus = Literal[
    "planning",
    "running",
    "paused",
    "awaiting_user",
    "done",
    "failed",
    "stopped",
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

CheckpointReason = Literal["auto_reflect", "manual", "pause", "shutdown"]


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
    "SelfModel",
    "ThoughtBudget",
    "ReflectionResult",
    "Checkpoint",
    "TaskSummary",
    "AuditEntry",
    "TaskDetail",
]
