"""
Map & Wardriving routes.

Phase 6 — full implementation.

Endpoints:
  GET  /map/wardriving        — list wardriving records in bounds/time window
  GET  /map/heatmap           — RSSI heatmap points in bounds
  GET  /map/pois              — list map POIs (optionally filter by category)
  POST /map/pois              — create a POI (authenticated user)
  GET  /map/track             — recent GPS track from ContextEngine history
  DELETE /map/pois/{id}       — delete a POI (owner only)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_db
from db.models import MapPOI, WardrivingRecord
from security.auth import require_auth
from security.jwt_manager import TokenPayload
from wardriving.collector import query_records_in_bounds
from wardriving.heatmap import generate_heatmap

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/map", tags=["map"])

VALID_POI_CATEGORIES = {"intel", "threat", "saved", "home", "work", "custom"}


# ── Schemas ────────────────────────────────────────────────────────────────────

class POICreate(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    name: str = Field(..., min_length=1, max_length=256)
    category: str = Field(default="custom")
    notes: str = Field(default="", max_length=4096)
    icon: str = Field(default="📍", max_length=64)
    is_secret: bool = False


class GeolocationSubmit(BaseModel):
    """Frontend browser geolocation watchPosition submission."""
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    accuracy_m: Optional[float] = Field(default=None, ge=0.0)
    timestamp: Optional[str] = Field(
        default=None,
        description="ISO8601 timestamp from the browser; server uses now() if omitted",
    )


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_bounds(raw: Optional[str]) -> Optional[tuple[float, float, float, float]]:
    """
    Parse 'lat1,lon1,lat2,lon2' into (lat_min, lon_min, lat_max, lon_max).
    Returns None if raw is missing or malformed.
    """
    if not raw:
        return None
    try:
        parts = [float(x.strip()) for x in raw.split(",")]
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid bounds format — expected 'lat1,lon1,lat2,lon2'",
        )
    if len(parts) != 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid bounds — must provide 4 values",
        )
    lat1, lon1, lat2, lon2 = parts
    if not (-90.0 <= lat1 <= 90.0 and -90.0 <= lat2 <= 90.0):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Latitude out of range",
        )
    if not (-180.0 <= lon1 <= 180.0 and -180.0 <= lon2 <= 180.0):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Longitude out of range",
        )
    return (min(lat1, lat2), min(lon1, lon2), max(lat1, lat2), max(lon1, lon2))


def _parse_since(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid 'since' — expected ISO8601 datetime",
        )
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _serialize_wardriving(r: WardrivingRecord) -> dict[str, Any]:
    return {
        "id": r.id,
        "mac": r.mac,
        "ssid": r.ssid,
        "rssi": r.rssi,
        "encryption": r.encryption,
        "channel": r.channel,
        "lat": r.lat,
        "lon": r.lon,
        "first_seen": r.first_seen.isoformat(),
        "last_seen": r.last_seen.isoformat(),
        "seen_count": r.seen_count,
    }


def _serialize_poi(p: MapPOI) -> dict[str, Any]:
    return {
        "id": p.id,
        "user_id": p.user_id,
        "lat": p.lat,
        "lon": p.lon,
        "name": p.name,
        "category": p.category,
        "notes": p.notes,
        "icon": p.icon,
        "is_secret": p.is_secret,
        "created_at": p.created_at.isoformat(),
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/wardriving")
async def get_wardriving(
    bounds: str | None = Query(default=None, description="lat1,lon1,lat2,lon2"),
    since: str | None = Query(default=None, description="ISO8601 lower bound for last_seen"),
    limit: int = Query(default=5000, ge=1, le=20000),
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    b = _parse_bounds(bounds)
    since_dt = _parse_since(since)

    if b is None:
        # No bounds: return most-recent records up to the limit
        stmt = select(WardrivingRecord).order_by(
            WardrivingRecord.last_seen.desc()
        ).limit(min(limit, config.wardriving_max_records_query))
        if since_dt:
            stmt = stmt.where(WardrivingRecord.last_seen >= since_dt)
        result = await db.execute(stmt)
        records = list(result.scalars().all())
    else:
        records = await query_records_in_bounds(
            db,
            lat_min=b[0],
            lon_min=b[1],
            lat_max=b[2],
            lon_max=b[3],
            since=since_dt,
            limit=min(limit, config.wardriving_max_records_query),
        )

    return {
        "records": [_serialize_wardriving(r) for r in records],
        "total": len(records),
    }


@router.get("/heatmap")
async def get_heatmap(
    bounds: str | None = Query(default=None, description="lat1,lon1,lat2,lon2"),
    min_weight: float = Query(default=0.0, ge=0.0, le=1.0),
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    b = _parse_bounds(bounds)
    if b is None:
        points = await generate_heatmap(db, min_weight=min_weight)
    else:
        points = await generate_heatmap(
            db,
            lat_min=b[0],
            lon_min=b[1],
            lat_max=b[2],
            lon_max=b[3],
            min_weight=min_weight,
        )
    return {"points": [p.to_dict() for p in points]}


@router.get("/pois")
async def get_pois(
    category: str | None = Query(default=None),
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if category is not None and category not in VALID_POI_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid category — must be one of {sorted(VALID_POI_CATEGORIES)}",
        )

    stmt = select(MapPOI).where(MapPOI.user_id == token_data.user_id)
    if category is not None:
        stmt = stmt.where(MapPOI.category == category)
    # Secret POIs only exposed in GHOST mode (best-effort check via ContextEngine)
    stmt = stmt.order_by(MapPOI.created_at.desc())

    from core.context_engine import context_engine
    snapshot = context_engine.get_snapshot()
    is_ghost = snapshot.get("system", {}).get("state") == "GHOST"

    result = await db.execute(stmt)
    pois = list(result.scalars().all())
    visible = [p for p in pois if not p.is_secret or is_ghost]

    return {"pois": [_serialize_poi(p) for p in visible]}


@router.post("/pois")
async def create_poi(
    poi: POICreate,
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if poi.category not in VALID_POI_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid category — must be one of {sorted(VALID_POI_CATEGORIES)}",
        )

    record = MapPOI(
        user_id=token_data.user_id,
        lat=poi.lat,
        lon=poi.lon,
        name=poi.name,
        category=poi.category,
        notes=poi.notes,
        icon=poi.icon,
        is_secret=poi.is_secret,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return _serialize_poi(record)


@router.delete("/pois/{poi_id}")
async def delete_poi(
    poi_id: str,
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(MapPOI).where(MapPOI.id == poi_id, MapPOI.user_id == token_data.user_id)
    )
    poi = result.scalar_one_or_none()
    if poi is None:
        raise HTTPException(status_code=404, detail="POI not found")
    await db.delete(poi)
    await db.flush()
    return {"ok": True}


@router.post("/geolocation/submit")
async def submit_geolocation(
    payload: GeolocationSubmit,
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    """Phase 9.4b — ingest browser geolocation readings.

    Frontend `navigator.geolocation.watchPosition` posts here every few
    seconds. The submission is cached in-memory by
    :class:`BrowserGeolocationSource`; the localization resolver picks it
    up on the next tick. No DB write here — :class:`LocationHistory` is
    populated by the background writer (Part 3) from the resolver stream,
    not from raw browser submissions.
    """
    if not config.agent_browser_geolocation_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Browser geolocation source disabled via config",
        )
    ts = _parse_since(payload.timestamp) if payload.timestamp else None
    from agent.localization.sources.browser_geolocation import submit_browser_estimate
    est = submit_browser_estimate(
        lat=payload.lat,
        lon=payload.lon,
        accuracy_m=payload.accuracy_m,
        timestamp=ts,
    )
    return {
        "ok": True,
        "source": est.source,
        "confidence": est.confidence,
        "accuracy_m": est.accuracy_m,
        "timestamp": est.timestamp.isoformat(),
    }


@router.get("/location_history")
async def get_location_history(
    from_: str | None = Query(default=None, alias="from", description="ISO8601 lower bound"),
    to: str | None = Query(default=None, description="ISO8601 upper bound"),
    limit: int = Query(default=500, ge=1, le=5000),
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Phase 9.4b — chronological location history for the timeline drawer."""
    from db.models import LocationHistory

    from_dt = _parse_since(from_)
    to_dt = _parse_since(to)

    stmt = (
        select(LocationHistory)
        .where(LocationHistory.user_id == token_data.user_id)
        .order_by(LocationHistory.timestamp.desc())
        .limit(limit)
    )
    if from_dt is not None:
        stmt = stmt.where(LocationHistory.timestamp >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(LocationHistory.timestamp <= to_dt)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())
    return {
        "entries": [
            {
                "id": r.id,
                "lat": r.lat,
                "lon": r.lon,
                "source": r.source,
                "confidence": r.confidence,
                "accuracy_m": r.accuracy_m,
                "place_name": r.place_name,
                "country": r.country,
                "country_code": r.country_code,
                "city": r.city,
                "timestamp": r.timestamp.isoformat(),
            }
            for r in rows
        ],
        "total": len(rows),
    }


