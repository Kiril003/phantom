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

    @abstractmethod
    async def execute(self, ctx: ActionContext) -> ActionResult: ...
