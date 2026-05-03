"""map.open_map — agent-issued nudge to focus the map screen."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, broadcast_map_mutation, build_map_output


class MapOpenMap(Action):
    """Tell the desktop to focus the OmniMap surface."""

    name: ClassVar[str] = "map.open_map"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    reason: str = Field(
        default="",
        max_length=200,
        description="Why we want the map open (renders in the side panel).",
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        mutation = MapMutation(
            op="open_map",
            payload={"reason": self.reason},
        )
        narrative = "Відкриваю мапу" + (f" — {self.reason}" if self.reason else "") + "."
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(narrative=narrative, mutation=mutation),
            side_effects=["focused_map"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
