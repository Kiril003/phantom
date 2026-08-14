"""map.add_marker — drop a POI on the OmniMap and persist it."""
from __future__ import annotations

import time
from typing import ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, broadcast_map_mutation, build_map_output


VALID_CATEGORIES = {"intel", "threat", "saved", "home", "work", "custom"}


class MapAddMarker(Action):
    """Persist a marker via the same MapPOI table the HTTP API uses."""

    name: ClassVar[str] = "map.add_marker"
    risk_level: ClassVar[RiskLevel] = RiskLevel.LOW
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    name_: str = Field(..., min_length=1, max_length=256, alias="name")
    category: str = Field(default="custom")
    notes: str = Field(default="", max_length=4096)
    icon: str = Field(default="📍", max_length=64)
    is_secret: bool = Field(default=False)
    user_id: Optional[str] = Field(
        default=None,
        description="Owner. Falls back to ctx.extras['user_id'] when omitted.",
    )

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        if self.category not in VALID_CATEGORIES:
            return ActionResult(
                ok=False,
                output={
                    "narrative": f"Невідома категорія {self.category!r}.",
                    "reason": "bad_category",
                    "valid": sorted(VALID_CATEGORIES),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        owner = self.user_id or ctx.extras.get("user_id") if hasattr(ctx, "extras") else self.user_id
        if not owner:
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Не знаю, від чийого імені зберігати маркер.",
                    "reason": "missing_owner",
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        try:
            from db.database import AsyncSessionLocal
            from db.models import MapPOI

            async with AsyncSessionLocal() as db:
                record = MapPOI(
                    user_id=owner,
                    lat=self.lat,
                    lon=self.lon,
                    name=self.name_,
                    category=self.category,
                    notes=self.notes,
                    icon=self.icon,
                    is_secret=self.is_secret,
                )
                db.add(record)
                await db.commit()
                await db.refresh(record)
                marker_id = record.id
                created_at = record.created_at.isoformat()
        except Exception as exc:
            return ActionResult(
                ok=False,
                output={
                    "narrative": "Не зміг зберегти маркер.",
                    "reason": "db_error",
                    "error": str(exc),
                },
                side_effects=[],
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        mutation = MapMutation(
            op="add_marker",
            target=marker_id,
            payload={
                "id": marker_id,
                "lat": self.lat,
                "lon": self.lon,
                "name": self.name_,
                "category": self.category,
                "icon": self.icon,
                "is_secret": self.is_secret,
                "created_at": created_at,
            },
        )
        narrative = f"Додав маркер «{self.name_}» у {self.lat:.4f}, {self.lon:.4f}."
        await broadcast_map_mutation(mutation, narrative=narrative, user_id=owner)
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                extras={"marker_id": marker_id, "user_id": owner},
            ),
            side_effects=[f"poi_created:{marker_id}"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
