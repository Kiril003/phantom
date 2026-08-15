"""Power transmission tower layer — `power=tower`, baked from OSM.

Sourced from `recovered/sphere-synthesis-v2.md` §1 (the energy-comms sphere)
and the PC-kitchen bake list built on it: **621,121** `power=tower` nodes
measured live against Ukraine's Overpass area on 2026-08-15 (national count,
`out count;`), close to the sphere's own 629,790 (ordinary OSM churn between
surveys, not a discrepancy worth chasing). This is the country's densest
single landmark network, and per the sphere's own framing it needs no DEM,
no live polling, and no owner decision to ship — the OSM tag is the fact,
exactly the same shape `terrain_hazards.py` already established for
`natural=cliff|scree|bare_rock`.

This is a `local_db`-sourced layer (see
`layer_registry/manifests/power_towers.yaml`): baked once by
`scripts/bake_power_towers.py` from a live Overpass query, then served from
this on-disk SQLite store with zero per-request upstream fetch — the same
shape `cliff_scree` uses, unlike the Overpass-backed `bunkers`/`substations`
which go silent without a network.

Register/freshness follow `recovered/map-register-schema.md` §1: every
served feature carries `reg` and `fresh`, never omits them just because the
value is constant here. `reg` is always `"measured"` for this layer — the
OSM tag *is* the fact, not an inference — but the field still travels on
every feature so a renderer never has to special-case "this layer never
says why it's confident." `fresh` is a half-year bucket derived from the
OSM element's own edit timestamp (Overpass `out meta`), falling back to a
fixed pre-2015 bucket when no timestamp is available — identical bucketing
function to `terrain_hazards.freshness_bucket`, duplicated rather than
imported because no shared `geo.register` module exists yet for either
layer to import from (both would need the same follow-up extraction).

Scope decision, stated rather than silently narrowed: `power=tower` is
overwhelmingly a `node` in Ukraine's OSM data (spot-checked: 20/20 sampled
elements were nodes; no way/relation-typed tower was observed). This module
only models node geometry — a tower tagged on a way or relation is not
representable here and is skipped by the baker with a counted, logged
reason, not silently dropped.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Iterator, Optional

logger = logging.getLogger(__name__)

#: The single OSM `power=*` value this layer draws from. Kept as a tuple
#: (not a bare string) to match `terrain_hazards.HAZARD_KINDS`'s shape —
#: any future sibling tag (e.g. `power=pole`) extends this, not a rewrite.
TOWER_KINDS: tuple[str, ...] = ("tower",)

#: The OSM tag itself is the fact — see module docstring. Always `measured`
#: for this layer; still emitted per feature (map-register-schema.md §1).
REGISTER = "measured"

#: Bucket used when an element carries no OSM edit timestamp at all.
_PRE_2015_BUCKET = "pre2015"

_EARLIEST_BUCKET_YEAR = 2015


def freshness_bucket(dt: Optional[datetime]) -> str:
    """Half-year bucket per map-register-schema.md §1 (`fresh`).

    Identical rule to `terrain_hazards.freshness_bucket`: deliberately
    coarser than the source timestamp, because nothing downstream ever
    branches finer than roughly-seasonal granularity. `None` or anything
    older than the catch-all threshold collapses to `"pre2015"`.
    """
    if dt is None or dt.year < _EARLIEST_BUCKET_YEAR:
        return _PRE_2015_BUCKET
    half = "H1" if dt.month <= 6 else "H2"
    return f"{dt.year}{half}"


def _parse_osm_timestamp(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass(frozen=True)
class PowerTowerFeature:
    """One baked OSM element — a `power=tower` node."""

    osm_id: int
    lat: float
    lon: float
    ref: Optional[str] = None  # line-position reference number, where tagged
    design: Optional[str] = None  # e.g. "monopolar" — structural type, where tagged
    disused: bool = False
    osm_timestamp: Optional[str] = None  # ISO8601, from Overpass `out meta`

    osm_type: str = "node"
    kind: str = "tower"

    @property
    def id(self) -> str:
        return f"{self.osm_type}/{self.osm_id}"

    @property
    def freshness(self) -> str:
        return freshness_bucket(_parse_osm_timestamp(self.osm_timestamp))

    def to_geojson_feature(self) -> dict:
        """Frontend-facing shape — `reg`/`fresh` always present, per §1."""
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": [self.lon, self.lat]},
            "properties": {
                "osm_type": self.osm_type,
                "osm_id": self.osm_id,
                "kind": self.kind,
                "ref": self.ref,
                "design": self.design,
                "disused": self.disused,
                "reg": REGISTER,
                "fresh": self.freshness,
            },
        }


# ── Store ────────────────────────────────────────────────────────────────


class PowerTowerStore:
    """On-disk SQLite store for baked `power=tower` nodes.

    Mirrors `terrain_hazards.TerrainHazardStore`'s connection idiom (WAL,
    short-lived connections, a lock around writers) — this file is written
    once per bake run and read many times per render, never the other way
    round.
    """

    def __init__(self, sqlite_path: Path) -> None:
        self._sqlite_path = Path(sqlite_path)
        self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_schema()

    @property
    def sqlite_path(self) -> Path:
        return self._sqlite_path

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._sqlite_path, timeout=5.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS power_towers (
                    id             TEXT PRIMARY KEY,
                    osm_id         INTEGER NOT NULL,
                    lat            REAL NOT NULL,
                    lon            REAL NOT NULL,
                    ref            TEXT,
                    design         TEXT,
                    disused        INTEGER NOT NULL DEFAULT 0,
                    osm_timestamp  TEXT,
                    baked_at       REAL NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_power_towers_bbox "
                "ON power_towers (lat, lon)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS power_towers_meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.commit()

    # ── Write path ──────────────────────────────────────────────────

    def clear(self) -> None:
        """Drop every baked row — used before a full re-bake."""
        with self._lock, self._conn() as conn:
            conn.execute("DELETE FROM power_towers")
            conn.commit()

    def upsert_features(self, features: Iterable[PowerTowerFeature]) -> int:
        """Insert-or-replace every feature. Returns the count written."""
        now = time.time()
        rows = [
            (
                f.id,
                f.osm_id,
                f.lat,
                f.lon,
                f.ref,
                f.design,
                1 if f.disused else 0,
                f.osm_timestamp,
                now,
            )
            for f in features
        ]
        if not rows:
            return 0
        with self._lock, self._conn() as conn:
            conn.executemany(
                """
                INSERT INTO power_towers (
                    id, osm_id, lat, lon, ref, design, disused,
                    osm_timestamp, baked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    osm_id=excluded.osm_id,
                    lat=excluded.lat,
                    lon=excluded.lon,
                    ref=excluded.ref,
                    design=excluded.design,
                    disused=excluded.disused,
                    osm_timestamp=excluded.osm_timestamp,
                    baked_at=excluded.baked_at
                """,
                rows,
            )
            conn.commit()
        return len(rows)

    def set_meta(self, key: str, value: str) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO power_towers_meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            conn.commit()

    def get_meta(self, key: str) -> Optional[str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM power_towers_meta WHERE key = ?", (key,)
            ).fetchone()
        return row[0] if row else None

    # ── Read path ───────────────────────────────────────────────────

    def query_bbox(
        self,
        lat_min: float,
        lon_min: float,
        lat_max: float,
        lon_max: float,
        *,
        limit: int = 5000,
    ) -> list[dict]:
        """GeoJSON point features inside the query bbox.

        Points have zero extent, so bbox-intersection and centroid
        containment coincide here — the intersection framing from
        `terrain_hazards.query_bbox` is kept anyway (same clause shape) so
        this store behaves identically if a future way/relation tower is
        ever added with a real extent.
        """
        clauses = ["lat >= ?", "lat <= ?", "lon >= ?", "lon <= ?"]
        params: list = [lat_min, lat_max, lon_min, lon_max]
        params.append(max(1, min(limit, 20000)))

        sql = (
            "SELECT id, osm_id, lat, lon, ref, design, disused, osm_timestamp "
            "FROM power_towers WHERE " + " AND ".join(clauses) + " LIMIT ?"
        )
        with self._conn() as conn:
            cursor = conn.execute(sql, params)
            out: list[dict] = []
            for row in cursor:
                _id, osm_id, lat, lon, ref, design, disused, osm_timestamp = row
                feature = PowerTowerFeature(
                    osm_id=osm_id,
                    lat=lat,
                    lon=lon,
                    ref=ref,
                    design=design,
                    disused=bool(disused),
                    osm_timestamp=osm_timestamp,
                )
                out.append(feature.to_geojson_feature())
        return out

    def count(self) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) FROM power_towers").fetchone()
        return int(row[0]) if row else 0


# ── Singleton ────────────────────────────────────────────────────────────

_store_lock = threading.Lock()
_store: Optional[PowerTowerStore] = None


def _default_sqlite_path() -> Path:
    # Late import — `paths` may pull config which pulls geo at boot; keep lazy.
    from paths import resolve_data_dir

    return resolve_data_dir("workspace") / "power_towers.sqlite"


def get_power_tower_store() -> PowerTowerStore:
    """Return (and lazily create) the process-wide store."""
    global _store
    if _store is not None:
        return _store
    with _store_lock:
        if _store is None:
            _store = PowerTowerStore(_default_sqlite_path())
    return _store


def reset_power_tower_store_for_tests(
    sqlite_path: Optional[Path] = None,
) -> PowerTowerStore:
    """Replace the singleton — pytest helper, never call from runtime."""
    global _store
    with _store_lock:
        _store = PowerTowerStore(sqlite_path or _default_sqlite_path())
    return _store
