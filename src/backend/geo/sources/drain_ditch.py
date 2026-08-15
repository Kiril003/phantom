"""Drain/ditch vehicle-obstacle layer — `waterway=drain` / `waterway=ditch`, baked from OSM.

Sourced from the PC-kitchen bake list built on `recovered/sphere-synthesis-v2.md`:
**107,864** `waterway=drain|ditch` ways measured live against Ukraine's Overpass
area on 2026-08-15 (`out count;`), close to the bake list's own 111,428
(ordinary OSM churn between surveys, not a discrepancy worth chasing). Neither
tag is a "hazard" in OSM's own vocabulary — it is a drainage channel — but a
metre-plus-deep cut running through open ground is a first-class vehicle
obstacle nobody maps as one, exactly the framing the task that produced this
layer used. Like `natural=cliff|scree|bare_rock`, the tag is a *direct,
ground-tagged* line — a mapper traced the channel — so this layer needs no
DEM, no live polling, and no owner decision to ship.

This is a `local_db`-sourced layer (see
`layer_registry/manifests/drain_ditch.yaml`): baked once by
`scripts/bake_drain_ditch.py` from a live Overpass query, then served from
this on-disk SQLite store with zero per-request upstream fetch — the same
shape `cliff_scree`/`power_towers` use.

Register/freshness follow `recovered/map-register-schema.md` §1: every
served feature carries `reg` and `fresh`, never omits them just because the
value is constant here. `reg` is always `"measured"` — the OSM tag *is* the
fact. `fresh` is a half-year bucket derived from the OSM element's own edit
timestamp, identical bucketing rule to `terrain_hazards.freshness_bucket`
and `power_towers.freshness_bucket` (duplicated, not imported — no shared
`geo.register` module exists yet for any of the three to import from).

Scope decision, stated rather than silently narrowed: `waterway=drain` and
`waterway=ditch` are always `way` elements in the sampled data (8/8 sampled
elements were ways with real geometry; no node-tagged drain/ditch was
observed, which matches OSM convention — a channel is a line, not a point).
Geometry is always modelled as `LineString` here — unlike `cliff`, a
drain/ditch closing into a loop was not observed in the sample and OSM's
own wiki does not document an area convention for either tag, so no
closed-way-to-Polygon special case is applied (the honest choice given
what was actually observed, not an assumption carried over from cliff/scree).
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

#: OSM `waterway=*` values this layer draws from. Order matters only for display.
DITCH_KINDS: tuple[str, ...] = ("drain", "ditch")

#: The OSM tag itself is the fact — see module docstring. Always `measured`
#: for this layer; still emitted per feature (map-register-schema.md §1).
REGISTER = "measured"

#: Bucket used when an element carries no OSM edit timestamp at all.
_PRE_2015_BUCKET = "pre2015"

_EARLIEST_BUCKET_YEAR = 2015


def freshness_bucket(dt: Optional[datetime]) -> str:
    """Half-year bucket per map-register-schema.md §1 (`fresh`).

    Identical rule to `terrain_hazards.freshness_bucket` /
    `power_towers.freshness_bucket`: deliberately coarser than the source
    timestamp, because nothing downstream ever branches finer than
    roughly-seasonal granularity. `None` or anything older than the
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
class DrainDitchFeature:
    """One baked OSM element — a drain or ditch way."""

    osm_id: int
    kind: str  # one of DITCH_KINDS
    coordinates: list  # [[lon, lat], ...] — always a LineString, see module docstring
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    name: Optional[str] = None
    width_m: Optional[str] = None  # raw `width=*` tag value, metres, where tagged
    osm_timestamp: Optional[str] = None  # ISO8601, from Overpass `out meta`

    osm_type: str = "way"

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
                "name": self.name,
                "width_m": self.width_m,
                "reg": REGISTER,
                "fresh": self.freshness,
            },
        }


# ── Store ────────────────────────────────────────────────────────────────


