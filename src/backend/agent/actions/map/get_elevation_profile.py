"""map.get_elevation_profile — compute height profile for a path."""
from __future__ import annotations

import time
from typing import ClassVar, List

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, build_map_output
from geo.elevation import ElevationUnavailable, get_elevation_service


class MapGetElevationProfile(Action):
    """Compute the elevation (height) profile for a set of coordinates.

    Useful for planning hikes, bike rides, or analyzing terrain for recon.
    """

    name: ClassVar[str] = "map.get_elevation_profile"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False

    points: List[List[float]] = Field(..., description="List of [lat, lon] pairs.")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()

        coords = [(p[0], p[1]) for p in self.points]
        try:
            profile = await get_elevation_service().get_profile(coords)
        except ElevationUnavailable as exc:
            # ok=False — щоб асистент переказав відмову, а не переспівав її своїм
            # упевненим голосом як число.
            return ActionResult(
                ok=False,
                error=str(exc),
                error_class="ElevationUnavailable",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        samples = [s.model_dump() for s in profile]

        narrative = f"Розрахував профіль висоти для {len(self.points)} точок."

        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=MapMutation(op="narrate", payload={"samples": samples}),
                extras={"samples": samples},
            ),
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
