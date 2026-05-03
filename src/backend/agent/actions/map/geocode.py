"""map.geocode — name → coords via Nominatim."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, build_map_output


class MapGeocode(Action):
    """Resolve a free-form query to a list of candidate coordinates."""

    name: ClassVar[str] = "map.geocode"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    query: str = Field(..., min_length=1, max_length=256)
    limit: int = Field(default=5, ge=1, le=20)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        try:
            from agent.localization.adapters.nominatim import get_default_nominatim
            geocoder = get_default_nominatim()
            results = await geocoder.geocode(self.query, limit=self.limit)
        except Exception as exc:
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Геокодер недоступний: {exc}",
                    "reason": "geocoder_offline",
                    "error": str(exc),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        items = [
            {
                "lat": r.lat,
                "lon": r.lon,
                "display_name": getattr(r, "display_name", None) or self.query,
                "type": getattr(r, "type", None),
                "importance": getattr(r, "importance", None),
            }
            for r in results
        ]
        narrative = (
            f"Знайшов {len(items)} варіант(и) для {self.query!r}."
            if items else f"Жодного результату для {self.query!r}."
        )
        mutation = MapMutation(
            op="narrate",
            target="geocode",
            payload={"query": self.query, "count": len(items)},
        )
        return ActionResult(
            ok=bool(items),
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={"results": items},
            ),
            side_effects=[],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