@router.get("/nearby")
async def get_nearby(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    radius_m: int = Query(default=500, ge=10, le=5000),
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Phase 9.4b — unified "what's here" lookup.

    Combines three sources:
      * remembered: MemoryFact rows with place coordinates in range
      * osm:        Overpass API features (cafes/parks/shops/etc.)
      * pois:       user-saved MapPOI rows within range

    Every external call is guarded — cache hits are free, misses respect
    the adapter's rate limit, and any error returns an empty slice for
    that source rather than raising.
    """
    radius_km = radius_m / 1000.0

    from memory.geo_query import find_memories_near
    remembered = await find_memories_near(
        db, user_id=token_data.user_id, lat=lat, lon=lon, radius_km=radius_km,
    )

    osm: list[dict[str, Any]] = []
    if config.agent_overpass_enabled:
        try:
            from agent.localization.adapters.overpass import get_default_overpass
            overpass = get_default_overpass()
            features = await overpass.features_near(lat, lon, radius_m=radius_m)
            osm = [
                {
                    "osm_id": f.osm_id,
                    "name": f.name,
                    "type": f.type,
                    "lat": f.lat,
                    "lon": f.lon,
                    "tags": f.tags,
                    "distance_m": f.distance_m,
                }
                for f in features
            ]
        except Exception as exc:
            logger.info("overpass nearby lookup failed: %s", exc)

    # MapPOI scan — small table, user-scoped.
    from agent.localization.base import haversine_km
    poi_result = await db.execute(
        select(MapPOI).where(MapPOI.user_id == token_data.user_id)
    )
    pois: list[dict[str, Any]] = []
    for p in poi_result.scalars().all():
        d_km = haversine_km(lat, lon, p.lat, p.lon)
        if d_km * 1000.0 <= radius_m:
            pois.append({
                "id": p.id,
                "name": p.name,
                "category": p.category,
                "lat": p.lat,
                "lon": p.lon,
                "distance_m": int(round(d_km * 1000.0)),
            })
    pois.sort(key=lambda r: r["distance_m"])

    return {"remembered": remembered, "osm": osm, "pois": pois}


@router.get("/geo_tagged_facts")
async def get_geo_tagged_facts(
    limit: int = Query(default=500, ge=1, le=2000),
    token_data: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Phase 9.4c audit G6 — every remembered fact with place_lat/lon.

    Feeds the map's FactMarkerLayer so operators can see where PHANTOM's
    memory lives. Scoped to the requesting user and the limit guards
    long-lived accounts against oversized payloads.
    """
    from memory.geo_query import list_geo_tagged_memories
    facts = await list_geo_tagged_memories(
        db, user_id=token_data.user_id, limit=limit,
    )
    return {"facts": facts, "total": len(facts)}


@router.get("/track")
async def get_track(
    hours: float = Query(default=2.0, ge=0.01, le=168.0),
    token_data: TokenPayload = Depends(require_auth),
) -> dict:
    """
    Recent GPS track reconstructed from the ContextEngine history buffer.
    Only points with a valid GPS fix are returned.
    """
    from core.context_engine import context_engine

    minutes = max(1, int(hours * 60))
    history = context_engine.get_history(minutes=minutes)

    points: list[dict[str, Any]] = []
    last_lat: Optional[float] = None
    last_lon: Optional[float] = None
    for snap in history:
        where = snap.get("where", {})
        lat = where.get("lat")
        lon = where.get("lon")
        fix = where.get("fix")
        if lat is None or lon is None or not fix:
            continue
        # Deduplicate stationary points by tiny delta
        if last_lat is not None and last_lon is not None:
            if abs(lat - last_lat) < 1e-6 and abs(lon - last_lon) < 1e-6:
                continue
        ts_ms = int(snap.get("timestamp", 0))
        iso = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).isoformat()
        speed = float(where.get("speed_kmh", 0.0) or 0.0)
        points.append({"lat": lat, "lon": lon, "ts": iso, "speed": speed})
        last_lat, last_lon = lat, lon

    return {"points": points}


# ── Phase 9.4c audit Q6 — external services health ──────────────────────────


@router.get("/services_health")
async def get_services_health() -> dict[str, Any]:
    """Expose the per-service health snapshot so the frontend can render an
    "enrichment offline" banner when Nominatim / Overpass / ipapi.co are
    unreachable. Public (no-auth) because the map UI polls every 60 s and
    the payload contains only outage timestamps + short reason strings.
    """
    from agent.localization import service_health
    return {"services": service_health.snapshot()}
