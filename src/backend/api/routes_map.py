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

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from db.database import get_db
from db.models import MapPOI, WardrivingRecord
from geo import (
    LayerCategory,
    get_attribution_store,
    get_layer_registry,
)
from geo.layer_registry import LayerNotFoundError
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


# ── Phase 24-A — OmniMap Layer Registry / Attribution ────────────────────


def _session_id_for(token: TokenPayload) -> str:
    """Per-user attribution scope.

    The drawer in the OmniMap HUD shows attribution for *this* operator's
    active layer set — two operators on the same Radxa (rare but
    possible) keep their selections independent.
    """
    return f"user:{token.user_id}"


@router.get("/layers")
async def list_layers(
    category: str | None = Query(default=None),
    offline: bool | None = Query(default=None, description="Filter by available_offline"),
    require_root: bool | None = Query(default=None),
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Return the full layer registry, with this operator's active set."""
    registry = get_layer_registry()
    parsed_cat: LayerCategory | None = None
    if category is not None:
        try:
            parsed_cat = LayerCategory(category)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown category {category!r} — must be one of "
                f"{[c.value for c in LayerCategory]}",
            ) from exc

    layers = registry.filter(
        category=parsed_cat,
        available_offline=offline,
        require_root=require_root,
    )
    store = get_attribution_store()
    session = _session_id_for(token_data)
    active_ids = set(store.active_ids(session_id=session))

    payload: list[dict[str, Any]] = []
    for manifest in layers:
        item = manifest.public_dict()
        item["active"] = manifest.id in active_ids
        payload.append(item)

    return {
        "layers": payload,
        "total": len(payload),
        "categories": [c.value for c in registry.categories()],
        "load_errors": [
            {"file": name, "error": err} for name, err in registry.load_errors()
        ],
    }


