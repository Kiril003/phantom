"""Terrain hazard layer — `natural=cliff` / `scree` / `bare_rock`, baked from OSM.

Sourced from `recovered/sphere-terrain-hazard.md` (today's map-sphere sweep):
national counts (~11.4k cliff ways, ~1.7k scree, ~2.5k bare_rock), cross-checked
live against Geofabrik's regional taginfo instance and a hand-run Overpass query
before this module was written (`recovered/layer-cliff-scree.md`). Unlike
`avalanche_transceiver`-style features, `natural=cliff|scree|bare_rock` is a
*direct, ground-tagged* obstacle — a mapper stood there and drew it — so this
layer needs no DEM, no live polling, and no owner decision to ship.

This is a `local_db`-sourced layer (see `layer_registry/manifests/cliff_scree.yaml`):
baked once by `scripts/bake_terrain_hazards.py` from a live Overpass query, then
served from this on-disk SQLite store with zero per-request upstream fetch — the
same shape `cell_towers.yaml` describes, but this is the one that's actually
wired end to end.

Register/freshness follow `recovered/map-register-schema.md` §1: every served
feature carries `reg` and `fresh`, never omits them just because the value is
constant here. `reg` is always `"measured"` for this layer — the OSM tag *is*
the fact, not an inference — but the field still travels on every feature so a
renderer never has to special-case "this layer never says why it's confident."
`fresh` is a half-year bucket derived from the OSM element's own edit
timestamp (Overpass `out meta`), falling back to a fixed pre-2015 bucket when
no timestamp is available.
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

#: OSM `natural=*` values this layer draws from. Order matters only for display.
HAZARD_KINDS: tuple[str, ...] = ("cliff", "scree", "bare_rock")

#: The OSM tag itself is the fact — see module docstring. Always `measured`
#: for this layer; still emitted per feature (map-register-schema.md §1).
REGISTER = "measured"

#: Bucket used when an element carries no OSM edit timestamp at all.
_PRE_2015_BUCKET = "pre2015"

_EARLIEST_BUCKET_YEAR = 2015


def freshness_bucket(dt: Optional[datetime]) -> str:
    """Half-year bucket per map-register-schema.md §1 (`fresh`).

    Deliberately coarser than the source timestamp: nothing downstream (the
    register-downgrade rule, the staleness contract) ever branches finer
    than roughly-seasonal granularity. `None` or anything older than the
    catch-all threshold collapses to `"pre2015"`, the same "century of
    buckets, mostly unused" convention the schema names.
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
class TerrainHazardFeature:
    """One baked OSM element — a cliff way, a scree polygon, a bare-rock area."""

    osm_type: str  # "node" | "way"
    osm_id: int
    kind: str  # one of HAZARD_KINDS
    geometry_type: str  # "Point" | "LineString" | "Polygon"
    coordinates: list  # GeoJSON coordinate structure matching geometry_type
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    name: Optional[str] = None
    osm_timestamp: Optional[str] = None  # ISO8601, from Overpass `out meta`

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
            "geometry": {"type": self.geometry_type, "coordinates": self.coordinates},
            "properties": {
                "osm_type": self.osm_type,
                "osm_id": self.osm_id,
                "kind": self.kind,
                "name": self.name,
                "reg": REGISTER,
                "fresh": self.freshness,
            },
        }


# ── Store ────────────────────────────────────────────────────────────────


