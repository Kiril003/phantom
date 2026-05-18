"""
Pydantic models for Agent Studio.

A `CustomAgent` is a saved, parameterised, re-runnable workflow. Cards stitch
together its behaviour (DAG: sources → transforms → decisions → outputs).
Schedules let it run on its own; recipients let it deliver results to people.

The shapes are deliberately wide: card `config` is a free-form dict so adding
new card types doesn't require schema migrations. Validation is per-card-type
(see studio.validate.validate_agent).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..schemas import InfoNeed


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Card surface ──────────────────────────────────────────────────────────────
#
# A card is one composable behaviour block. Cards have `kind` (machine name)
# and `category` (UI grouping). The compiler turns the DAG into sub-goals +
# action sequences understood by the existing agent loop.

CardCategory = Literal["source", "transform", "decision", "output", "council"]

AgentCardKind = Literal[
    # Source
    "web_search", "rss", "email_inbox", "file_watch", "api_poll",
    "db_query", "mobile_sensor",
    # Transform
    "summarize", "compare", "filter", "sort", "extract", "diff", "score",
    # Decision
    "if", "branch", "loop", "retry", "ask_user",
    # Output
    "write_file", "send_email", "send_telegram", "post_to_api",
    "create_report", "notify",
    # Council
    "review_by_council",
    # Artifact
    "artifact",
]


class AgentCardLink(BaseModel):
    """Edge in the card DAG."""
    from_card_id: str
    to_card_id: str
    label: str | None = None  # used for branch labels (true/false/etc.)


class AgentCard(BaseModel):
    """One block of saved agent behaviour."""
    id: str = Field(default_factory=_uuid)
    kind: AgentCardKind
    category: CardCategory
    title: str = ""
    description: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    # Position on the canvas (UI-only). Persisted so reopening the builder
    # preserves the layout.
    x: float = 0.0
    y: float = 0.0
    # Required-input descriptors that get rolled into the agent's run-time
    # InfoNeeds. Cards can declare per-card asks ("which Telegram channel?").
    info_needs: list[InfoNeed] = Field(default_factory=list)


# ── Recipients & schedules ────────────────────────────────────────────────────

RecipientChannel = Literal[
    "email",
    "telegram",
    "sms",
    "file",
    "chat_self",        # post into PHANTOM's own chat for the operator
    "phantom_notify",   # in-OS notification
    "webhook",
]


class Recipient(BaseModel):
    id: str = Field(default_factory=_uuid)
    channel: RecipientChannel
    target: str  # email address / telegram chat_id / file path / URL
    label: str | None = None
    enabled: bool = True


ScheduleKind = Literal["manual", "interval", "cron", "conditional", "one_shot_future"]


class Schedule(BaseModel):
    kind: ScheduleKind = "manual"
    # interval: every N seconds.
    interval_s: int | None = None
    # cron expression (5-field).
    cron_expr: str | None = None
    # conditional: simple DSL evaluated against ContextSnapshot (e.g.
    # "breathing_bpm > 90"). Re-uses the standing_orders condition parser.
    condition: str | None = None
    # one_shot_future: fire once at this UTC datetime then disable.
    fire_at: datetime | None = None
    enabled: bool = True
    timezone: str = "Europe/Kyiv"


# ── CustomAgent + runs ────────────────────────────────────────────────────────


class CustomAgent(BaseModel):
    """Saved, re-runnable autonomous agent."""
    id: str = Field(default_factory=_uuid)
    owner_user_id: str
    name: str
    description: str = ""
    avatar: str | None = None  # emoji or URL
    tags: list[str] = Field(default_factory=list)
    # Goal template uses simple `{{var}}` substitution from `inputs_schema`
    # and built-ins (`{{date}}`, `{{user.name}}`, etc.). The compiler resolves
    # these before handing the goal to agent_runtime.start_task.
    goal_template: str = ""
    inputs_schema: list[InfoNeed] = Field(default_factory=list)
    cards: list[AgentCard] = Field(default_factory=list)
    links: list[AgentCardLink] = Field(default_factory=list)
    recipients: list[Recipient] = Field(default_factory=list)
    schedule: Schedule = Field(default_factory=Schedule)
    # Operational metadata.
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    last_run_at: datetime | None = None
    run_count: int = 0
    success_count: int = 0
    enabled: bool = True

    @property
    def success_rate(self) -> float:
        if self.run_count <= 0:
            return 0.0
        return min(1.0, max(0.0, self.success_count / self.run_count))


class RunSpec(BaseModel):
    """Inputs supplied at run-time when the operator triggers a CustomAgent."""
    agent_id: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    # Optional override — e.g. trigger from a standing order with a forced track.
    track: Literal["foreground", "background"] = "foreground"
    note: str | None = None


class CustomAgentRun(BaseModel):
    """One execution of a CustomAgent (mirrors agent_runtime task ↔ this row)."""
    id: str = Field(default_factory=_uuid)
    agent_id: str
    task_id: str  # the agent_runtime task that actually ran
    inputs: dict[str, Any] = Field(default_factory=dict)
    status: Literal["queued", "running", "done", "failed", "stopped", "timeout"] = "queued"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    summary: str = ""
    error: str | None = None
    triggered_by: Literal["manual", "schedule", "chat", "api", "card"] = "manual"


def make_artifact_card(*, title: str, html: str, capabilities: list[str]) -> AgentCard:
    return AgentCard(
        kind="artifact",
        category="output",
        title=title or "Артефакт",
        config={"html": html, "capabilities": capabilities},
    )


__all__ = [
    "CardCategory",
    "AgentCardKind",
    "AgentCardLink",
    "AgentCard",
    "make_artifact_card",
    "RecipientChannel",
    "Recipient",
    "ScheduleKind",
    "Schedule",
    "CustomAgent",
    "RunSpec",
    "CustomAgentRun",
]