@router.post("/layers/{layer_id}/enable")
async def enable_layer(
    layer_id: str,
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Activate `layer_id` in the operator's session and emit the new
    attribution union so the HUD repaints in lock-step."""
    registry = get_layer_registry()
    try:
        manifest = registry.get(layer_id)
    except LayerNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Layer {layer_id!r} not found") from exc

    if manifest.require_root and token_data.role != "ROOT":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Layer {layer_id!r} requires ROOT trust level",
        )

    store = get_attribution_store()
    session = _session_id_for(token_data)
    activation = store.enable(layer_id, session_id=session, via="operator")
    payload = store.public_payload(session_id=session)
    payload["activated"] = {
        "layer_id": activation.layer_id,
        "via": activation.via,
        "activated_at": activation.activated_at,
    }
    return payload


@router.delete("/layers/{layer_id}")
async def disable_layer(
    layer_id: str,
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Remove `layer_id` from the operator's active set."""
    registry = get_layer_registry()
    if not registry.has(layer_id):
        raise HTTPException(status_code=404, detail=f"Layer {layer_id!r} not found")
    store = get_attribution_store()
    session = _session_id_for(token_data)
    was_active = store.disable(layer_id, session_id=session)
    payload = store.public_payload(session_id=session)
    payload["was_active"] = was_active
    return payload


@router.get("/attribution")
async def get_attribution(
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Current per-operator attribution union — used by AttributionDrawer."""
    store = get_attribution_store()
    return store.public_payload(session_id=_session_id_for(token_data))


# ── Phase 24-C — Routing endpoints ────────────────────────────────────────


class _RouteRequestBody(BaseModel):
    waypoints: list[list[float]] = Field(..., min_length=2, max_length=64)
    profile: str = Field(default="car", max_length=24)
    alternatives: int = Field(default=0, ge=0, le=3)
    language: str = Field(default="uk", max_length=5)


class _IsochroneRequestBody(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    time_minutes: int = Field(..., ge=1, le=120)
    profile: str = Field(default="foot", max_length=24)


class _OptimizeVisitBody(BaseModel):
    stops: list[list[float]] = Field(..., min_length=2, max_length=24)
    profile: str = Field(default="car", max_length=24)
    return_to_start: bool = Field(default=False)


class _SnapTrackBody(BaseModel):
    points: list[list[float]] = Field(..., min_length=2, max_length=500)
    timestamps_ms: Optional[list[int]] = None
    profile: str = Field(default="car", max_length=24)


def _resolve_profile(raw: str):
    from geo.routing import RoutingProfile
    try:
        return RoutingProfile(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown profile {raw!r} — valid: {[p.value for p in RoutingProfile]}",
        ) from exc


class _GeocodeBody(BaseModel):
    query: str = Field(..., min_length=1, max_length=256)
    limit: int = Field(default=5, ge=1, le=10)


@router.post("/geocode")
async def post_geocode(
    body: _GeocodeBody,
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Forward-geocode free-form text → candidate coordinates via Nominatim.

    The routing tool's "from"/"to" fields are plain text; this turns them
    into the ``[lat, lon]`` pairs ``POST /map/route`` expects. Results are
    cached inside the geocoder (7-day forward TTL), so repeat lookups are
    free. On geocoder outage we return an empty list rather than raising —
    the caller shows "нічого не знайдено" instead of a hard error.
    """
    from agent.localization.adapters.nominatim import get_default_nominatim

    query = body.query.strip()
    if not query:
        return {"results": []}
    try:
        geocoder = get_default_nominatim()
        results = await geocoder.geocode(query, limit=body.limit)
    except Exception as exc:  # noqa: BLE001 — geocoder is best-effort
        logger.info("geocode failed for %r: %s", query[:40], exc)
        return {"results": []}
    return {
        "results": [
            {
                "lat": r.lat,
                "lon": r.lon,
                "display_name": r.display_name,
                "type": r.place_type,
                "importance": r.importance,
            }
            for r in results
        ]
    }


@router.post("/route")
async def post_route(
    body: _RouteRequestBody,
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Plan a route via the routing facade (BRouter → ORS → OSRM fallback)."""
    from geo.routing import RouteRequest, get_router
    from geo.routing.adapters import RoutingError

    profile = _resolve_profile(body.profile)
    try:
        req = RouteRequest(
            waypoints=[{"lat": p[0], "lon": p[1]} for p in body.waypoints],
            profile=profile,
            alternatives=body.alternatives,
            language=body.language,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"bad waypoints: {exc}") from exc
    try:
        result = await get_router().route(req)
    except RoutingError as exc:
        raise HTTPException(status_code=502, detail=f"no router answered: {exc}") from exc
    return result.model_dump(mode="json")


@router.post("/isochrone")
async def post_isochrone(
    body: _IsochroneRequestBody,
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    from geo.routing import IsochroneRequest, get_router
    from geo.routing.adapters import RoutingError

    profile = _resolve_profile(body.profile)
    req = IsochroneRequest(
        center={"lat": body.lat, "lon": body.lon},
        time_minutes=body.time_minutes,
        profile=profile,
    )
    try:
        result = await get_router().isochrone(req)
    except RoutingError as exc:
        raise HTTPException(status_code=502, detail=f"no isochrone provider: {exc}") from exc
    return result.model_dump(mode="json")


@router.post("/route/optimize")
async def post_optimize_visit(
    body: _OptimizeVisitBody,
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    from geo.routing import MatrixRequest, get_router
    from geo.routing.adapters import RoutingError

    profile = _resolve_profile(body.profile)
    try:
        req = MatrixRequest(
            points=[{"lat": p[0], "lon": p[1]} for p in body.stops],
            profile=profile,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"bad stops: {exc}") from exc
    try:
        mat = await get_router().matrix(req)
    except RoutingError as exc:
        raise HTTPException(status_code=502, detail=f"no matrix provider: {exc}") from exc

    n = len(body.stops)
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
    if body.return_to_start:
        total_s += mat.durations_s[cur][0]
        order.append(0)
    return {
        "order": order,
        "total_duration_s": total_s,
        "engine": mat.engine,
        "profile": profile.value,
    }


# ── Phase 24-G — Analytics & Elevation ──────────────────────────────────────


class _ElevationProfileRequest(BaseModel):
    points: list[list[float]] = Field(..., min_length=2, max_length=500)


@router.get("/elevation")
async def get_elevation(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Fetch elevation for a single point."""
    from geo.elevation import ElevationUnavailable, get_elevation_service
    try:
        elev = await get_elevation_service().get_elevation(lat, lon)
    except ElevationUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"lat": lat, "lon": lon, "elevation_m": elev}


@router.post("/elevation/profile")
async def post_elevation_profile(
    body: _ElevationProfileRequest,
    token_data: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Compute elevation profile along a path."""
    from geo.elevation import ElevationUnavailable, get_elevation_service
    points = [(p[0], p[1]) for p in body.points]
    try:
        profile = await get_elevation_service().get_profile(points)
    except ElevationUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"profile": [s.model_dump() for s in profile]}


# ── Джерела місця для ПК ─────────────────────────────────────────────────────
#
# У ПК немає супутникового приймача, і не мусить бути. Місце складається з
# того, що є під рукою: остання позиція спареного телефона і точки доступу,
# які він щойно бачив. Тут ми лише ЧЕСНО віддаємо сировину — рішення, кому
# вірити, ухвалює клієнт (`services/positioning/fuse.ts`), бо саме він знає,
# що ще бачить браузер.


class PositionApOut(BaseModel):
    mac: str
    ssid: str = ""
    rssi: int
    #: Координати відомі лише для точок, які ми колись записали з фіксом.
    lat: Optional[float] = None
    lon: Optional[float] = None


class PhonePositionOut(BaseModel):
    device_id: str
    device_name: str
    lat: float
    lon: float
    accuracy_m: Optional[float] = None
    motion_class: Optional[str] = None
    #: Скільки секунд тому телефон це заміряв. Свіжість тут важить не менше
    #: за саму точність: хвилинної давності місце вже не описує дійсність.
    age_s: float


class PositionSourcesOut(BaseModel):
    phone: Optional[PhonePositionOut] = None
    aps: list[PositionApOut] = Field(default_factory=list)
    #: Скільки пристроїв спарено взагалі — щоб UI міг сказати «телефон не
    #: підключено», а не мовчати.
    paired_devices: int = 0


@router.get("/position_sources", response_model=PositionSourcesOut)
async def get_position_sources(
    max_age_s: int = Query(600, ge=10, le=86_400),
    db: AsyncSession = Depends(get_db),
    token_data: TokenPayload = Depends(require_auth),
) -> PositionSourcesOut:
    """Останнє місце з телефона + точки доступу, які він бачив."""
    from db.models import MobileSensorBatch, PairedDevice

    user_id = getattr(token_data, "user_id", None) or getattr(token_data, "sub", None)

    paired_q = select(PairedDevice).where(
        PairedDevice.user_id == user_id,
        PairedDevice.revoked_at.is_(None),
    )
    paired = list((await db.execute(paired_q)).scalars().all())

    batch_q = (
        select(MobileSensorBatch)
        .where(MobileSensorBatch.user_id == user_id)
        .order_by(MobileSensorBatch.received_at.desc())
        .limit(1)
    )
    batch = (await db.execute(batch_q)).scalars().first()
    if batch is None:
        return PositionSourcesOut(paired_devices=len(paired))

    now = datetime.now(tz=timezone.utc)
    received = batch.received_at
    if received.tzinfo is None:
        received = received.replace(tzinfo=timezone.utc)
    age_s = max(0.0, (now - received).total_seconds())
    if age_s > max_age_s:
        return PositionSourcesOut(paired_devices=len(paired))

    phone = None
    if batch.gps_lat is not None and batch.gps_lon is not None:
        device = next((d for d in paired if d.id == batch.device_id), None)
        phone = PhonePositionOut(
            device_id=batch.device_id,
            device_name=getattr(device, "device_name", None) or "телефон",
            lat=float(batch.gps_lat),
            lon=float(batch.gps_lon),
            accuracy_m=batch.gps_accuracy_m,
            motion_class=batch.motion_class,
            age_s=age_s,
        )

    # Точки доступу з останнього пакета, збагачені координатами з тих
    # записів, які ми вже маємо. Без координат точка не допомагає визначити
    # місце — але ми її однаково віддаємо, бо вона доводить, ЩО саме видно.
    aps: list[PositionApOut] = []
    try:
        seen = json.loads(batch.wifi_json or "[]")
    except (ValueError, TypeError):
        seen = []
    macs = [str(w.get("mac")) for w in seen if w.get("mac")]
    known: dict[str, WardrivingRecord] = {}
    if macs:
        rows = (
            await db.execute(select(WardrivingRecord).where(WardrivingRecord.mac.in_(macs[:200])))
        ).scalars().all()
        for r in rows:
            prev = known.get(r.mac)
            if prev is None or r.last_seen > prev.last_seen:
                known[r.mac] = r
    for w in seen[:200]:
        mac = str(w.get("mac") or "")
        if not mac:
            continue
        rec = known.get(mac)
        aps.append(
            PositionApOut(
                mac=mac,
                ssid=str(w.get("ssid") or ""),
                rssi=int(w.get("rssi") or -100),
                lat=(float(rec.lat) if rec else None),
                lon=(float(rec.lon) if rec else None),
            )
        )

    return PositionSourcesOut(phone=phone, aps=aps, paired_devices=len(paired))
