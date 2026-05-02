"""Action base — each concrete action subclasses Action and defines args."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict

from ..schemas import ActionResult, Precondition, RiskLevel


class ActionContext(BaseModel):
    """Per-execution context passed into Action.execute()."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    task_id: str
    step_idx: int
    workspace_dir: str
    runtime: Any | None = None  # AgentRuntime, optional to keep tests light
    extras: dict[str, Any] = {}


class Action(BaseModel, ABC):
    """
    Subclass to define a concrete action.

    Subclasses declare:
        name: ClassVar[str]
        risk_level: ClassVar[RiskLevel]
    plus their own Pydantic fields for arguments.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: ClassVar[str] = "abstract"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = False

    def preconditions(self) -> list[Precondition]:
        """Override to declare runtime preconditions."""
        return []

    def long_running_spec(self) -> "LongRunningSpec | None":
        """Phase 18-COMPLETE: opt-in declaration that this action is
        expected to run for minutes-to-hours. Returning a spec triggers
        foreground→background track promotion + periodic progress
        heartbeats. Default None = treat as a normal foreground step.
        Implemented as an instance method so subclasses can derive the
        decision from their args (e.g. a small timeout_s stays foreground)."""
        return None

    @abstractmethod
    async def execute(self, ctx: ActionContext) -> ActionResult: ...


# Re-imported here to keep the type reference resolvable in subclasses
# without forcing every Action import to also pull long_running.
from ..long_running import LongRunningSpec  # noqa: E402  (deliberate late import)
