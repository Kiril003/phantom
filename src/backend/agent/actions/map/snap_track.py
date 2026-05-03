"""map.snap_track — snap a noisy GPS trace to roads."""
from __future__ import annotations

import time
from typing import ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapArtifact, MapMutation, broadcast_map_mutation, build_map_output


class MapSnapTrack(Action):
    """Map-match a GPS trace through the routing facade (OSRM /match)."""

    name: ClassVar[str] = "map.snap_track"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    points: list[list[float]] = Field(
        ...,
        min_length=2,
        max_length=500,
        description="GPS trace; each point is [lat, lon].",
    )
    timestamps_ms: Optional[list[int]] = Field(default=None)
    profile: str = Field(default="car", max_length=24)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        from geo.routing import RoutingProfile, SnapMatchRequest, get_router
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
        if self.timestamps_ms is not None and len(self.timestamps_ms) != len(self.points):
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Кількість timestamps ≠ кількість точок.",
                    "reason": "timestamp_mismatch",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        req = SnapMatchRequest(
            points=[{"lat": p[0], "lon": p[1]} for p in self.points],
            timestamps_ms=self.timestamps_ms,
            profile=profile,
        )
        router = get_router()
        try:
            result = await router.snap_match(req)
        except RoutingError as exc:
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Не зміг прив'язати трек до доріг.",
                    "reason": "no_match",
                    "error": str(exc),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        narrative = (
            f"Прив'язав {len(self.points)} точок до доріг ({result.engine}, "
            f"впевненість {result.confidence*100:.0f}%)."
        )
        mutation = MapMutation(
            op="route",
            target="snap_track",
            payload={
                "engine": result.engine,
                "confidence": result.confidence,
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
                        label="snapped",
                        payload=result.model_dump(mode="json"),
                    ),
                ],
                extras={"engine": result.engine, "confidence": result.confidence},
            ),
            side_effects=["track_snapped"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
