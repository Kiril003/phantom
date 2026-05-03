"""map.set_view — explicit viewport set."""
from __future__ import annotations

import time
from typing import ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, broadcast_map_mutation, build_map_output


class MapSetView(Action):
    """Hard-set the OmniMap viewport (center + zoom + optional bearing/pitch)."""

    name: ClassVar[str] = "map.set_view"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    zoom: float = Field(default=14.0, ge=0.0, le=22.0)
    bearing: Optional[float] = Field(default=None, ge=-360.0, le=360.0)
    pitch: Optional[float] = Field(default=None, ge=0.0, le=85.0)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        payload: dict = {
            "center": [self.lon, self.lat],
            "zoom": self.zoom,
        }
        if self.bearing is not None:
            payload["bearing"] = self.bearing
        if self.pitch is not None:
            payload["pitch"] = self.pitch
        mutation = MapMutation(op="set_view", payload=payload)
        narrative = f"Виставляю перегляд на {self.lat:.4f}, {self.lon:.4f} (zoom {self.zoom:.1f})."
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(narrative=narrative, mutation=mutation),
            side_effects=["set_viewport"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
