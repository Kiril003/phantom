"""map.list_geofences — list registered alert zones."""
from __future__ import annotations

import json
import time
from typing import ClassVar

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import build_map_output


class MapListGeofences(Action):
    """List all registered geofences (alert zones) for the current user."""

    name: ClassVar[str] = "map.list_geofences"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        
        from db.database import SessionLocal
        from db.models import Geofence
        from sqlalchemy import select
        
        async with SessionLocal() as db:
            result = await db.execute(
                select(Geofence).where(Geofence.user_id == ctx.user_id)
            )
            gfs = result.scalars().all()

        output = [
            {
                "id": gf.id,
                "label": gf.label,
                "kind": gf.kind,
                "geometry": json.loads(gf.geometry_json),
                "is_active": gf.is_active,
            } for gf in gfs
        ]
        
        narrative = f"Знайшов {len(output)} геозон."
        
        return ActionResult(
            ok=True,
            output=build_map_output(narrative=narrative, extras={"geofences": output}),
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
