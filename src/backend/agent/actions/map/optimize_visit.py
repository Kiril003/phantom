"""map.optimize_visit — greedy nearest-neighbour TSP over the matrix."""
from __future__ import annotations

import time
from typing import ClassVar

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapArtifact, MapMutation, broadcast_map_mutation, build_map_output


class MapOptimizeVisit(Action):
    """Order a list of stops to minimise total travel time.

    Uses the routing matrix from the facade and applies nearest-neighbour
    starting from index 0 — fast, deterministic, "good enough" for ≤ 24
    stops. Real Concorde-grade TSP is overkill for the planner's daily
    use cases; we ship the simple thing now and revisit if the operator
    asks for tour-optimal sequencing.
    """

    name: ClassVar[str] = "map.optimize_visit"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    stops: list[list[float]] = Field(
        ...,
        min_length=2,
        max_length=24,
        description="Each stop is [lat, lon]; index 0 is the start.",
    )
    profile: str = Field(default="car", max_length=24)
    return_to_start: bool = Field(default=False)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo.routing import MatrixRequest, RoutingProfile, get_router
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
        try:
            req = MatrixRequest(
                points=[{"lat": p[0], "lon": p[1]} for p in self.stops],
                profile=profile,
            )
        except Exception as exc:
            return ActionResult(
                ok=False,
                output={"narrative": "Невалідні точки.", "reason": "bad_stops", "error": str(exc)},
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        router = get_router()
        try:
            mat = await router.matrix(req)
        except RoutingError as exc:
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Не зміг отримати матрицю від жодного маршрутизатора.",
                    "reason": "no_matrix",
                    "error": str(exc),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        n = len(self.stops)
        order: list[int] = [0]
        unvisited = set(range(1, n))
        total_s = 0.0
        cur = 0
        while unvisited:
            nxt = min(unvisited, key=lambda j: mat.durations_s[cur][j])
            total_s += mat.durations_s[cur][nxt]
            order.append(nxt)
            unvisited.remove(nxt)
            cur = nxt
        if self.return_to_start:
            total_s += mat.durations_s[cur][0]
            order.append(0)

        narrative = (
            f"Оптимізував {n} зупинок: ~{total_s/60:.0f} хв загалом ({mat.engine})."
        )
        mutation = MapMutation(
            op="route",
            target="optimize_visit",
            payload={
                "order": order,
                "total_duration_s": total_s,
                "engine": mat.engine,
                "profile": profile.value,
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
                        label="ordered_stops",
                        payload={"order": order, "stops": self.stops},
                    ),
                ],
                extras={
                    "engine": mat.engine,
                    "total_duration_s": total_s,
                    "order": order,
                },
            ),
            side_effects=["visit_optimized"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
