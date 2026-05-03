"""MapCache — multi-tier TTL cache for OmniMap data sources (Phase 24-A).

Most map adapters fetch the same payload from the same upstream over and
over (alarms.in.ua every 30 s, frontline GeoJSON every minute, OSM
Overpass per viewport). Without a cache we burn rate-limit budget on
duplicate work and the UI stutters when the network blinks. With a
cache, the renderer reaches in via :meth:`MapCache.get_or_fetch` and
either gets the live payload or a still-fresh copy.

Three tiers, narrowest first:

* **L1 — process memory.** Fast `dict` keyed by ``(layer_id, key)`` with
  per-entry expiry. Cleared on process restart.
* **L2 — SQLite on disk.** Single file under
  ``resolve_data_dir("workspace") / "map_cache.sqlite"``. Survives
  restarts, allows cold-start to skip an upstream request when the data
  is still fresh, and gives operators a single file to wipe via
  ``DELETE /map/cache``.
* **L3 — opt-in raw blob dir.** Larger payloads (≥ 64 KiB by default)
  are stored as files in a sibling ``map_cache_blobs/`` directory and
  referenced by sha256 from L2. Keeps the SQLite file lean and lets
  operators inspect raw GeoJSON with a text editor.

The TTL travels with the layer manifest (`source.ttl_s`); callers may
pass a per-call override (``ttl_override`` parameter) when a verb needs
fresher data than the manifest default.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterator, Optional

logger = logging.getLogger(__name__)


# ── Defaults ──────────────────────────────────────────────────────────────


# Anything smaller than this stays inline in SQLite (TEXT column).
# Larger payloads spill to a per-key blob file. The 64 KiB threshold
# matches the default page size for SQLite-on-tmpfs which keeps inline
# entries efficient and big GeoJSON dumps off the hot path.
_DEFAULT_BLOB_THRESHOLD = 64 * 1024

# Sentinel returned by the inner getter when a fetch fails — distinct
# from `None` so we can cache misses too if the adapter wants to.
_MISS = object()


@dataclass(frozen=True)
class CacheEntry:
    """One materialised cache hit."""

    layer_id: str
    key: str
    value: Any
    expires_at: float
    written_at: float
    bytes_size: int


# ── Cache ─────────────────────────────────────────────────────────────────


class MapCache:
    """Three-tier TTL cache shared across map sources."""

    def __init__(
        self,
        sqlite_path: Path,
        *,
        blob_threshold: int = _DEFAULT_BLOB_THRESHOLD,
        max_memory_entries: int = 2048,
    ) -> None:
        self._sqlite_path = Path(sqlite_path)
        self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._blob_dir = self._sqlite_path.parent / (self._sqlite_path.stem + "_blobs")
        self._blob_dir.mkdir(parents=True, exist_ok=True)
        self._blob_threshold = max(0, blob_threshold)
        self._max_memory_entries = max_memory_entries

        # L1
        self._mem: dict[tuple[str, str], CacheEntry] = {}
        self._lock = threading.RLock()

        # In-flight singleflight map so concurrent fetches for the same
        # key share one upstream call.
        self._inflight: dict[tuple[str, str], asyncio.Future[Any]] = {}

        # Metrics
        self._hits = 0
        self._misses = 0
        self._writes = 0
        self._evictions = 0

        self._init_schema()

    # ── Schema ──────────────────────────────────────────────────────

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
        with self._conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS map_cache (
                    layer_id    TEXT NOT NULL,
                    key         TEXT NOT NULL,
                    value_inline TEXT,
                    blob_sha256 TEXT,
                    bytes_size  INTEGER NOT NULL,
                    expires_at  REAL NOT NULL,
                    written_at  REAL NOT NULL,
                    PRIMARY KEY (layer_id, key)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_cache_expires ON map_cache (expires_at)"
            )
            conn.commit()

    # ── Read path ───────────────────────────────────────────────────

    def _decode(self, raw: str | None) -> Any:
        if raw is None or raw == "":
            return None
        return json.loads(raw)

    def _read_blob(self, sha: str) -> Any:
        path = self._blob_dir / f"{sha}.json"
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def get(self, layer_id: str, key: str) -> Optional[CacheEntry]:
        """Return a fresh entry or `None`. Expired entries are evicted."""
        now = time.time()
        cache_key = (layer_id, key)
        with self._lock:
            entry = self._mem.get(cache_key)
            if entry is not None:
                if entry.expires_at > now:
                    self._hits += 1
                    return entry
                # Expired — drop.
                self._mem.pop(cache_key, None)

        # Cold path — read SQLite.
        try:
            with self._conn() as conn:
                row = conn.execute(
                    """
                    SELECT value_inline, blob_sha256, bytes_size, expires_at, written_at
                    FROM map_cache
                    WHERE layer_id = ? AND key = ?
                    """,
                    (layer_id, key),
                ).fetchone()
        except sqlite3.Error as exc:
            logger.warning("MapCache sqlite read failed: %s", exc)
            with self._lock:
                self._misses += 1
            return None
        if row is None:
            with self._lock:
                self._misses += 1
            return None
        value_inline, blob_sha, bytes_size, expires_at, written_at = row
        if expires_at <= now:
            self._delete_disk(layer_id, key, blob_sha)
            with self._lock:
                self._misses += 1
            return None
        if blob_sha:
            value = self._read_blob(blob_sha)
        else:
            value = self._decode(value_inline)
        entry = CacheEntry(
            layer_id=layer_id,
            key=key,
            value=value,
            expires_at=expires_at,
            written_at=written_at,
            bytes_size=int(bytes_size),
        )
        with self._lock:
            self._promote_l1(entry)
            self._hits += 1
        return entry

    def _promote_l1(self, entry: CacheEntry) -> None:
        # Caller already holds the lock.
        self._mem[(entry.layer_id, entry.key)] = entry
        if len(self._mem) > self._max_memory_entries:
            # Evict the oldest 10% — cheap LRU-ish behaviour without
            # dragging in an external dep just for this.
            drop = max(1, len(self._mem) // 10)
            for stale_key in list(self._mem.keys())[:drop]:
                self._mem.pop(stale_key, None)
                self._evictions += 1

    # ── Write path ──────────────────────────────────────────────────

    def set(
        self,
        layer_id: str,
        key: str,
        value: Any,
        ttl_s: float,
    ) -> CacheEntry:
        """Persist a value with the given TTL across L1/L2/(L3 if big)."""
        ttl_s = max(0.0, float(ttl_s))
        now = time.time()
        expires_at = now + ttl_s if ttl_s > 0 else now
        encoded = json.dumps(value, ensure_ascii=False, default=_json_fallback)
        bytes_size = len(encoded.encode("utf-8"))

        blob_sha: Optional[str] = None
        value_inline: Optional[str] = encoded
        if bytes_size > self._blob_threshold:
            blob_sha = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
            blob_path = self._blob_dir / f"{blob_sha}.json"
            if not blob_path.exists():
                blob_path.write_text(encoded, encoding="utf-8")
            value_inline = None

        try:
            with self._conn() as conn:
                conn.execute(
                    """
                    INSERT INTO map_cache (layer_id, key, value_inline, blob_sha256,
                                           bytes_size, expires_at, written_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(layer_id, key) DO UPDATE SET
                        value_inline = excluded.value_inline,
                        blob_sha256  = excluded.blob_sha256,
                        bytes_size   = excluded.bytes_size,
                        expires_at   = excluded.expires_at,
                        written_at   = excluded.written_at
                    """,
                    (layer_id, key, value_inline, blob_sha, bytes_size, expires_at, now),
                )
                conn.commit()
        except sqlite3.Error as exc:
            logger.warning("MapCache sqlite write failed: %s", exc)

        entry = CacheEntry(
            layer_id=layer_id,
            key=key,
            value=value,
            expires_at=expires_at,
            written_at=now,
            bytes_size=bytes_size,
        )
        with self._lock:
            self._promote_l1(entry)
            self._writes += 1
        return entry

    def _delete_disk(self, layer_id: str, key: str, blob_sha: str | None) -> None:
        try:
            with self._conn() as conn:
                conn.execute(
                    "DELETE FROM map_cache WHERE layer_id = ? AND key = ?",
                    (layer_id, key),
                )
                conn.commit()
        except sqlite3.Error:
            pass
        if blob_sha:
            blob_path = self._blob_dir / f"{blob_sha}.json"
            with self._lock:
                still_referenced = any(
                    e for e in self._mem.values()
                    if isinstance(e.value, dict) and e.bytes_size > self._blob_threshold
                )
            if not still_referenced and blob_path.exists():
                try:
                    blob_path.unlink()
                except OSError:
                    pass

    def delete(self, layer_id: str, key: str) -> bool:
        cache_key = (layer_id, key)
        with self._lock:
            existed_l1 = self._mem.pop(cache_key, None) is not None
        try:
            with self._conn() as conn:
                cur = conn.execute(
                    "SELECT blob_sha256 FROM map_cache WHERE layer_id = ? AND key = ?",
                    (layer_id, key),
                )
                row = cur.fetchone()
                conn.execute(
                    "DELETE FROM map_cache WHERE layer_id = ? AND key = ?",
                    (layer_id, key),
                )
                conn.commit()
        except sqlite3.Error:
            return existed_l1
        if row and row[0]:
            blob_path = self._blob_dir / f"{row[0]}.json"
            if blob_path.exists():
                try:
                    blob_path.unlink()
                except OSError:
                    pass
        return existed_l1 or row is not None

    def clear(self, layer_id: str | None = None) -> int:
        """Drop entries (optionally for a single layer). Returns count."""
        with self._lock:
            if layer_id is None:
                count = len(self._mem)
                self._mem.clear()
            else:
                stale = [k for k in self._mem if k[0] == layer_id]
                count = len(stale)
                for k in stale:
                    self._mem.pop(k, None)
        try:
            with self._conn() as conn:
                if layer_id is None:
                    cur = conn.execute("DELETE FROM map_cache")
                else:
                    cur = conn.execute("DELETE FROM map_cache WHERE layer_id = ?", (layer_id,))
                conn.commit()
                count = max(count, cur.rowcount or 0)
        except sqlite3.Error as exc:
            logger.warning("MapCache clear failed: %s", exc)
        return count

    # ── Singleflight + TTL fetcher ──────────────────────────────────

    async def get_or_fetch(
        self,
        layer_id: str,
        key: str,
        fetcher: Callable[[], Awaitable[Any]],
        ttl_s: float,
    ) -> Any:
        """Return a cached value or call `fetcher()` exactly once.

        Concurrent callers for the same `(layer_id, key)` share a single
        in-flight future; a fetch failure is *not* cached — the caller
        sees the exception and may retry.
        """
        cached = self.get(layer_id, key)
        if cached is not None:
            return cached.value

        loop = asyncio.get_running_loop()
        cache_key = (layer_id, key)
        with self._lock:
            future = self._inflight.get(cache_key)
            if future is None:
                future = loop.create_future()
                self._inflight[cache_key] = future
                owner = True
            else:
                owner = False

        if owner:
            try:
                value = await fetcher()
            except Exception as exc:
                with self._lock:
                    self._inflight.pop(cache_key, None)
                if not future.done():
                    future.set_exception(exc)
                raise
            self.set(layer_id, key, value, ttl_s=ttl_s)
            with self._lock:
                self._inflight.pop(cache_key, None)
            if not future.done():
                future.set_result(value)
            return value
        return await future

    # ── Maintenance ─────────────────────────────────────────────────

    def purge_expired(self) -> int:
        """Drop expired rows; returns number removed."""
        now = time.time()
        with self._lock:
            stale_l1 = [k for k, e in self._mem.items() if e.expires_at <= now]
            for k in stale_l1:
                self._mem.pop(k, None)
        removed = len(stale_l1)
        try:
            with self._conn() as conn:
                cur = conn.execute("DELETE FROM map_cache WHERE expires_at <= ?", (now,))
                conn.commit()
                removed = max(removed, cur.rowcount or 0)
        except sqlite3.Error:
            pass
        return removed

    def stats(self) -> dict[str, Any]:
        with self._lock:
            mem_entries = len(self._mem)
            hits = self._hits
            misses = self._misses
            writes = self._writes
            evictions = self._evictions
        try:
            with self._conn() as conn:
                disk_count, disk_bytes = conn.execute(
                    "SELECT COUNT(*), COALESCE(SUM(bytes_size), 0) FROM map_cache"
                ).fetchone()
        except sqlite3.Error:
            disk_count, disk_bytes = 0, 0
        return {
            "memory_entries": mem_entries,
            "disk_entries": int(disk_count),
            "disk_bytes": int(disk_bytes),
            "hits": hits,
            "misses": misses,
            "writes": writes,
            "evictions": evictions,
            "sqlite_path": str(self._sqlite_path),
        }


# ── Helpers ───────────────────────────────────────────────────────────────


def _json_fallback(obj: Any) -> Any:
    # Pydantic models, dataclasses, datetimes — ask for their dict form.
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    raise TypeError(f"object of type {type(obj).__name__} is not JSON-serialisable")


# ── Singleton ─────────────────────────────────────────────────────────────


_cache_lock = threading.Lock()
_cache: Optional[MapCache] = None


def _default_sqlite_path() -> Path:
    # Late import — `paths` may pull config which pulls geo at boot if
    # we top-import it. Keep this lazy.
    from paths import resolve_data_dir
    return resolve_data_dir("workspace") / "map_cache.sqlite"


def get_map_cache() -> MapCache:
    """Return (and lazily create) the process-wide MapCache."""
    global _cache
    if _cache is not None:
        return _cache
    with _cache_lock:
        if _cache is None:
            _cache = MapCache(_default_sqlite_path())
    return _cache


def reset_map_cache_for_tests(sqlite_path: Path | None = None) -> MapCache:
    """Replace the singleton — pytest helper, never call from runtime."""
    global _cache
    with _cache_lock:
        _cache = MapCache(sqlite_path or _default_sqlite_path())
    return _cache
