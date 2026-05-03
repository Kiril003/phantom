"""map.plan_route — directed routing through the facade."""
from __future__ import annotations

import time
from typing import ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapArtifact, MapMutation, broadcast_map_mutation, build_map_output


class MapPlanRoute(Action):
    """Plan a route between two or more lat/lon waypoints."""

    name: ClassVar[str] = "map.plan_route"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    waypoints: list[list[float]] = Field(
        ...,
        min_length=2,
        max_length=64,
        description="Each waypoint is [lat, lon].",
    )
    profile: str = Field(default="car", max_length=24)
    alternatives: int = Field(default=0, ge=0, le=3)
    language: str = Field(default="uk", max_length=5)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo.routing import RouteRequest, RoutingProfile, get_router
        from geo.routing.adapters import RoutingError

        try:
            profile = RoutingProfile(self.profile)
        except ValueError:
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Невідомий профіль {self.profile!r}.",
                    "reason": "bad_profile",
                    "valid": [p.value for p in RoutingProfile],
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        try:
            req = RouteRequest(
                waypoints=[{"lat": p[0], "lon": p[1]} for p in self.waypoints],
                profile=profile,
                alternatives=self.alternatives,
                language=self.language,
            )
        except Exception as exc:
            return ActionResult(
                ok=False,
                output={"narrative": "Невалідні точки.", "reason": "bad_waypoints", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        router = get_router()
        try:
            result = await router.route(req)
        except RoutingError as exc:
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Усі маршрутизатори відмовили.",
                    "reason": "no_route",
                    "error": str(exc),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        km = result.primary.distance_m / 1000.0
        minutes = result.primary.duration_s / 60.0
        narrative = (
            f"Маршрут {km:.1f} км / {minutes:.0f} хв через {result.engine}"
            + (f", + {len(result.alternatives)} альтернатив(а)." if result.alternatives else ".")
        )
        mutation = MapMutation(
            op="route",
            target=result.engine,
            payload={
                "engine": result.engine,
                "profile": profile.value,
                "primary": result.primary.model_dump(mode="json"),
                "alternatives_count": len(result.alternatives),
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
                        label="primary",
                        payload=result.primary.model_dump(mode="json"),
                    ),
                    *[
                        MapArtifact(
                            kind="route",
                            label=f"alt_{i+1}",
                            payload=alt.model_dump(mode="json"),
                        )
                        for i, alt in enumerate(result.alternatives)
                    ],
                ],
                extras={
                    "engine": result.engine,
                    "profile": profile.value,
                    "distance_m": result.primary.distance_m,
                    "duration_s": result.primary.duration_s,
                },
            ),
            side_effects=["route_planned"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
