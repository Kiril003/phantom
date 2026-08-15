#!/usr/bin/env python3
"""
Bake the culvert layer from a live Overpass query.

Queries `tunnel=culvert` (way only) nationally against the Ukraine
ISO3166-1 area, and writes the result into the local `CulvertStore`
(`geo/sources/culverts.py`). No live per-request fetch happens after this
runs — the served layer (`culverts` manifest, `source.type: local_db`)
reads only from the baked SQLite file this script writes, the same shape
`bake_terrain_hazards.py`/`bake_power_towers.py`/`bake_drain_ditch.py`
established.

The tag trap this script exists to not fall into, stated exactly as found:
`waterway=culvert` returns **0** ways nationally (measured 2026-08-15,
live `out count;` — the sphere-sweep bake list quoted 15; either way,
negligible). A culvert in Ukraine's OSM data is tagged as an ordinary
`waterway=river|stream|canal|drain|ditch` way that additionally carries
`tunnel=culvert` (usually with `layer=-1`/`-2`) — this script queries
`tunnel=culvert`, the tag that actually carries **61,961** ways (measured
same session, close to the bake list's 62,932), and additionally queries
`waterway=culvert` for completeness even though it is empty today, so a
future edit that does use it is not silently missed by this baker.

An `out tags meta 15;` sample confirmed the element shape: every sampled
way was a `way` with a `waterway=*` co-tag (river/stream/canal observed;
drain/ditch not seen in 15 draws but expected) and usually `layer=-1`/`-2`.

    python scripts/bake_culverts.py            # fetch + write
    python scripts/bake_culverts.py --dry-run  # fetch + report, write nothing

Respects `config.agent_overpass_enabled` — a False setting refuses to run
rather than silently writing an empty store and looking like a successful
bake.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from typing import Optional

# Allow `python scripts/bake_culverts.py` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from agent.localization.adapters.rate_limiter import PerSecondRateLimiter  # noqa: E402
from config import config  # noqa: E402
from geo.sources.culverts import CulvertFeature, get_culvert_store  # noqa: E402

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY_TIMEOUT_S = 300
HTTP_TIMEOUT_S = 340

_QUERY = f"""
[out:json][timeout:{QUERY_TIMEOUT_S}];
area["ISO3166-1"="UA"][admin_level=2]->.ua;
(
  way["tunnel"="culvert"](area.ua);
  way["waterway"="culvert"](area.ua);
);
out geom meta;
""".strip()


def _feature_from_element(element: dict) -> Optional[CulvertFeature]:
    """Overpass JSON element -> `CulvertFeature`, or None if unusable."""
    if element.get("type") != "way":
        # No node/relation convention documented for either tag — counted
        # by the caller, not silently merged into the way count.
        return None
    tags = element.get("tags", {})
    if tags.get("tunnel") != "culvert" and tags.get("waterway") != "culvert":
        return None
    geom = element.get("geometry")
    if not geom:
        return None
    lats = [pt["lat"] for pt in geom]
    lons = [pt["lon"] for pt in geom]
    coordinates = [[pt["lon"], pt["lat"]] for pt in geom]
    return CulvertFeature(
        osm_id=element["id"],
        coordinates=coordinates,
        lat_min=min(lats), lat_max=max(lats),
        lon_min=min(lons), lon_max=max(lons),
        waterway=tags.get("waterway"),
        name=tags.get("name"),
        layer=tags.get("layer"),
        osm_timestamp=element.get("timestamp"),
    )


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

    print("Querying Overpass for tunnel=culvert (Ukraine, national)...")
    started = time.monotonic()
    elements = await fetch_elements()
    elapsed = time.monotonic() - started
    print(f"  {len(elements)} elements in {elapsed:.1f}s")

    features: list[CulvertFeature] = []
    skipped = 0
    for element in elements:
        feature = _feature_from_element(element)
        if feature is None:
            skipped += 1
            continue
        features.append(feature)

    by_waterway: dict[str, int] = {}
    for f in features:
        key = f.waterway or "(untagged)"
        by_waterway[key] = by_waterway.get(key, 0) + 1
    print(f"  parsed {len(features)} features ({skipped} skipped), by waterway: {by_waterway}")

    if dry_run:
        print("--dry-run: not writing to the store.")
        return 0

    store = get_culvert_store()
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
