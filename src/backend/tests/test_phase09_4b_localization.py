"""
Phase 9.4b — localization infrastructure tests.

Covers:
  * LocalizationResolver trust-order and sanity rejection
  * IpApiLocator caching + rate limiting + error handling
  * BrowserGeolocationSource freshness
  * UserStatedSource TTL
  * GpsHardwareSource reflects ContextEngine fix state
  * ContextEngine snapshot carries source/confidence/accuracy_m
  * wire_default_sources idempotency
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import httpx
import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase094b-loc")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

from agent.localization.base import (
    LocationEstimate,
    LocalizationSource,
    haversine_km,
)
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
from agent.localization.adapters.ipapi import IpApiLocator
from agent.localization.adapters.rate_limiter import DailyRateLimiter


# ═════════════════════════════════════════════════════════════════════════════
# Helpers
# ═════════════════════════════════════════════════════════════════════════════


class _StubSource(LocalizationSource):
    def __init__(self, name: str, trust: int, estimate: LocationEstimate | None,
                 available: bool = True, raise_exc: Exception | None = None) -> None:
        self.name = name
        self.trust_level = trust
        self._estimate = estimate
        self._available = available
        self._raise = raise_exc
        self.calls = 0

    def is_available(self) -> bool:
        return self._available

    async def get_position(self):
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        return self._estimate


def _est(lat: float, lon: float, source: str = "stub", trust: int = 50,
         confidence: float = 0.8, accuracy_m: float | None = 25.0,
         timestamp: datetime | None = None) -> LocationEstimate:
    return LocationEstimate(
        lat=lat, lon=lon, source=source, confidence=confidence,
        accuracy_m=accuracy_m,
        timestamp=timestamp or datetime.now(tz=timezone.utc),
        trust_level=trust,
    )


# ═════════════════════════════════════════════════════════════════════════════
# Resolver — trust order, sanity, fallthrough
# ═════════════════════════════════════════════════════════════════════════════


class TestLocalizationResolver:
    @pytest.mark.asyncio
    async def test_returns_highest_trust_available_source(self):
        low = _StubSource("low", 30, _est(1.0, 1.0, "low", 30))
        high = _StubSource("high", 95, _est(2.0, 2.0, "high", 95))
        mid = _StubSource("mid", 70, _est(3.0, 3.0, "mid", 70))
        r = LocalizationResolver([low, high, mid])
        result = await r.resolve()
        assert result is not None
        assert result.source == "high"
        # Higher trust tried first, mid/low never queried.
        assert high.calls == 1
        assert mid.calls == 0
        assert low.calls == 0

    @pytest.mark.asyncio
    async def test_falls_through_when_high_trust_unavailable(self):
        high = _StubSource("high", 95, None, available=False)
        mid = _StubSource("mid", 70, _est(3.0, 3.0, "mid", 70))
        r = LocalizationResolver([high, mid])
        result = await r.resolve()
        assert result is not None
        assert result.source == "mid"
        assert high.calls == 0  # is_available() short-circuited
        assert mid.calls == 1

    @pytest.mark.asyncio
    async def test_falls_through_when_source_returns_none(self):
        a = _StubSource("a", 95, None)
        b = _StubSource("b", 70, _est(4.0, 4.0, "b", 70))
        r = LocalizationResolver([a, b])
        result = await r.resolve()
        assert result is not None
        assert result.source == "b"
        assert a.calls == 1  # called but returned None
        assert b.calls == 1

    @pytest.mark.asyncio
    async def test_sanity_rejects_implausible_jump(self):
        # First fix: equator. Second fix 1 s later: 10 000 km away → reject.
        t0 = datetime.now(tz=timezone.utc)
        first = _StubSource("first", 95, _est(0.0, 0.0, "first", 95, timestamp=t0))
        r = LocalizationResolver([first])
        await r.resolve()  # seeds history

        # Now swap the source to emit an impossible jump 1 s later.
        t1 = t0 + timedelta(seconds=1)
        r.remove_source("first")
        bad = _StubSource("bad", 95, _est(50.0, 50.0, "bad", 95, timestamp=t1))
        r.add_source(bad)
        result = await r.resolve()
        assert result is None  # rejected
        assert bad.calls == 1

    @pytest.mark.asyncio
    async def test_higher_trust_supersedes_low_trust_prior_despite_jump(self):
        # Regression: at cold start the IP source (trust 30, city-centroid
        # ~50 km off) resolves first and seeds history. The accurate browser
        # fix (trust 70) then arrives within the 5 s window, sitting far from
        # the centroid. It must NOT be rejected as an implausible jump — a
        # more trustworthy source is authoritative and re-baselines. Before
        # the fix, the map kept showing the coarse IP centroid.
        t0 = datetime.now(tz=timezone.utc)
        ip = _StubSource("ip_estimate", 30, _est(50.0, 30.0, "ip_estimate", 30, timestamp=t0))
        r = LocalizationResolver([ip])
        seeded = await r.resolve()
        assert seeded is not None and seeded.source == "ip_estimate"

        # Browser fix 1 s later, ~40 km away (well past the ~1.5 km the
        # velocity guard would allow inside the window) but higher trust.
        t1 = t0 + timedelta(seconds=1)
        browser = _StubSource(
            "browser_geolocation", 70,
            _est(50.36, 30.0, "browser_geolocation", 70, timestamp=t1),
        )
        r.add_source(browser)
        result = await r.resolve()
        assert result is not None
        assert result.source == "browser_geolocation"
        # And history re-baselined to the browser fix, so the next same-tier
        # reading is judged against it — not the stale centroid.
        assert r.last_estimate() is not None
        assert r.last_estimate().source == "browser_geolocation"

    @pytest.mark.asyncio
    async def test_lower_trust_fallback_still_policed_for_velocity(self):
        # The supersede rule is one-directional: a *lower*-trust candidate
        # after a higher-trust fix is still velocity-checked, so a bogus IP
        # centroid can't teleport the operator when the browser fix drops out.
        t0 = datetime.now(tz=timezone.utc)
        browser = _StubSource(
            "browser_geolocation", 70,
            _est(50.0, 30.0, "browser_geolocation", 70, timestamp=t0),
        )
        r = LocalizationResolver([browser])
        await r.resolve()

        t1 = t0 + timedelta(seconds=1)
        r.remove_source("browser_geolocation")
        ip = _StubSource("ip_estimate", 30, _est(50.36, 30.0, "ip_estimate", 30, timestamp=t1))
        r.add_source(ip)
        assert await r.resolve() is None  # 40 km in 1 s from a lower-trust source → rejected

    @pytest.mark.asyncio
    async def test_sanity_allows_reasonable_motion(self):
        t0 = datetime.now(tz=timezone.utc)
        first = _StubSource("first", 95, _est(50.0, 30.0, "first", 95, timestamp=t0))
        r = LocalizationResolver([first])
        await r.resolve()

        # ~50 m away 1 s later — 180 km/h, permitted.
        t1 = t0 + timedelta(seconds=1)
        r.remove_source("first")
        ok = _StubSource("ok", 95, _est(50.0005, 30.0, "ok", 95, timestamp=t1))
        r.add_source(ok)
        result = await r.resolve()
        assert result is not None

    @pytest.mark.asyncio
    async def test_sanity_allows_long_gap_regardless_of_distance(self):
        # Even a continental jump is plausible across a 10-min gap.
        t0 = datetime.now(tz=timezone.utc)
        first = _StubSource("first", 95, _est(50.0, 30.0, "first", 95, timestamp=t0))
        r = LocalizationResolver([first])
        await r.resolve()

        t1 = t0 + timedelta(minutes=10)
        r.remove_source("first")
        jump = _StubSource("jump", 95, _est(40.0, -73.0, "jump", 95, timestamp=t1))
        r.add_source(jump)
        result = await r.resolve()
        assert result is not None
        assert result.source == "jump"

    @pytest.mark.asyncio
    async def test_sanity_rejects_backwards_timestamp(self):
        t0 = datetime.now(tz=timezone.utc)
        first = _StubSource("first", 95, _est(50.0, 30.0, "first", 95, timestamp=t0))
        r = LocalizationResolver([first])
        await r.resolve()

        # Replay / clock skew: same time as last accepted → reject.
        r.remove_source("first")
        replay = _StubSource("replay", 95, _est(50.1, 30.0, "replay", 95, timestamp=t0))
        r.add_source(replay)
        assert await r.resolve() is None

    @pytest.mark.asyncio
    async def test_error_in_source_falls_through(self):
        broken = _StubSource("broken", 95, None, raise_exc=RuntimeError("boom"))
        ok = _StubSource("ok", 70, _est(1.0, 1.0, "ok", 70))
        r = LocalizationResolver([broken, ok])
        result = await r.resolve()
        assert result is not None
        assert result.source == "ok"

    @pytest.mark.asyncio
    async def test_no_sources_returns_none(self):
        r = LocalizationResolver([])
        assert await r.resolve() is None

    @pytest.mark.asyncio
    async def test_disabled_config_returns_none(self, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_localization_enabled", False)
        ok = _StubSource("ok", 95, _est(1.0, 1.0, "ok", 95))
        r = LocalizationResolver([ok])
        assert await r.resolve() is None
        assert ok.calls == 0


# ═════════════════════════════════════════════════════════════════════════════
# IpApiLocator — cache, rate limit, network errors
# ═════════════════════════════════════════════════════════════════════════════


class _MockHttpx:
    """Minimal httpx.AsyncClient replacement for IpApiLocator tests."""

    def __init__(self, payload: dict | None = None, *, status_code: int = 200,
                 raise_error: Exception | None = None):
        self._payload = payload or {"latitude": 50.45, "longitude": 30.52, "city": "Kyiv"}
        self._status = status_code
        self._raise = raise_error
        self.calls = 0

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, url):
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        req = httpx.Request("GET", url)
        return httpx.Response(self._status, json=self._payload, request=req)


class TestIpApiLocator:
    @pytest.mark.asyncio
    async def test_caches_result_for_ten_minutes(self, monkeypatch):
        mock = _MockHttpx()
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(10))
        first = await loc.locate_current_ip()
        second = await loc.locate_current_ip()
        assert first is not None and second is not None
        assert first.lat == second.lat
        # Second call must be cached — only one HTTP request total.
        assert mock.calls == 1

    @pytest.mark.asyncio
    async def test_respects_rate_limit(self, monkeypatch):
        mock = _MockHttpx()
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(1))
        await loc.locate_current_ip()
        # Budget exhausted; cache TTL bypass: expire cache so we force a fresh fetch.
        loc.reset_cache()
        result = await loc.locate_current_ip()
        assert result is None  # no budget left
        assert mock.calls == 1

    @pytest.mark.asyncio
    async def test_handles_network_error(self, monkeypatch):
        mock = _MockHttpx(raise_error=httpx.ConnectError("no net"))
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(10))
        assert await loc.locate_current_ip() is None
        # Network failure must NOT consume budget.
        assert loc.remaining_budget() == 10

    @pytest.mark.asyncio
    async def test_handles_error_payload(self, monkeypatch):
        mock = _MockHttpx({"error": True, "reason": "RateLimited"})
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(10))
        assert await loc.locate_current_ip() is None


# ═════════════════════════════════════════════════════════════════════════════
# IpApiLocator circuit breaker — Phase 9.4c-qw-hotfix
# ═════════════════════════════════════════════════════════════════════════════


class TestIpApiCircuitBreaker:
    @pytest.mark.asyncio
    async def test_three_failures_open_breaker_for_ten_minutes(self, monkeypatch):
        from datetime import datetime, timedelta, timezone
        mock = _MockHttpx(raise_error=httpx.HTTPStatusError(
            "429", request=httpx.Request("GET", "x"),
            response=httpx.Response(429, request=httpx.Request("GET", "x")),
        ))
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(100))
        assert loc.can_request_or_has_cache() is True
        for _ in range(3):
            assert await loc.locate_current_ip() is None

        failures, until = loc.breaker_state()
        assert failures == 3
        assert until is not None
        # ~10 min cooldown (allow a 5 s slop for clock).
        delta = until - datetime.now(tz=timezone.utc)
        assert timedelta(minutes=9, seconds=55) <= delta <= timedelta(minutes=10, seconds=5)

        # While breaker is open, can_request_or_has_cache is False — so
        # the resolver's IpEstimateSource.is_available() returns False
        # and the resolver skips this source entirely.
        assert loc.can_request_or_has_cache() is False
        # And a direct probe is a no-op — no extra HTTP call.
        prev_calls = mock.calls
        assert await loc.locate_current_ip() is None
        assert mock.calls == prev_calls

    @pytest.mark.asyncio
    async def test_breaker_escalates_with_more_failures(self, monkeypatch):
        from datetime import datetime, timedelta, timezone
        mock = _MockHttpx(raise_error=httpx.ConnectError("dead"))
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(100))

        for _ in range(3):
            await loc.locate_current_ip()
        # Force the breaker to think its cooldown has elapsed so the next
        # call counts as another retry attempt rather than being blocked.
        for target_failures, expected_min in ((6, 30), (10, 60)):
            while loc.breaker_state()[0] < target_failures:
                loc._disabled_until = datetime.now(tz=timezone.utc) - timedelta(seconds=1)
                await loc.locate_current_ip()
            _, until = loc.breaker_state()
            assert until is not None
            delta = until - datetime.now(tz=timezone.utc)
            assert (
                timedelta(minutes=expected_min - 1) <= delta
                <= timedelta(minutes=expected_min + 1)
            ), f"expected ~{expected_min}min, got {delta}"

    @pytest.mark.asyncio
    async def test_success_resets_breaker(self, monkeypatch):
        from agent.localization.adapters import ipapi as ipapi_mod

        # Trip the breaker first.
        bad_mock = _MockHttpx(raise_error=httpx.ConnectError("dead"))
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", bad_mock)
        loc = IpApiLocator(DailyRateLimiter(100))
        for _ in range(3):
            await loc.locate_current_ip()
        assert loc.breaker_state()[0] == 3
        assert loc.can_request_or_has_cache() is False

        # Pretend cooldown elapsed.
        from datetime import datetime, timedelta, timezone
        loc._disabled_until = datetime.now(tz=timezone.utc) - timedelta(seconds=1)

        # Swap in a working response and try again.
        good_mock = _MockHttpx({"latitude": 50.45, "longitude": 30.52})
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", good_mock)
        result = await loc.locate_current_ip()
        assert result is not None
        # Breaker is fully reset on success.
        failures, until = loc.breaker_state()
        assert failures == 0
        assert until is None

    @pytest.mark.asyncio
    async def test_first_two_failures_do_not_trip_breaker(self, monkeypatch):
        mock = _MockHttpx(raise_error=httpx.ConnectError("dead"))
        from agent.localization.adapters import ipapi as ipapi_mod
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", mock)

        loc = IpApiLocator(DailyRateLimiter(100))
        for _ in range(2):
            assert await loc.locate_current_ip() is None
        failures, until = loc.breaker_state()
        assert failures == 2
        assert until is None
        # Still allowed to try again.
        assert loc.can_request_or_has_cache() is True

    @pytest.mark.asyncio
    async def test_cached_result_bypasses_breaker_check(self, monkeypatch):
        from agent.localization.adapters import ipapi as ipapi_mod

        # Prime the cache with a successful call.
        good_mock = _MockHttpx({"latitude": 50.45, "longitude": 30.52})
        monkeypatch.setattr(ipapi_mod.httpx, "AsyncClient", good_mock)
        loc = IpApiLocator(DailyRateLimiter(100))
        first = await loc.locate_current_ip()
        assert first is not None

        # Manually trip the breaker as if a later call had failed.
        from datetime import datetime, timedelta, timezone
        loc._consecutive_failures = 5
        loc._disabled_until = datetime.now(tz=timezone.utc) + timedelta(minutes=20)

        # Cache hits must still serve — the cache is the entire point.
        cached = await loc.locate_current_ip()
        assert cached is not None
        # Resolver-facing predicate sees True because cache exists.
        assert loc.can_request_or_has_cache() is True


# ═════════════════════════════════════════════════════════════════════════════
# BrowserGeolocationSource — freshness window
# ═════════════════════════════════════════════════════════════════════════════


class TestBrowserGeolocationSource:
    def setup_method(self):
        clear_browser_estimate()

    @pytest.mark.asyncio
    async def test_submits_then_resolves(self):
        submit_browser_estimate(lat=50.4501, lon=30.5234, accuracy_m=15.0)
        src = BrowserGeolocationSource()
        assert src.is_available()
        est = await src.get_position()
        assert est is not None
        assert est.source == "browser_geolocation"
        assert 0.85 <= est.confidence <= 0.95  # high accuracy → high confidence

    @pytest.mark.asyncio
    async def test_stale_submission_makes_source_unavailable(self, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_browser_geolocation_freshness_s", 5.0)
        # Submit with an old timestamp.
        old_ts = datetime.now(tz=timezone.utc) - timedelta(seconds=60)
        submit_browser_estimate(lat=50.0, lon=30.0, accuracy_m=20.0, timestamp=old_ts)
        src = BrowserGeolocationSource()
        assert not src.is_available()
        assert await src.get_position() is None


# ═════════════════════════════════════════════════════════════════════════════
# UserStatedSource — TTL
# ═════════════════════════════════════════════════════════════════════════════


class TestUserStatedSource:
    def setup_method(self):
        clear_user_stated()

    @pytest.mark.asyncio
    async def test_stated_location_is_resolvable(self):
        set_user_stated(lat=46.48, lon=30.73, place_name="Одеса")
        src = UserStatedSource()
        assert src.is_available()
        est = await src.get_position()
        assert est is not None
        assert est.source == "user_stated"
        assert est.trust_level == 80

    @pytest.mark.asyncio
    async def test_ttl_expires_after_configured_window(self, monkeypatch):
        from config import config
        monkeypatch.setattr(config, "agent_user_stated_ttl_s", 5)
        old_ts = datetime.now(tz=timezone.utc) - timedelta(seconds=30)
        set_user_stated(lat=46.48, lon=30.73, timestamp=old_ts)
        src = UserStatedSource()
        assert not src.is_available()
        assert await src.get_position() is None


# ═════════════════════════════════════════════════════════════════════════════
# GpsHardwareSource — driven by ContextEngine snapshot
# ═════════════════════════════════════════════════════════════════════════════


class TestGpsHardwareSource:
    @pytest.mark.asyncio
    async def test_reflects_context_engine_fix_state(self):
        from core.context_engine import context_engine
        # Reset to no fix.
        context_engine._snapshot["where"].update({
            "fix": False, "lat": None, "lon": None, "satellites": 0,
        })
        from agent.localization.sources.gps_hardware import GpsHardwareSource
        src = GpsHardwareSource()
        assert not src.is_available()
        assert await src.get_position() is None

        # Plant a fix.
        context_engine._snapshot["where"].update({
            "fix": True, "lat": 50.4501, "lon": 30.5234, "satellites": 8,
        })
        assert src.is_available()
        est = await src.get_position()
        assert est is not None
        assert est.source == "gps_hardware"
        assert est.trust_level == 95

        # Cleanup.
        context_engine._snapshot["where"].update({
            "fix": False, "lat": None, "lon": None, "satellites": 0,
        })


# ═════════════════════════════════════════════════════════════════════════════
# ContextEngine integration
# ═════════════════════════════════════════════════════════════════════════════


class TestContextEngineIntegration:
    @pytest.mark.asyncio
    async def test_snapshot_carries_source_metadata(self):
        from core.context_engine import context_engine
        from agent.localization import get_resolver, set_resolver
        from agent.localization.sources.browser_geolocation import (
            clear_browser_estimate, submit_browser_estimate,
        )

        # Fresh resolver with only the browser source so test is deterministic.
        from agent.localization.resolver import LocalizationResolver
        set_resolver(None)
        r = LocalizationResolver()
        r.add_source(BrowserGeolocationSource())
        set_resolver(r)

        clear_browser_estimate()
        submit_browser_estimate(lat=48.46, lon=30.72, accuracy_m=25.0)

        # Ensure GPS fix is off so browser source wins.
        context_engine._snapshot["where"].update({
            "fix": False, "lat": None, "lon": None, "satellites": 0,
        })

        await context_engine.resolve_localization()
        snap = context_engine.get_snapshot()
        where = snap["where"]
        assert where["source"] == "browser_geolocation"
        assert where["confidence"] > 0.0
        assert where["accuracy_m"] == 25.0
        assert abs(where["lat"] - 48.46) < 1e-6
        assert abs(where["lon"] - 30.72) < 1e-6

        # Cleanup
        clear_browser_estimate()
        set_resolver(None)

    @pytest.mark.asyncio
    async def test_snapshot_falls_to_none_when_no_source(self):
        from core.context_engine import context_engine
        from agent.localization import set_resolver
        from agent.localization.resolver import LocalizationResolver

        set_resolver(None)
        set_resolver(LocalizationResolver())  # empty

        context_engine._snapshot["where"].update({
            "fix": False, "lat": None, "lon": None, "satellites": 0,
        })
        await context_engine.resolve_localization()
        snap = context_engine.get_snapshot()
        assert snap["where"]["source"] == "none"
        assert snap["where"]["confidence"] == 0.0
        set_resolver(None)


# ═════════════════════════════════════════════════════════════════════════════
# wire_default_sources — idempotency
# ═════════════════════════════════════════════════════════════════════════════


class TestDefaultWiring:
    def test_wire_is_idempotent(self):
        from agent.localization import set_resolver
        from agent.localization.lifecycle import wire_default_sources
        from agent.localization.resolver import LocalizationResolver

        set_resolver(None)
        set_resolver(LocalizationResolver())

        wire_default_sources()
        from agent.localization import get_resolver
        names1 = [s.name for s in get_resolver().sources]

        wire_default_sources()
        names2 = [s.name for s in get_resolver().sources]

        assert names1 == names2
        assert "gps_hardware" in names1
        assert "user_stated" in names1
        assert "browser_geolocation" in names1
        assert "ip_estimate" in names1
        set_resolver(None)


# ═════════════════════════════════════════════════════════════════════════════
# Haversine
# ═════════════════════════════════════════════════════════════════════════════


def test_haversine_zero_distance():
    assert haversine_km(50.0, 30.0, 50.0, 30.0) == pytest.approx(0.0, abs=1e-6)


def test_haversine_known_distance():
    # Kyiv ↔ Odessa ≈ 443 km
    d = haversine_km(50.4501, 30.5234, 46.4825, 30.7233)
    assert 430 < d < 460
