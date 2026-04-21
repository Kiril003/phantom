"""
Phase 9.4c — audit C1/C2/C3 regression tests.

The external-service adapters (Nominatim, Overpass, IpApi) now hold their
hot caches in `cachetools.TTLCache` instead of unbounded dicts. These tests
verify the maxsize bound evicts oldest entries so long-running sessions do
not accumulate stale geocodes indefinitely.
"""
from __future__ import annotations

from agent.localization.adapters.ipapi import IpApiLocator, _CACHE_MAX as IPAPI_MAX
from agent.localization.adapters.nominatim import (
    NominatimGeocoder,
    _FWD_CACHE_MAX,
    _REV_CACHE_MAX,
)
from agent.localization.adapters.overpass import OverpassQuery, _CACHE_MAX as OVERPASS_MAX


def test_nominatim_forward_cache_bound() -> None:
    """Forward cache drops oldest entry past maxsize."""
    g = NominatimGeocoder()
    for i in range(_FWD_CACHE_MAX + 5):
        g._fwd_cache[f"q{i}"] = []
    assert len(g._fwd_cache) == _FWD_CACHE_MAX
    # The earliest inserts should be gone.
    assert "q0" not in g._fwd_cache
    assert f"q{_FWD_CACHE_MAX + 4}" in g._fwd_cache


def test_nominatim_reverse_cache_bound() -> None:
    g = NominatimGeocoder()
    for i in range(_REV_CACHE_MAX + 5):
        g._rev_cache[(i, i)] = None
    assert len(g._rev_cache) == _REV_CACHE_MAX
    assert (0, 0) not in g._rev_cache


def test_overpass_cache_bound() -> None:
    q = OverpassQuery()
    for i in range(OVERPASS_MAX + 5):
        q._cache[("k", i)] = []
    assert len(q._cache) == OVERPASS_MAX
    assert ("k", 0) not in q._cache


def test_ipapi_cache_bound() -> None:
    loc = IpApiLocator()
    # The IpApi cache is single-logical-slot (``_CURRENT_KEY``), but the
    # underlying TTLCache still enforces ``maxsize`` so synthetic probes
    # can't grow it without bound.
    from agent.localization.adapters.ipapi import _CURRENT_KEY
    # Insert N unique keys and verify we never exceed maxsize.
    loc._cache["probe_a"] = None  # type: ignore[assignment]
    loc._cache["probe_b"] = None  # type: ignore[assignment]
    loc._cache[_CURRENT_KEY] = None  # type: ignore[assignment]
    # Fourth distinct key evicts oldest.
    loc._cache["probe_c"] = None  # type: ignore[assignment]
    loc._cache["probe_d"] = None  # type: ignore[assignment]
    assert len(loc._cache) <= IPAPI_MAX
