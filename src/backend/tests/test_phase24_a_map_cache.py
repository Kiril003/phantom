"""Phase 24-A — MapCache TTL + singleflight tests."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from geo.map_cache import MapCache


@pytest.fixture()
def cache(tmp_path: Path) -> MapCache:
    return MapCache(tmp_path / "map_cache.sqlite", blob_threshold=128)


def test_cache_set_then_get_round_trip(cache: MapCache):
    cache.set("frontline", "viewport-1", {"features": [1, 2, 3]}, ttl_s=60)
    entry = cache.get("frontline", "viewport-1")
    assert entry is not None
    assert entry.value == {"features": [1, 2, 3]}
    assert entry.layer_id == "frontline"


def test_cache_expired_entry_is_evicted(cache: MapCache):
    cache.set("frontline", "key", {"x": 1}, ttl_s=0.01)
    time.sleep(0.05)
    assert cache.get("frontline", "key") is None


def test_cache_overwrites_value_on_set(cache: MapCache):
    cache.set("layer", "k", {"v": 1}, ttl_s=10)
    cache.set("layer", "k", {"v": 2}, ttl_s=10)
    entry = cache.get("layer", "k")
    assert entry is not None and entry.value == {"v": 2}


def test_cache_blob_path_used_for_large_payloads(tmp_path: Path):
    cache = MapCache(tmp_path / "c.sqlite", blob_threshold=64)
    big = {"n": list(range(200))}
    cache.set("layer", "k", big, ttl_s=60)
    blob_dir = tmp_path / "c_blobs"
    assert blob_dir.exists()
    assert any(blob_dir.iterdir()), "expected at least one blob file"
    # Round-trip through the L2 path.
    cache._mem.clear()  # type: ignore[attr-defined]
    entry = cache.get("layer", "k")
    assert entry is not None and entry.value == big


def test_cache_delete_removes_entry(cache: MapCache):
    cache.set("a", "k", "v", ttl_s=60)
    assert cache.delete("a", "k") is True
    assert cache.get("a", "k") is None
    # Idempotent — second delete reports nothing existed.
    assert cache.delete("a", "k") is False


def test_cache_clear_per_layer(cache: MapCache):
    cache.set("a", "1", "x", ttl_s=60)
    cache.set("a", "2", "x", ttl_s=60)
    cache.set("b", "1", "x", ttl_s=60)
    cache.clear(layer_id="a")
    assert cache.get("a", "1") is None
    assert cache.get("a", "2") is None
    assert cache.get("b", "1") is not None


def test_cache_stats_count_hits_and_misses(cache: MapCache):
    cache.set("a", "k", 1, ttl_s=60)
    cache.get("a", "k")
    cache.get("a", "missing")
    stats = cache.stats()
    assert stats["hits"] >= 1
    assert stats["misses"] >= 1
    assert stats["disk_entries"] >= 1


def test_cache_purge_expired_drops_only_stale_rows(cache: MapCache):
    cache.set("a", "fresh", 1, ttl_s=60)
    cache.set("a", "stale", 1, ttl_s=0.01)
    time.sleep(0.05)
    removed = cache.purge_expired()
    assert removed >= 1
    assert cache.get("a", "fresh") is not None
    assert cache.get("a", "stale") is None


@pytest.mark.asyncio
async def test_get_or_fetch_singleflight_dedupes_concurrent_requests(cache: MapCache):
    counter = {"calls": 0}

    async def fetcher() -> dict:
        counter["calls"] += 1
        # Short await so the concurrent callers actually overlap.
        await asyncio.sleep(0.05)
        return {"value": counter["calls"]}

    a, b, c = await asyncio.gather(
        cache.get_or_fetch("layer", "k", fetcher, ttl_s=60),
        cache.get_or_fetch("layer", "k", fetcher, ttl_s=60),
        cache.get_or_fetch("layer", "k", fetcher, ttl_s=60),
    )
    assert counter["calls"] == 1
    assert a == b == c == {"value": 1}


@pytest.mark.asyncio
async def test_get_or_fetch_returns_cached_value_on_hit(cache: MapCache):
    cache.set("layer", "k", {"cached": True}, ttl_s=60)

    async def fetcher() -> dict:
        raise AssertionError("fetcher must not run on a cache hit")

    out = await cache.get_or_fetch("layer", "k", fetcher, ttl_s=60)
    assert out == {"cached": True}


@pytest.mark.asyncio
async def test_get_or_fetch_does_not_cache_failures(cache: MapCache):
    async def fetcher() -> dict:
        raise RuntimeError("upstream offline")

    with pytest.raises(RuntimeError):
        await cache.get_or_fetch("layer", "k", fetcher, ttl_s=60)
    # Subsequent call must run again — the failure must not have been cached.
    counter = {"calls": 0}

    async def good() -> dict:
        counter["calls"] += 1
        return {"ok": True}

    out = await cache.get_or_fetch("layer", "k", good, ttl_s=60)
    assert counter["calls"] == 1
    assert out == {"ok": True}
