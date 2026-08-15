"""SaaS rate limiter — reverse-proxy keying and bounded memory.

Two defects this pins down:

* The Day-3 D3-A-2 audit fixed XFF-aware keying for the login lockout but left
  ``tenant_rate_limit_middleware`` on the raw TCP peer. Behind a proxy every
  remote caller collapsed into one bucket — a tenant-wide DoS amplifier that
  never isolated the actual offender.
* ``_REQUEST_HISTORY`` is keyed by caller IP and was never pruned, so the map
  retained an entry for every address the process had ever served.
"""
from __future__ import annotations

import time

import pytest

import security.rate_limiter as rl
from security.client_ip import resolve_client_ip


class _FakeClient:
    def __init__(self, host: str) -> None:
        self.host = host


class _FakeRequest:
    """Minimal stand-in exposing only what the resolver touches."""

    def __init__(self, host: str | None, headers: dict[str, str] | None = None) -> None:
        self.client = _FakeClient(host) if host else None
        self.headers = headers or {}


@pytest.fixture(autouse=True)
def _clean_state():
    rl._REQUEST_HISTORY.clear()
    rl._last_sweep = 0.0
    yield
    rl._REQUEST_HISTORY.clear()
    rl._last_sweep = 0.0


def test_untrusted_peer_keeps_the_direct_peer(monkeypatch):
    from config import config

    monkeypatch.setattr(config, "security_trust_xff", True, raising=False)
    monkeypatch.setattr(config, "security_trusted_proxies", ["127.0.0.1"], raising=False)

    # Peer is not a configured proxy, so its XFF claim must be ignored.
    req = _FakeRequest("198.51.100.10", {"x-forwarded-for": "203.0.113.9"})
    assert resolve_client_ip(req) == "198.51.100.10"


def test_trusted_proxy_resolves_the_real_caller(monkeypatch):
    from config import config

    monkeypatch.setattr(config, "security_trust_xff", True, raising=False)
    monkeypatch.setattr(config, "security_trusted_proxies", ["127.0.0.1"], raising=False)

    req = _FakeRequest("127.0.0.1", {"x-forwarded-for": "203.0.113.42, 127.0.0.1"})
    assert resolve_client_ip(req) == "203.0.113.42"


def test_callers_behind_one_proxy_get_separate_budgets(monkeypatch):
    """The whole point: two clients via the same proxy must not share a bucket."""
    from config import config

    monkeypatch.setattr(config, "security_trust_xff", True, raising=False)
    monkeypatch.setattr(config, "security_trusted_proxies", ["127.0.0.1"], raising=False)

    noisy = _FakeRequest("127.0.0.1", {"x-forwarded-for": "203.0.113.1, 127.0.0.1"})
    quiet = _FakeRequest("127.0.0.1", {"x-forwarded-for": "203.0.113.2, 127.0.0.1"})

    noisy_key = f"rate:t:{resolve_client_ip(noisy)}"
    quiet_key = f"rate:t:{resolve_client_ip(quiet)}"
    assert noisy_key != quiet_key

    for _ in range(5):
        assert rl.check_rate_limit(noisy_key, max_requests=5, window_s=60)[0] is True
    # Noisy neighbour is now blocked...
    assert rl.check_rate_limit(noisy_key, max_requests=5, window_s=60)[0] is False
    # ...while the unrelated client behind the same proxy is untouched.
    assert rl.check_rate_limit(quiet_key, max_requests=5, window_s=60)[0] is True


@pytest.mark.asyncio
async def test_middleware_keys_on_the_resolved_caller_not_the_proxy(monkeypatch):
    """Guards the fix at its actual site: the middleware, not just the helper."""
    from config import config

    monkeypatch.setattr(config, "security_trust_xff", True, raising=False)
    monkeypatch.setattr(config, "security_trusted_proxies", ["127.0.0.1"], raising=False)

    class _Req:
        def __init__(self, xff: str) -> None:
            self.client = _FakeClient("127.0.0.1")
            self.headers = {"x-forwarded-for": f"{xff}, 127.0.0.1"}
            self.url = type("U", (), {"path": "/api/v1/chat"})()

    async def _call_next(_req):
        return "ok"

    # One caller burns its whole budget through the proxy.
    for _ in range(rl.DEFAULT_RPM):
        await rl.tenant_rate_limit_middleware(_Req("203.0.113.1"), _call_next)

    keys = list(rl._REQUEST_HISTORY)
    assert any("203.0.113.1" in k for k in keys), f"caller IP absent from keys: {keys}"
    assert not any(k.endswith("127.0.0.1") for k in keys), "keyed on the proxy, not the caller"

    # A different caller behind the same proxy must still be served.
    assert await rl.tenant_rate_limit_middleware(_Req("203.0.113.2"), _call_next) == "ok"


def test_history_does_not_retain_every_ip_forever(monkeypatch):
    for i in range(50):
        rl.check_rate_limit(f"rate:t:10.0.0.{i}", max_requests=5, window_s=60)
    grown = len(rl._REQUEST_HISTORY)
    assert grown == 50

    # Jump past both the window and the sweep interval, then touch it again.
    later = time.time() + 10_000
    monkeypatch.setattr(rl.time, "time", lambda: later)
    rl.check_rate_limit("rate:t:10.9.9.9", max_requests=5, window_s=60)

    assert len(rl._REQUEST_HISTORY) < grown
    assert "rate:t:10.9.9.9" in rl._REQUEST_HISTORY


def test_a_short_window_caller_cannot_prune_a_long_window_caller(monkeypatch):
    """Eviction uses a fixed idle horizon, not whichever window arrived last.

    Otherwise a caller polling with a 1s window would sweep away the history of
    a caller on a 60s window, handing that caller a fresh budget mid-window.
    """
    long_key = "rate:t:203.0.113.50"
    for _ in range(5):
        assert rl.check_rate_limit(long_key, max_requests=5, window_s=60)[0] is True
    assert rl.check_rate_limit(long_key, max_requests=5, window_s=60)[0] is False

    # A different caller checks in with a tiny window, 2s later, forcing a sweep.
    later = time.time() + 2
    monkeypatch.setattr(rl.time, "time", lambda: later)
    rl._last_sweep = 0.0
    rl.check_rate_limit("rate:t:203.0.113.51", max_requests=5, window_s=1)

    # The long-window caller must still be blocked — its history survived.
    assert long_key in rl._REQUEST_HISTORY
    assert rl.check_rate_limit(long_key, max_requests=5, window_s=60)[0] is False


def test_sweep_never_discards_the_key_it_is_about_to_count(monkeypatch):
    """Pruning runs before the defaultdict materialises the current key.

    With the opposite order the fresh empty deque is swept away, the counter
    appends to a detached object, and the limit silently stops applying.
    """
    key = "rate:t:203.0.113.77"
    codes = []
    for _ in range(8):
        # Force a sweep on every call so a wrong order cannot hide.
        rl._last_sweep = 0.0
        codes.append(rl.check_rate_limit(key, max_requests=5, window_s=60)[0])

    assert False in codes, "rate limit never engaged — the bucket is being dropped"