class DrainDitchStore:
    """On-disk SQLite store for baked drain/ditch geometry.

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
                CREATE TABLE IF NOT EXISTS drain_ditch (
                    id             TEXT PRIMARY KEY,
                    osm_id         INTEGER NOT NULL,
                    kind           TEXT NOT NULL,
                    name           TEXT,
                    width_m        TEXT,
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
                "CREATE INDEX IF NOT EXISTS idx_drain_ditch_bbox "
                "ON drain_ditch (lat_min, lat_max, lon_min, lon_max)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_drain_ditch_kind "
                "ON drain_ditch (kind)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS drain_ditch_meta (
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
            conn.execute("DELETE FROM drain_ditch")
            conn.commit()

    def upsert_features(self, features: Iterable[DrainDitchFeature]) -> int:
        """Insert-or-replace every feature. Returns the count written."""
        now = time.time()
        rows = [
            (
                f.id,
                f.osm_id,
                f.kind,
                f.name,
                f.width_m,
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
                INSERT INTO drain_ditch (
                    id, osm_id, kind, name, width_m, coordinates_json,
                    osm_timestamp, lat_min, lat_max, lon_min, lon_max, baked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    osm_id=excluded.osm_id,
                    kind=excluded.kind,
                    name=excluded.name,
                    width_m=excluded.width_m,
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
                "INSERT INTO drain_ditch_meta (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            conn.commit()

    def get_meta(self, key: str) -> Optional[str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM drain_ditch_meta WHERE key = ?", (key,)
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

        Bbox-intersection test, not centroid containment — a drain/ditch
        way that straddles the viewport edge must still render, not vanish
        because its bounding-box corner sits outside. Same rule
        `terrain_hazards.query_bbox` uses.
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
            "SELECT id, osm_id, kind, name, width_m, coordinates_json, osm_timestamp "
            "FROM drain_ditch WHERE " + " AND ".join(clauses) + " LIMIT ?"
        )
        with self._conn() as conn:
            cursor = conn.execute(sql, params)
            out: list[dict] = []
            for row in cursor:
                (
                    _id, osm_id, kind, name, width_m, coords_json, osm_timestamp,
                ) = row
                feature = DrainDitchFeature(
                    osm_id=osm_id,
                    kind=kind,
                    coordinates=json.loads(coords_json),
                    lat_min=0.0, lat_max=0.0, lon_min=0.0, lon_max=0.0,
                    name=name,
                    width_m=width_m,
                    osm_timestamp=osm_timestamp,
                )
                out.append(feature.to_geojson_feature())
        return out

    def count(self) -> int:
        with self._conn() as conn:
            row = conn.execute("SELECT COUNT(*) FROM drain_ditch").fetchone()
        return int(row[0]) if row else 0

    def count_by_kind(self) -> dict[str, int]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT kind, COUNT(*) FROM drain_ditch GROUP BY kind"
            ).fetchall()
        return {kind: int(n) for kind, n in rows}


# ── Singleton ────────────────────────────────────────────────────────────

_store_lock = threading.Lock()
_store: Optional[DrainDitchStore] = None


def _default_sqlite_path() -> Path:
    # Late import — `paths` may pull config which pulls geo at boot; keep lazy.
    from paths import resolve_data_dir

    return resolve_data_dir("workspace") / "drain_ditch.sqlite"


def get_drain_ditch_store() -> DrainDitchStore:
    """Return (and lazily create) the process-wide store."""
    global _store
    if _store is not None:
        return _store
    with _store_lock:
        if _store is None:
            _store = DrainDitchStore(_default_sqlite_path())
    return _store


def reset_drain_ditch_store_for_tests(
    sqlite_path: Optional[Path] = None,
) -> DrainDitchStore:
    """Replace the singleton — pytest helper, never call from runtime."""
    global _store
    with _store_lock:
        _store = DrainDitchStore(sqlite_path or _default_sqlite_path())
    return _store
