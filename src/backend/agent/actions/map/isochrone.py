"""map.isochrone — area reachable within N minutes."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapArtifact, MapMutation, broadcast_map_mutation, build_map_output


class MapIsochrone(Action):
    """Compute the polygon enclosing all points reachable within `time_minutes`."""

    name: ClassVar[str] = "map.isochrone"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    time_minutes: int = Field(..., ge=1, le=120)
    profile: str = Field(default="foot", max_length=24)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo.routing import IsochroneRequest, RoutingProfile, get_router
        from geo.routing.adapters import RoutingError

        try:
            profile = RoutingProfile(self.profile)
        except ValueError:
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Невідомий профіль {self.profile!r}.",
                    "reason": "bad_profile",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        req = IsochroneRequest(
            center={"lat": self.lat, "lon": self.lon},
            time_minutes=self.time_minutes,
            profile=profile,
        )
        router = get_router()
        try:
            result = await router.isochrone(req)
        except RoutingError as exc:
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Жоден маршрутизатор не вміє ізохрони.",
                    "reason": "no_isochrone",
                    "error": str(exc),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        narrative = (
            f"Ізохрона {self.time_minutes} хв ({profile.value}) через {result.engine}."
        )
        mutation = MapMutation(
            op="route",
            target="isochrone",
            payload={
                "engine": result.engine,
                "profile": profile.value,
                "time_minutes": self.time_minutes,
                "geometry": result.geometry,
            },
        )
        await broadcast_map_mutation(mutation, narrative=narrative)
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                artifacts=[
                    MapArtifact(
                        kind="route",
                        label="isochrone",
                        payload=result.model_dump(mode="json"),
                    ),
                ],
                extras={"engine": result.engine, "time_minutes": self.time_minutes},
            ),
            side_effects=["isochrone_computed"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
