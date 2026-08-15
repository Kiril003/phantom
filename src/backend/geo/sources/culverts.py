"""Culvert layer — `tunnel=culvert`, baked from OSM.

Sourced from the PC-kitchen bake list built on `recovered/sphere-synthesis-v2.md`:
**61,961** `tunnel=culvert` ways measured live against Ukraine's Overpass area
on 2026-08-15 (`out count;`), close to the bake list's own 62,932 (ordinary
OSM churn, not a discrepancy worth chasing). The trap the bake list named is
real and independently confirmed here: `waterway=culvert` returns **0**
nationally in this same live check (the task's own figure was 15 — either
way, negligible) — a culvert in Ukraine's OSM data is tagged as an ordinary
`waterway=river|stream|canal|drain|ditch` way that additionally carries
`tunnel=culvert` (usually with `layer=-1`/`-2`), not as a distinct
`waterway=culvert` value. A query that only looks for the latter finds
almost nothing; this module and its baker query `tunnel=culvert` — the tag
that actually carries the fact — and additionally query `waterway=culvert`
for completeness even though it is empty today, so a future edit that does
use it is not silently missed.

A culvert marks where a watercourse is piped underground, almost always
under a road, railway or embankment — the crossing point above is
passable, and the buried point itself is where surface water disappears
and reappears, exactly the kind of terrain fact a mapper stood at and
traced. Same shape as `cliff_scree`/`power_towers`/`drain_ditch`: a
direct, ground-tagged feature needing no DEM, no live polling, and no
owner decision to ship.

This is a `local_db`-sourced layer (see
`layer_registry/manifests/culverts.yaml`): baked once by
`scripts/bake_culverts.py` from a live Overpass query, then served from
this on-disk SQLite store with zero per-request upstream fetch.

Register/freshness follow `recovered/map-register-schema.md` §1: every
served feature carries `reg` and `fresh`, never omits them. `reg` is
always `"measured"` — the OSM tag *is* the fact. `fresh` is a half-year
bucket derived from the OSM element's own edit timestamp, identical
bucketing rule to the three sibling layers (duplicated, not imported — no
shared `geo.register` module exists yet for any of them to import from).

Scope decision, stated rather than silently narrowed: every sampled
`tunnel=culvert` element (15/15) was a `way` with real line geometry and a
`waterway=*` co-tag identifying what runs through it (river/stream/canal
observed in the sample; drain/ditch expected but not seen in 15 draws).
This module only models `way` geometry as `LineString` — the same
LineString-only choice `drain_ditch.py` made, for the same reason: no
closed-loop culvert was observed or would make physical sense (a culvert
is a buried segment, not an area).
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

#: The OSM tag itself is the fact — see module docstring. Always `measured`
#: for this layer; still emitted per feature (map-register-schema.md §1).
REGISTER = "measured"

#: Bucket used when an element carries no OSM edit timestamp at all.
_PRE_2015_BUCKET = "pre2015"

_EARLIEST_BUCKET_YEAR = 2015


def freshness_bucket(dt: Optional[datetime]) -> str:
    """Half-year bucket per map-register-schema.md §1 (`fresh`).

    Identical rule to the sibling baked layers: deliberately coarser than
    the source timestamp, because nothing downstream ever branches finer
    than roughly-seasonal granularity. `None` or anything older than the
    catch-all threshold collapses to `"pre2015"`.
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
class CulvertFeature:
    """One baked OSM element — a `tunnel=culvert` way."""

    osm_id: int
    coordinates: list  # [[lon, lat], ...] — always a LineString, see module docstring
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    waterway: Optional[str] = None  # the co-tagged watercourse type, e.g. "river"
    name: Optional[str] = None
    layer: Optional[str] = None  # raw `layer=*` tag value, e.g. "-1"
    osm_timestamp: Optional[str] = None  # ISO8601, from Overpass `out meta`

    osm_type: str = "way"
    kind: str = "culvert"

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
            "geometry": {"type": "LineString", "coordinates": self.coordinates},
            "properties": {
                "osm_type": self.osm_type,
                "osm_id": self.osm_id,
                "kind": self.kind,
                "waterway": self.waterway,
                "name": self.name,
                "layer": self.layer,
                "reg": REGISTER,
                "fresh": self.freshness,
            },
        }


# ── Store ────────────────────────────────────────────────────────────────


