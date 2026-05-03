"""map.flyto — animated transition to a place by coords or address."""
from __future__ import annotations

import time
from typing import ClassVar, Optional

from pydantic import Field, model_validator

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, broadcast_map_mutation, build_map_output


class MapFlyTo(Action):
    """Animate the OmniMap to ``target``.

    Targets accepted:
      * explicit ``lat`` + ``lon`` (preferred — no upstream call)
      * ``address`` — geocoded via Nominatim once, animation skipped
        on geocode failure (returns ``ok=False``)
    """

    name: ClassVar[str] = "map.flyto"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    lat: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    lon: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    address: Optional[str] = Field(
        default=None,
        max_length=256,
        description="Free-form place name; geocoded if lat/lon missing.",
    )
    zoom: float = Field(default=15.0, ge=0.0, le=22.0)
    duration_ms: int = Field(default=1200, ge=0, le=10_000)

    @model_validator(mode="after")
    def _need_target(self) -> "MapFlyTo":
        if self.lat is None or self.lon is None:
            if not (self.address and self.address.strip()):
                raise ValueError("provide lat+lon or address")
        return self

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        lat, lon = self.lat, self.lon
        resolved_label: Optional[str] = None
        if lat is None or lon is None:
            try:
                from agent.localization.adapters.nominatim import get_default_nominatim
                geocoder = get_default_nominatim()
                results = await geocoder.geocode(self.address or "", limit=1)
            except Exception as exc:  # pragma: no cover — Nominatim outage path
                return ActionResult(
                    ok=False,
                    output={
                        "narrative": f"Не зміг знайти {self.address!r}: {exc}",
                        "reason": "geocode_failed",
                        "error": str(exc),
                    },
                    side_effects=[],
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            if not results:
                return ActionResult(
                    ok=False,
                    output={
                        "narrative": f"Не знайшов місце {self.address!r}.",
                        "reason": "no_match",
                    },
                    side_effects=[],
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            top = results[0]
            lat, lon = top.lat, top.lon
            resolved_label = getattr(top, "display_name", None) or self.address

        mutation = MapMutation(
            op="fly_to",
            target=resolved_label or f"{lat:.4f},{lon:.4f}",
            payload={
                "center": [lon, lat],
                "zoom": self.zoom,
                "duration_ms": self.duration_ms,
                "address": self.address,
            },
        )
        narrative = (
            f"Лечу до {resolved_label or f'{lat:.4f}, {lon:.4f}'}."
        )
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={"resolved": resolved_label, "lat": lat, "lon": lon},
            ),
            side_effects=["flyto"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
