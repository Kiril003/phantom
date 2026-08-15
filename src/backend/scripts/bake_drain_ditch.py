#!/usr/bin/env python3
"""
Bake the drain/ditch vehicle-obstacle layer from a live Overpass query.

Queries `waterway=drain` and `waterway=ditch` (way only) nationally against
the Ukraine ISO3166-1 area, and writes the result into the local
`DrainDitchStore` (`geo/sources/drain_ditch.py`). No live per-request fetch
happens after this runs — the served layer (`drain_ditch` manifest,
`source.type: local_db`) reads only from the baked SQLite file this script
writes, the same shape `bake_terrain_hazards.py`/`bake_power_towers.py`
established.

Measured before this script was written (2026-08-15, `out count;` against
the live Ukraine area): **107,864** ways — close to the bake list's own
111,428 (ordinary OSM churn between the sphere survey and today). An
`out geom meta 8;` sample confirmed the element shape: bare
`waterway=drain|ditch` tags predominate, with `name`, `width` (metres,
untyped string), and rarely `designation`/`lock` appearing — every sampled
element was a `way` with real line geometry, none closed into a loop.

    python scripts/bake_drain_ditch.py            # fetch + write
    python scripts/bake_drain_ditch.py --dry-run  # fetch + report, write nothing

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

# Allow `python scripts/bake_drain_ditch.py` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from agent.localization.adapters.rate_limiter import PerSecondRateLimiter  # noqa: E402
from config import config  # noqa: E402
from geo.sources.drain_ditch import (  # noqa: E402
    DITCH_KINDS,
    DrainDitchFeature,
    get_drain_ditch_store,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY_TIMEOUT_S = 300
HTTP_TIMEOUT_S = 340

_QUERY = f"""
[out:json][timeout:{QUERY_TIMEOUT_S}];
area["ISO3166-1"="UA"][admin_level=2]->.ua;
(
  way["waterway"="drain"](area.ua);
  way["waterway"="ditch"](area.ua);
);
out geom meta;
""".strip()


def _feature_from_element(element: dict) -> Optional[DrainDitchFeature]:
    """Overpass JSON element -> `DrainDitchFeature`, or None if unusable."""
    if element.get("type") != "way":
        # Neither tag has a documented node/relation convention — counted
        # by the caller, not silently merged into the way count.
        return None
    kind = element.get("tags", {}).get("waterway")
    if kind not in DITCH_KINDS:
        return None
    geom = element.get("geometry")
    if not geom:
        return None
    tags = element.get("tags", {})
    lats = [pt["lat"] for pt in geom]
    lons = [pt["lon"] for pt in geom]
    coordinates = [[pt["lon"], pt["lat"]] for pt in geom]
    return DrainDitchFeature(
        osm_id=element["id"],
        kind=kind,
        coordinates=coordinates,
        lat_min=min(lats), lat_max=max(lats),
        lon_min=min(lons), lon_max=max(lons),
        name=tags.get("name"),
        width_m=tags.get("width"),
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

    print("Querying Overpass for waterway=drain|ditch (Ukraine, national)...")
    started = time.monotonic()
    elements = await fetch_elements()
    elapsed = time.monotonic() - started
    print(f"  {len(elements)} elements in {elapsed:.1f}s")

    features: list[DrainDitchFeature] = []
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

    store = get_drain_ditch_store()
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
