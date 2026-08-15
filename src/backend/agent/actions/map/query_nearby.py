"""map.query_nearby — "what's around here" lookup."""
from __future__ import annotations

import time
from typing import Any, ClassVar, Optional

from pydantic import Field

from ...schemas import ActionResult, RiskLevel
from ..base import Action, ActionContext
from ._common import MapArtifact, MapMutation, build_map_output


class MapQueryNearby(Action):
    """Search for nearby places (cafes, pharmacies, etc.) around a point."""

    name: ClassVar[str] = "map.query_nearby"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE
    requires_consent: ClassVar[bool] = False
    reversible: ClassVar[bool] = True


    lat: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    lon: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    radius_m: int = Field(default=500, ge=10, le=5000)
    query: Optional[str] = Field(default=None, description="Optional category to search (e.g., 'cafe', 'pharmacy', 'park', 'supermarket'). If omitted, returns general POIs.")
    user_id: Optional[str] = Field(default=None)

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        lat, lon = self.lat, self.lon
        if lat is None or lon is None:
            from agent.localization.resolver import get_resolver
            resolver = get_resolver()
            est = resolver.last_estimate()
            if not est:
                return ActionResult(ok=False, output={"narrative": "Локація невідома.", "reason": "missing_location", "error": "No location"}, side_effects=[], elapsed_ms=1)
            lat, lon = est.lat, est.lon

        osm_features: list[dict[str, Any]] = []
        try:
            from agent.localization.adapters.overpass import get_default_overpass
            overpass = get_default_overpass()
            feature_types = None
            if self.query:
                q = self.query.lower()
                tags = []
                if "cafe" in q or "каф" in q or "кав" in q: tags.append("amenity=cafe")
                elif "restaurant" in q or "ресторан" in q or "їж" in q: tags.append("amenity=restaurant")
                elif "pharmacy" in q or "аптек" in q: tags.append("amenity=pharmacy")
                elif "hospital" in q or "лікарн" in q or "шпитал" in q: tags.append("amenity=hospital")
                elif "bank" in q or "атм" in q or "atm" in q or "банк" in q: tags.append("amenity=bank")
                elif "supermarket" in q or "магазин" in q or "shop" in q or "маркет" in q:
                    tags.extend(["shop=supermarket", "shop=convenience"])
                elif "park" in q or "парк" in q: tags.append("leisure=park")
                else:
                    tags.extend([f"amenity={q}", f"shop={q}"])
                feature_types = tuple(tags)

            features = await overpass.features_near(lat, lon, radius_m=self.radius_m, feature_types=feature_types)
            osm_features = [
                {
                    "osm_id": f.osm_id,
                    "name": f.name,
                    "type": f.type,
                    "lat": f.lat,
                    "lon": f.lon,
                    "distance_m": f.distance_m,
                }
                for f in features
            ]
        except Exception:
            osm_features = []

        owner = self.user_id or (ctx.extras.get("user_id") if hasattr(ctx, "extras") else None)
        pois: list[dict[str, Any]] = []
        if owner:
            try:
                from agent.localization.base import haversine_km
                from db.database import AsyncSessionLocal
                from db.models import MapPOI
                from sqlalchemy import select

                async with AsyncSessionLocal() as db:
                    res = await db.execute(select(MapPOI).where(MapPOI.user_id == owner))
                    for p in res.scalars().all():
                        d_km = haversine_km(lat, lon, p.lat, p.lon)
                        if d_km * 1000.0 <= self.radius_m:
                            pois.append({
                                "id": p.id,
                                "name": p.name,
                                "category": p.category,
                                "lat": p.lat,
                                "lon": p.lon,
                                "distance_m": int(round(d_km * 1000.0)),
                            })
                pois.sort(key=lambda r: r["distance_m"])
            except Exception:
                pois = []

        narrative = (
            f"Поруч ({self.radius_m} м): {len(osm_features)} обʼєктів OSM, "
            f"{len(pois)} ваших маркерів."
        )
        mutation = MapMutation(
            op="narrate",
            target="query_nearby",
            payload={"osm": len(osm_features), "pois": len(pois)},
        )
        return ActionResult(
            ok=True,
            output=build_map_output(
                narrative=narrative,
                mutation=mutation,
                artifacts=[
                    MapArtifact(
                        kind="feature",
                        label="osm",
                        payload={"items": osm_features[:20]},
                    ),
                    MapArtifact(
                        kind="feature",
                        label="pois",
                        payload={"items": pois[:20]},
                    ),
                ],
                extras={"osm_total": len(osm_features), "poi_total": len(pois)},
            ),
            side_effects=[],
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