class CulvertStore:
    """On-disk SQLite store for baked culvert geometry.

    Mirrors `terrain_hazards.TerrainHazardStore`'s connection idiom (WAL,
    short-lived connections, a lock around writers) — written once per
    bake run, read many times per render.
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
                CREATE TABLE IF NOT EXISTS culverts (
                    id             TEXT PRIMARY KEY,
                    osm_id         INTEGER NOT NULL,
                    waterway       TEXT,
                    name           TEXT,
                    layer          TEXT,
                    coordinates_json TEXT NOT NULL,
                    osm_timestamp  TEXT,
                    lat_min        REAL NOT NULL,
                    lat_max        REAL NOT NULL,
                    lon_min        REAL NOT NULL,
                    lon_max        REAL NOT NULL,
                    baked_at       REAL NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_culverts_bbox "
                "ON culverts (lat_min, lat_max, lon_min, lon_max)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS culverts_meta (
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
            conn.execute("DELETE FROM culverts")
            conn.commit()

    def upsert_features(self, features: Iterable[CulvertFeature]) -> int:
        """Insert-or-replace every feature. Returns the count written."""
        now = time.time()
        rows = [
            (
                f.id,
                f.osm_id,
                f.waterway,
                f.name,
                f.layer,
                json.dumps(f.coordinates),
                f.osm_timestamp,
                f.lat_min,
                f.lat_max,
                f.lon_min,
                f.lon_max,
                now,
            )
            for f in features
        ]
        if not rows:
            return 0
        with self._lock, self._conn() as conn:
            conn.executemany(
                """
                INSERT INTO culverts (
                    id, osm_id, waterway, name, layer, coordinates_json,
                    osm_timestamp, lat_min, lat_max, lon_min, lon_max, baked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    osm_id=excluded.osm_id,
                    waterway=excluded.waterway,
                    name=excluded.name,
                    layer=excluded.layer,
                    coordinates_json=excluded.coordinates_json,
                    osm_timestamp=excluded.osm_timestamp,
                    lat_min=excluded.lat_min,
                    lat_max=excluded.lat_max,
                    lon_min=excluded.lon_min,
                    lon_max=excluded.lon_max,
                    baked_at=excluded.baked_at
                """,
                rows,
            )
            conn.commit()
        return len(rows)

    def set_meta(self, key: str, value: str) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO culverts_meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            conn.commit()

    def get_meta(self, key: str) -> Optional[str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM culverts_meta WHERE key = ?", (key,)
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
        """GeoJSON features whose bbox intersects the query bbox.

        Bbox-intersection test, not centroid containment — same rule
        `terrain_hazards.query_bbox`/`drain_ditch.query_bbox` use, so a
        culvert straddling the viewport edge still returns.
        """
        clauses = [
            "lat_min <= ?",
            "lat_max >= ?",
            "lon_min <= ?",
            "lon_max >= ?",
        ]
        params: list = [lat_max, lat_min, lon_max, lon_min]
        params.append(max(1, min(limit, 20000)))

        sql = (
            "SELECT id, osm_id, waterway, name, layer, coordinates_json, osm_timestamp "
            "FROM culverts WHERE " + " AND ".join(clauses) + " LIMIT ?"
        )
        with self._conn() as conn:
            cursor = conn.execute(sql, params)
            out: list[dict] = []
            for row in cursor:
                (
                    _id, osm_id, waterway, name, layer, coords_json, osm_timestamp,
                ) = row
                feature = CulvertFeature(
                    osm_id=osm_id,
                    coordinates=json.loads(coords_json),
                    lat_min=0.0, lat_max=0.0, lon_min=0.0, lon_max=0.0,
                    waterway=waterway,
                    name=name,
                    layer=layer,
                    osm_timestamp=osm_timestamp,
                )
                out.append(feature.to_geojson_feature())
        return out

    def count(self) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) FROM culverts").fetchone()
        return int(row[0]) if row else 0


# ── Singleton ────────────────────────────────────────────────────────────

_store_lock = threading.Lock()
_store: Optional[CulvertStore] = None


def _default_sqlite_path() -> Path:
    # Late import — `paths` may pull config which pulls geo at boot; keep lazy.
    from paths import resolve_data_dir

    return resolve_data_dir("workspace") / "culverts.sqlite"


def get_culvert_store() -> CulvertStore:
    """Return (and lazily create) the process-wide store."""
    global _store
    if _store is not None:
        return _store
    with _store_lock:
        if _store is None:
            _store = CulvertStore(_default_sqlite_path())
    return _store


def reset_culvert_store_for_tests(
    sqlite_path: Optional[Path] = None,
) -> CulvertStore:
    """Replace the singleton — pytest helper, never call from runtime."""
    global _store
    with _store_lock:
        _store = CulvertStore(sqlite_path or _default_sqlite_path())
    return _store
