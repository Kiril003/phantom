"""
Phase 9.4c.1 hotfix — regression guards for the TTLCache timestamp-replay bug.

The 9.4c C3 audit swapped the ipapi adapter's cache to ``cachetools.TTLCache``
and made the mistake of caching the full ``LocationEstimate`` Pydantic object.
That object carries its own ``timestamp`` field, frozen at construction, so
every call within the 10-min TTL returned an object with an identical
timestamp. The resolver's sanity check treats ``dt_s <= 0`` as a clock-skew
replay → every cached re-read rejected → map stuck on "NO LOCATION".

These tests lock in the hotfix:
  * adapter / source caches must mint a fresh timestamp per call
  * resolver must treat the same-coord same-source sequence as a valid
    no-op (accept without double-appending history)

Plus a resolver-level integration guard — run N consecutive resolves against
a locked-in ipapi mock and assert acceptance rate ~100 %.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

import httpx
import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-094c1-hotfix")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from agent.localization.adapters.ipapi import IpApiLocator
from agent.localization.adapters.rate_limiter import DailyRateLimiter
from agent.localization.resolver import LocalizationResolver
from agent.localization.sources.browser_geolocation import (
    BrowserGeolocationSource,
    clear_browser_estimate,
    submit_browser_estimate,
)
from agent.localization.sources.ip_estimate import IpEstimateSource
from agent.localization.sources.user_stated import (
    UserStatedSource,
    clear_user_stated,
    set_user_stated,
)


# ═════════════════════════════════════════════════════════════════════════════
# Shared httpx mock
# ═════════════════════════════════════════════════════════════════════════════


class _MockHttpx:
    """Minimal httpx.AsyncClient replacement."""

    def __init__(self, payload: dict | None = None) -> None:
        self._payload = payload or {
            "latitude": 49.8382,
            "longitude": 18.1564,
            "city": "Ostrava",
        }
        self.calls = 0

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, url):
        self.calls += 1
        req = httpx.Request("GET", url)
        return httpx.Response(200, json=self._payload, request=req)


# ═════════════════════════════════════════════════════════════════════════════
# Adapter cache hit must return FRESH timestamps
# ═════════════════════════════════════════════════════════════════════════════


class TestIpApiCacheTimestampFreshness:
    @pytest.mark.asyncio
    async def test_cached_call_returns_fresh_timestamp(self, monkeypatch):
        """Two consecutive locate_current_ip() calls within TTL must return
        estimates with strictly increasing timestamps."""
        mock = _MockHttpx()
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(10))
        first = await loc.locate_current_ip()
        # Sleep a tiny bit so timestamps are measurably different even on
        # fast machines where successive now() calls collide.
        await asyncio.sleep(0.01)
        second = await loc.locate_current_ip()

        assert first is not None and second is not None
        # Coordinates must match (came from the same cache entry).
        assert first.lat == second.lat
        assert first.lon == second.lon
        # Only one network call — cache served the second.
        assert mock.calls == 1
        # Timestamps must be strictly monotonic.
        assert second.timestamp > first.timestamp
        # ...and both must be fresh (within the last minute).
        now = datetime.now(tz=timezone.utc)
        assert (now - first.timestamp).total_seconds() < 60
        assert (now - second.timestamp).total_seconds() < 60


# ═════════════════════════════════════════════════════════════════════════════
# Source caches must also refresh timestamp
# ═════════════════════════════════════════════════════════════════════════════


class TestBrowserSourceTimestampFreshness:
    def setup_method(self):
        clear_browser_estimate()

    @pytest.mark.asyncio
    async def test_repeated_get_returns_fresh_timestamp(self):
        """The browser source stores a single submission in-module. Two reads
        within the freshness window must yield fresh timestamps so the
        resolver does not see dt_s == 0."""
        ts_old = datetime.now(tz=timezone.utc) - timedelta(seconds=10)
        submit_browser_estimate(lat=49.8382, lon=18.1564, accuracy_m=15.0, timestamp=ts_old)
        src = BrowserGeolocationSource()

        first = await src.get_position()
        await asyncio.sleep(0.01)
        second = await src.get_position()

        assert first is not None and second is not None
        assert first.source == "browser_geolocation"
        assert first.lat == second.lat and first.lon == second.lon
        # The cached submission had ts_old but the minted estimate must be
        # current.
        assert first.timestamp > ts_old
        # And the second read is fresher than the first.
        assert second.timestamp > first.timestamp


class TestUserStatedSourceTimestampFreshness:
    def setup_method(self):
        clear_user_stated()

    @pytest.mark.asyncio
    async def test_repeated_get_returns_fresh_timestamp(self):
        ts_old = datetime.now(tz=timezone.utc) - timedelta(minutes=5)
        set_user_stated(lat=46.48, lon=30.73, timestamp=ts_old)
        src = UserStatedSource()

        first = await src.get_position()
        await asyncio.sleep(0.01)
        second = await src.get_position()

        assert first is not None and second is not None
        assert first.source == "user_stated"
        assert first.lat == second.lat and first.lon == second.lon
        assert first.timestamp > ts_old
        assert second.timestamp > first.timestamp


# ═════════════════════════════════════════════════════════════════════════════
# Resolver-level regression — locked mock, 200 ticks, acceptance ≥ 99 %.
# ═════════════════════════════════════════════════════════════════════════════


class TestResolverIdentityNoOp:
    """B.2 — resolver must treat identical consecutive fixes as no-op,
    not replay, even when timestamps collide. Also: a genuine
    backwards-clock replay with *different* coords must still be rejected."""

    @pytest.mark.asyncio
    async def test_identical_fix_is_accepted_without_growing_history(self):
        from agent.localization.base import LocationEstimate, LocalizationSource

        shared_ts = datetime.now(tz=timezone.utc)

        class _Stub(LocalizationSource):
            name = "stub"
            trust_level = 50

            def is_available(self) -> bool:
                return True

            async def get_position(self):
                return LocationEstimate(
                    lat=49.8382,
                    lon=18.1564,
                    source="stub",
                    confidence=0.7,
                    accuracy_m=25.0,
                    timestamp=shared_ts,  # frozen; mimics pre-hotfix bug shape
                    trust_level=50,
                )

        r = LocalizationResolver([_Stub()])
        # Seed history with the first resolve.
        first = await r.resolve()
        assert first is not None
        assert len(r.recent_history(50)) == 1

        # Ten more resolves at the same (source, lat, lon) — all must
        # succeed (not treated as replay) and history must NOT grow.
        for _ in range(10):
            result = await r.resolve()
            assert result is not None
            assert result.source == "stub"
        assert len(r.recent_history(50)) == 1, (
            "identity-duplicate estimates should not accumulate in history"
        )

    @pytest.mark.asyncio
    async def test_backwards_clock_with_different_coords_still_rejected(self):
        """Genuine clock-skew + coord mismatch must still be rejected."""
        from agent.localization.base import LocationEstimate, LocalizationSource

        t0 = datetime.now(tz=timezone.utc)

        class _First(LocalizationSource):
            name = "first"
            trust_level = 95
            def is_available(self) -> bool: return True
            async def get_position(self):
                return LocationEstimate(
                    lat=50.0, lon=30.0, source="first",
                    confidence=0.9, accuracy_m=10.0, timestamp=t0, trust_level=95,
                )

        class _BackwardsReplay(LocalizationSource):
            name = "replay"
            trust_level = 95
            def is_available(self) -> bool: return True
            async def get_position(self):
                return LocationEstimate(
                    lat=50.5, lon=30.0, source="replay",  # DIFFERENT coords
                    confidence=0.9, accuracy_m=10.0,
                    timestamp=t0 - timedelta(seconds=5),  # backwards
                    trust_level=95,
                )

        r = LocalizationResolver([_First()])
        assert await r.resolve() is not None

        r.remove_source("first")
        r.add_source(_BackwardsReplay())
        assert await r.resolve() is None, (
            "clock-skew replay with different coordinates must still reject"
        )


class TestResolverReplayLoopRegression:
    @pytest.mark.asyncio
    async def test_ipapi_repeat_resolutions_do_not_trigger_replay_rejection(self, monkeypatch):
        """With the fixed adapter + source, 200 back-to-back resolves against
        a locked ipapi mock must accept (near-)every estimate rather than
        collapse into the 500 ms rejection loop observed pre-hotfix."""
        mock = _MockHttpx()
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(10))
        src = IpEstimateSource(locator=loc)
        resolver = LocalizationResolver([src])

        accepts = 0
        rejects = 0
        for _ in range(200):
            result = await resolver.resolve()
            if result is not None:
                accepts += 1
            else:
                rejects += 1
            # Small pause to mimic a realistic tick cadence without
            # dragging CI time out.
            await asyncio.sleep(0.001)

        # Only one network call (cache served the other 199).
        assert mock.calls == 1
        # ≥ 99 % acceptance. Pre-hotfix this collapsed to ~1 / 1200
        # (only when TTL naturally expired), post-hotfix we expect 100 %.
        assert accepts >= 198, f"accepts={accepts} rejects={rejects}"
