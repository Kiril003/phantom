"""map.create_geofence — register a new alert zone."""
from __future__ import annotations

import json
import time
from typing import ClassVar, List, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapMutation, broadcast_map_mutation, build_map_output


class MapCreateGeofence(Action):
    """Create a new geofence (alert zone) on the map.

    When entered or exited, the system can fire toasts or voice alerts.
    """

    name: ClassVar[str] = "map.create_geofence"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False

    label: str = Field(..., description="Name of the zone (e.g. 'Home', 'Restricted Area')")
    kind: str = Field(default="circle", description="circle or polygon")
    geometry: dict = Field(..., description="For circle: {lat, lon, radius_m}. For polygon: {points: [[lon, lat], ...]}")
    on_enter: List[dict] = Field(default_factory=list, description="Actions on enter: [{type: 'toast', message: '...'}]")
    on_exit: List[dict] = Field(default_factory=list, description="Actions on exit")

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        
        from db.database import SessionLocal
        from db.models import Geofence
        
        async with SessionLocal() as db:
            gf = Geofence(
                user_id=ctx.user_id,
                label=self.label,
                kind=self.kind,
                geometry_json=json.dumps(self.geometry),
                on_enter_json=json.dumps(self.on_enter),
                on_exit_json=json.dumps(self.on_exit),
            )
            db.add(gf)
            await db.commit()
            await db.refresh(gf)

        mutation = MapMutation(
            op="add_geofence",
            target=gf.id,
            payload={
                "id": gf.id,
                "label": self.label,
                "kind": self.kind,
                "geometry": self.geometry,
            },
        )
        
        narrative = f"Створив геозону {self.label} ({self.kind})."
        await broadcast_map_mutation(mutation, narrative=narrative)
        
        return ActionResult(
            ok=True,
            output=build_map_output(narrative=narrative, mutation=mutation),
            side_effects=["create_geofence"],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
