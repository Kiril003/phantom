#!/usr/bin/env python3
"""
Bake the cliff/scree/bare_rock hazard layer from a live Overpass query.

Queries `natural=cliff` (node+way), `natural=scree` (way) and `natural=bare_rock`
(way) nationally against the Ukraine ISO3166-1 area, and writes the result into
the local `TerrainHazardStore` (`geo/sources/terrain_hazards.py`). No live
per-request fetch happens after this runs — the served layer (`cliff_scree`
manifest, `source.type: local_db`) reads only from the baked SQLite file this
script writes, exactly like `wardriving`/`cell_towers` read from their own
local stores instead of hitting an upstream API per request.

Relation-typed elements (multipolygon cliffs/scree — ~2.7% of the national
total per taginfo, `recovered/layer-cliff-scree.md`) are deliberately not
queried: assembling multipolygon geometry correctly from relation members is
a separate task, and node+way alone already covers the overwhelming majority
(matches `recovered/sphere-terrain-hazard.md`'s measured counts).

    python scripts/bake_terrain_hazards.py            # fetch + write
    python scripts/bake_terrain_hazards.py --dry-run  # fetch + report, write nothing

Respects `config.agent_overpass_enabled` — a False setting refuses to run
rather than silently writing an empty store and looking like a successful bake.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from typing import Optional

# Allow `python scripts/bake_terrain_hazards.py` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from agent.localization.adapters.rate_limiter import PerSecondRateLimiter  # noqa: E402
from config import config  # noqa: E402
from geo.sources.terrain_hazards import (  # noqa: E402
    HAZARD_KINDS,
    TerrainHazardFeature,
    get_terrain_hazard_store,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY_TIMEOUT_S = 180
HTTP_TIMEOUT_S = 210

_QUERY = f"""
[out:json][timeout:{QUERY_TIMEOUT_S}];
area["ISO3166-1"="UA"][admin_level=2]->.ua;
(
  node["natural"="cliff"](area.ua);
  way["natural"="cliff"](area.ua);
  way["natural"="scree"](area.ua);
  way["natural"="bare_rock"](area.ua);
);
out geom meta;
""".strip()


def _is_closed_way(node_ids: list[int]) -> bool:
    return len(node_ids) >= 4 and node_ids[0] == node_ids[-1]


def _feature_from_element(element: dict) -> Optional[TerrainHazardFeature]:
    """Overpass JSON element -> `TerrainHazardFeature`, or None if unusable."""
    kind = element.get("tags", {}).get("natural")
    if kind not in HAZARD_KINDS:
        return None
    name = element.get("tags", {}).get("name")
    osm_timestamp = element.get("timestamp")
    element_type = element.get("type")

    if element_type == "node":
        lat, lon = element.get("lat"), element.get("lon")
        if lat is None or lon is None:
            return None
        return TerrainHazardFeature(
            osm_type="node",
            osm_id=element["id"],
            kind=kind,
            geometry_type="Point",
            coordinates=[lon, lat],
            lat_min=lat, lat_max=lat, lon_min=lon, lon_max=lon,
            name=name,
            osm_timestamp=osm_timestamp,
        )

    if element_type == "way":
        geom = element.get("geometry")
        if not geom:
            return None
        lats = [pt["lat"] for pt in geom]
        lons = [pt["lon"] for pt in geom]
        line = [[pt["lon"], pt["lat"]] for pt in geom]
        # Scree/bare_rock are area features by OSM convention; a cliff is a
        # line along the edge unless the mapper closed the way into a loop.
        # "Closed loop -> Polygon" is the honest general rule OSM itself
        # uses (area-ness follows from the way's own shape), not a tag-by-
        # tag special case.
        closed = _is_closed_way(element.get("nodes", []))
        geometry_type = "Polygon" if closed else "LineString"
        coordinates = [line] if geometry_type == "Polygon" else line
        return TerrainHazardFeature(
            osm_type="way",
            osm_id=element["id"],
            kind=kind,
            geometry_type=geometry_type,
            coordinates=coordinates,
            lat_min=min(lats), lat_max=max(lats),
            lon_min=min(lons), lon_max=max(lons),
            name=name,
            osm_timestamp=osm_timestamp,
        )

    return None


async def fetch_elements() -> list[dict]:
    limiter = PerSecondRateLimiter(1.0)
    await limiter.wait()
    # Same fix `agent/localization/adapters/overpass.py` already carries:
    # Overpass's public mirror 406s the default `python-httpx/*` User-Agent.
    ua = str(
        getattr(config, "agent_overpass_user_agent", "PHANTOM-OS/0.9") or "PHANTOM-OS/0.9"
    )
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S, headers={"User-Agent": ua}) as client:
        resp = await client.post(OVERPASS_URL, data={"data": _QUERY})
        resp.raise_for_status()
        payload = resp.json()
    return payload.get("elements", [])


async def run(*, dry_run: bool) -> int:
    if not config.agent_overpass_enabled:
        print(
            "agent_overpass_enabled is False — refusing to bake from a "
            "disabled source rather than silently writing an empty store."
        )
        return 1

    print("Querying Overpass for natural=cliff|scree|bare_rock (Ukraine)...")
    started = time.monotonic()
    elements = await fetch_elements()
    elapsed = time.monotonic() - started
    print(f"  {len(elements)} elements in {elapsed:.1f}s")

    features: list[TerrainHazardFeature] = []
    skipped = 0
    for element in elements:
        feature = _feature_from_element(element)
        if feature is None:
            skipped += 1
            continue
        features.append(feature)

    by_kind: dict[str, int] = {}
    for f in features:
        by_kind[f.kind] = by_kind.get(f.kind, 0) + 1
    print(f"  parsed {len(features)} features ({skipped} skipped): {by_kind}")

    if dry_run:
        print("--dry-run: not writing to the store.")
        return 0

    store = get_terrain_hazard_store()
    store.clear()
    written = store.upsert_features(features)
    store.set_meta("source", "overpass-api.de")
    store.set_meta("baked_at", str(int(time.time())))
    store.set_meta("query", _QUERY)
    print(f"  wrote {written} features to {store.sqlite_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="fetch and report, write nothing"
    )
    args = parser.parse_args()
    return asyncio.run(run(dry_run=args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
