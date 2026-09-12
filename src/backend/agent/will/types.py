from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

HORIZON_VISION = 0
HORIZON_YEAR = 1
HORIZON_QUARTER = 2
HORIZON_MONTH = 3
HORIZON_WEEK = 4
HORIZON_DAY = 5
HORIZON_ACTION = 6

GoalStatus = Literal["pending", "running", "done", "failed", "snoozed", "cancelled"]
GoalSource = Literal["seeded", "self_generated"]
DecisionKind = Literal["start_task", "standing_order", "proactive_seed", "noop"]


@dataclass(frozen=True)
class Goal:
    id: str
    user_id: str
    parent_id: Optional[str]
    horizon_level: int
    description: str
    status: GoalStatus
    kpi: Optional[str]
    deadline: Optional[datetime]
    blockers: list[str]
    source: GoalSource


@dataclass
class WillDecision:
    kind: DecisionKind
    goal_id: Optional[str] = None
    action_text: str = ""
    rationale: str = ""
    # Only meaningful for kind="standing_order": the cadence the will chose,
    # in the shape agent.operations.standing_orders.schedules.parse_schedule
    # accepts. None means the will named no cadence — the engine then refuses
    # the decision rather than inventing one.
    schedule: Optional[dict] = None


@dataclass
class Budget:
    calls_used: int
    tokens_used: int
    calls_cap: int
    tokens_cap: int

    @property
    def ok(self) -> bool:
        return self.calls_used < self.calls_cap and self.tokens_used < self.tokens_cap


@dataclass
class WillTickResult:
    decision: WillDecision
    dispatched: bool = False
    task_id: Optional[str] = None
    note: str = ""
