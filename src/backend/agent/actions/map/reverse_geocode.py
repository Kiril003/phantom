"""map.reverse_geocode — coords → human address."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, build_map_output


class MapReverseGeocode(Action):
    """Resolve (lat, lon) to a place description via Nominatim."""

    name: ClassVar[str] = "map.reverse_geocode"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        try:
            from agent.localization.adapters.nominatim import get_default_nominatim
            geocoder = get_default_nominatim()
            result = await geocoder.reverse(self.lat, self.lon)
        except Exception as exc:
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Reverse-геокодер недоступний: {exc}",
                    "reason": "geocoder_offline",
                    "error": str(exc),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        if result is None:
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Без адреси для цієї точки.",
                    "reason": "no_match",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        place = getattr(result, "display_name", None) or "(невідомо)"
        narrative = f"Тут: {place}."
        mutation = MapMutation(
            op="narrate",
            target="reverse_geocode",
            payload={"lat": self.lat, "lon": self.lon, "place_name": place},
        )
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={
                    "place_name": place,
                    "country": getattr(result, "country", None),
                    "country_code": getattr(result, "country_code", None),
                    "city": getattr(result, "city", None),
                },
            ),
            side_effects=[],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
