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
    # Day-NN "no-leash" — propagated from TaskState.unsafe_mode by the
    # executor. Actions that have a sandbox layer (bash.run, process.run,
    # fs.write, etc.) consult this flag to skip bwrap when True so the
    # agent gets full host access — the operator has explicitly waived
    # the safety net for this task.
    unsafe_mode: bool = True
    user_id: str = "default"


class Action(BaseModel, ABC):
    """
    Subclass to define a concrete action.

    Subclasses declare:
        name: ClassVar[str]
        risk_level: ClassVar[RiskLevel]
    plus their own Pydantic fields for arguments.

    Block B — resource pre-flight metadata.  Conservative defaults so any
    action without an explicit declaration is treated as cheap.  Heavyweight
    actions SHOULD override these at the class level (or via the instance
    method ``expected_peak_ram_mb`` when the value derives from args).

    Declared as ``ClassVar`` so Pydantic does NOT treat them as model fields.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: ClassVar[str] = "abstract"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = False

    # Block B — resource declarations.
    estimated_peak_ram_mb: ClassVar[int] = 50
    estimated_disk_write_mb: ClassVar[int] = 0
    estimated_wall_seconds: ClassVar[int] = 10
    requires_network: ClassVar[bool] = False

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
from ..kernel.long_running import LongRunningSpec  # noqa: E402  (deliberate late import)
