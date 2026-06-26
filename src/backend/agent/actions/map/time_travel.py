"""map.time_travel — change the temporal state of specific map layers."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import ClassVar, Optional

from pydantic import Field, model_validator

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, broadcast_map_mutation, build_map_output


class MapTimeTravel(Action):
    """Change the date/time focus for a layer or the whole OmniMap.

    Useful for:
      * historical imagery (Sentinel-2 archive, Corona)
      * weather forecast playback
      * air-quality history
    """

    name: ClassVar[str] = "map.time_travel"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False

    iso_date: str = Field(..., description="ISO8601 date string (e.g. 2024-05-15)")
    layer_id: Optional[str] = Field(
        default=None, 
        description="Specific layer to travel. If omitted, applies to all temporal layers."
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        
        # Validate date
        try:
            target_dt = datetime.fromisoformat(self.iso_date.replace("Z", "+00:00"))
        except ValueError:
            return ActionResult(
                ok=False,
                output={"narrative": f"Неправильний формат дати: {self.iso_date}"},
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        mutation = MapMutation(
            op="time_travel",
            target=self.layer_id or "landscape",
            payload={
                "iso_date": self.iso_date,
                "timestamp": int(target_dt.timestamp()),
                "layer_id": self.layer_id,
            },
        )
        
        target_str = self.layer_id or "ландшафту"
        narrative = f"Переношу фокус {target_str} на {self.iso_date}."
        
        await broadcast_map_mutation(mutation, narrative=narrative)
        
        return ActionResult(
            ok=True,
            output=build_map_output(narrative=narrative, mutation=mutation),
            side_effects=["time_travel"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
