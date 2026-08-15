#!/usr/bin/env python3
"""
Bake the power-transmission-tower landmark layer from a live Overpass query.

Queries `power=tower` (node only) nationally against the Ukraine ISO3166-1
area, and writes the result into the local `PowerTowerStore`
(`geo/sources/power_towers.py`). No live per-request fetch happens after
this runs — the served layer (`power_towers` manifest, `source.type:
local_db`) reads only from the baked SQLite file this script writes, the
same shape `bake_terrain_hazards.py` established for `cliff_scree`.

Measured before this script was written (2026-08-15, `out count;` against
the live Ukraine area): **621,121** nodes — close to
`recovered/sphere-synthesis-v2.md`'s 629,790 (ordinary OSM churn between
the sphere survey and today, not a discrepancy worth chasing). A `out meta
20;` sample of 20 nodes confirmed the element shape: bare `power=tower`
tags predominate, with `ref` (line-position number), `design` (structural
type, e.g. "monopolar"), and `disused` appearing occasionally — no `name`
observed in the sample. Way/relation-typed towers were not observed in the
sample; the parser below only accepts `node` elements and counts (rather
than silently drops) anything else, so a future relation-tagged tower is
visible in the run's own printed summary instead of vanishing.

Scope is the full national query, not a bounded subset — a `[out:json]`
`out meta;` fetch of ~621k nodes was run end-to-end against the live public
Overpass mirror while this layer was built (see the module's own bake
output for the measured element count, elapsed time, and parsed feature
count) and completed within this script's timeout budget. If a future
re-bake against a slower mirror or a larger dataset times out, the honest
fix is a higher `QUERY_TIMEOUT_S`/`HTTP_TIMEOUT_S`, not a silently narrower
bbox — this script does not accept one.

    python scripts/bake_power_towers.py            # fetch + write
    python scripts/bake_power_towers.py --dry-run  # fetch + report, write nothing

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

# Allow `python scripts/bake_power_towers.py` from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from agent.localization.adapters.rate_limiter import PerSecondRateLimiter  # noqa: E402
from config import config  # noqa: E402
from geo.sources.power_towers import (  # noqa: E402
    PowerTowerFeature,
    get_power_tower_store,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# National `power=tower` is ~621k nodes (measured 2026-08-15) — the fetch
# itself took well under two minutes against the public mirror, but the
# server-side query timeout and the client HTTP timeout are both set with
# generous headroom rather than tuned to the measured minimum.
QUERY_TIMEOUT_S = 500
HTTP_TIMEOUT_S = 580

_QUERY = f"""
[out:json][timeout:{QUERY_TIMEOUT_S}];
area["ISO3166-1"="UA"][admin_level=2]->.ua;
(
  node["power"="tower"](area.ua);
);
out meta;
""".strip()


def _feature_from_element(element: dict) -> Optional[PowerTowerFeature]:
    """Overpass JSON element -> `PowerTowerFeature`, or None if unusable."""
    if element.get("type") != "node":
        # power=tower on a way/relation is not representable by this
        # store (point-only) — counted by the caller, not silently merged
        # into the node count.
        return None
    tags = element.get("tags", {})
    if tags.get("power") != "tower":
        return None
    lat, lon = element.get("lat"), element.get("lon")
    if lat is None or lon is None:
        return None
    return PowerTowerFeature(
        osm_id=element["id"],
        lat=lat,
        lon=lon,
        ref=tags.get("ref"),
        design=tags.get("design"),
        disused=tags.get("disused") == "yes",
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

    print("Querying Overpass for power=tower (Ukraine, national)...")
    started = time.monotonic()
    elements = await fetch_elements()
    elapsed = time.monotonic() - started
    print(f"  {len(elements)} elements in {elapsed:.1f}s")

    features: list[PowerTowerFeature] = []
    skipped = 0
    for element in elements:
        feature = _feature_from_element(element)
        if feature is None:
            skipped += 1
            continue
        features.append(feature)

    print(f"  parsed {len(features)} features ({skipped} skipped)")

    if dry_run:
        print("--dry-run: not writing to the store.")
        return 0

    store = get_power_tower_store()
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