class TerrainHazardStore:
    """On-disk SQLite store for baked cliff/scree/bare_rock geometry.

    Mirrors `geo.map_cache.MapCache`'s connection idiom (WAL, short-lived
    connections, a lock around writers) — this file is written once per
    bake run and read many times per render, never the other way round.
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
                CREATE TABLE IF NOT EXISTS terrain_hazards (
                    id             TEXT PRIMARY KEY,
                    osm_type       TEXT NOT NULL,
                    osm_id         INTEGER NOT NULL,
                    kind           TEXT NOT NULL,
                    name           TEXT,
                    geometry_type  TEXT NOT NULL,
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
                "CREATE INDEX IF NOT EXISTS idx_terrain_hazards_bbox "
                "ON terrain_hazards (lat_min, lat_max, lon_min, lon_max)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_terrain_hazards_kind "
                "ON terrain_hazards (kind)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS terrain_hazards_meta (
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
            conn.execute("DELETE FROM terrain_hazards")
            conn.commit()

    def upsert_features(self, features: Iterable[TerrainHazardFeature]) -> int:
        """Insert-or-replace every feature. Returns the count written."""
        now = time.time()
        rows = [
            (
                f.id,
                f.osm_type,
                f.osm_id,
                f.kind,
                f.name,
                f.geometry_type,
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
                INSERT INTO terrain_hazards (
                    id, osm_type, osm_id, kind, name, geometry_type,
                    coordinates_json, osm_timestamp,
                    lat_min, lat_max, lon_min, lon_max, baked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    osm_type=excluded.osm_type,
                    osm_id=excluded.osm_id,
                    kind=excluded.kind,
                    name=excluded.name,
                    geometry_type=excluded.geometry_type,
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
                "INSERT INTO terrain_hazards_meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            conn.commit()

    def get_meta(self, key: str) -> Optional[str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM terrain_hazards_meta WHERE key = ?", (key,)
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
        kinds: Optional[Iterable[str]] = None,
        limit: int = 5000,
    ) -> list[dict]:
        """GeoJSON features whose bbox intersects the query bbox.

        Bbox-intersection test, not centroid containment — a cliff way that
        straddles the viewport edge must still render, not vanish because
        its bounding-box corner sits outside.
        """
        clauses = [
            "lat_min <= ?",
            "lat_max >= ?",
            "lon_min <= ?",
            "lon_max >= ?",
        ]
        params: list = [lat_max, lat_min, lon_max, lon_min]
        kind_list = [k for k in (kinds or ())] or None
        if kind_list:
            placeholders = ",".join("?" for _ in kind_list)
            clauses.append(f"kind IN ({placeholders})")
            params.extend(kind_list)
        params.append(max(1, min(limit, 20000)))

        sql = (
            "SELECT id, osm_type, osm_id, kind, name, geometry_type, "
            "coordinates_json, osm_timestamp "
            "FROM terrain_hazards WHERE " + " AND ".join(clauses) + " LIMIT ?"
        )
        with self._conn() as conn:
            cursor = conn.execute(sql, params)
            out: list[dict] = []
            for row in cursor:
                (
                    _id, osm_type, osm_id, kind, name, geometry_type,
                    coords_json, osm_timestamp,
                ) = row
                feature = TerrainHazardFeature(
                    osm_type=osm_type,
                    osm_id=osm_id,
                    kind=kind,
                    geometry_type=geometry_type,
                    coordinates=json.loads(coords_json),
                    lat_min=0.0, lat_max=0.0, lon_min=0.0, lon_max=0.0,
                    name=name,
                    osm_timestamp=osm_timestamp,
                )
                out.append(feature.to_geojson_feature())
        return out

    def count(self) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) FROM terrain_hazards").fetchone()
        return int(row[0]) if row else 0

    def count_by_kind(self) -> dict[str, int]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT kind, COUNT(*) FROM terrain_hazards GROUP BY kind"
            ).fetchall()
        return {kind: int(n) for kind, n in rows}


# ── Singleton ────────────────────────────────────────────────────────────

_store_lock = threading.Lock()
_store: Optional[TerrainHazardStore] = None


def _default_sqlite_path() -> Path:
    # Late import — `paths` may pull config which pulls geo at boot; keep lazy.
    from paths import resolve_data_dir

    return resolve_data_dir("workspace") / "terrain_hazards.sqlite"


def get_terrain_hazard_store() -> TerrainHazardStore:
    """Return (and lazily create) the process-wide store."""
    global _store
    if _store is not None:
        return _store
    with _store_lock:
        if _store is None:
            _store = TerrainHazardStore(_default_sqlite_path())
    return _store


def reset_terrain_hazard_store_for_tests(
    sqlite_path: Optional[Path] = None,
) -> TerrainHazardStore:
    """Replace the singleton — pytest helper, never call from runtime."""
    global _store
    with _store_lock:
        _store = TerrainHazardStore(sqlite_path or _default_sqlite_path())
    return _store
