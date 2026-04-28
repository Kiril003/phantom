"""Day-3 audit-2026-04-30 — Block O commit O-2.

Closes **D3-A-2**: F-15 lockout used `request.client.host` with no XFF
parsing. Behind any reverse proxy `client.host == 127.0.0.1` for every
request — system-wide DoS amplifier AND no-op against the actual
attacker. The promised `security_trust_xff` config knob the L-3 commit
message asserted did not exist.

Now landed:

* `security_trust_xff: bool = False` (default off — secure out of the
  box without a proxy).
* `security_trusted_proxies: list[str]` — allowlist of immediate-peer
  hosts whose `X-Forwarded-For` is honoured. Defaults to loopback
  aliases.
* `_resolve_client_ip(request)` walks XFF right-to-left and returns
  the first IP NOT in the trusted set. Both `_ip_key` (lockout keying)
  AND the D3-A-1 default-PIN refusal route through this helper.
"""

from __future__ import annotations

import asyncio
from typing import Iterator

import httpx
import pytest


# ── Shared helpers ────────────────────────────────────────────────────────────


@pytest.fixture()
def lockout_clean() -> Iterator[None]:
    from security import login_lockout
    login_lockout.reset_for_tests()
    yield
    login_lockout.reset_for_tests()


@pytest.fixture()
def trust_xff_on() -> Iterator[None]:
    """Flip ``security_trust_xff`` ON for the duration of one test, then
    restore. Other tests in the module rely on the default-off
    behaviour."""
    from config import config
    prev = config.security_trust_xff
    config.security_trust_xff = True
    yield
    config.security_trust_xff = prev


def _drive(app, *, client: tuple[str, int], path: str,
           json: dict | None = None,
           headers: dict[str, str] | None = None) -> httpx.Response:
    """Synthesise an ASGI scope with explicit `client=...` so we can
    drive the route as if the request came from a specific peer."""
    async def _go() -> httpx.Response:
        transport = httpx.ASGITransport(app=app, client=client)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://h.test"
        ) as c:
            return await c.post(path, json=json, headers=headers or {})
    return asyncio.run(_go())


# ── D3-A-2 unit tests on the resolver ─────────────────────────────────────────


class TestResolveClientIp:
    def test_default_off_ignores_xff(self):
        from api.routes_auth import _resolve_client_ip
        from starlette.requests import Request

        req = Request({
            "type": "http",
            "method": "POST",
            "path": "/x",
            "headers": [(b"x-forwarded-for", b"203.0.113.42")],
            "client": ("127.0.0.1", 5000),
        })
        # Default config: security_trust_xff=False → ignore XFF.
        assert _resolve_client_ip(req) == "127.0.0.1"

    def test_xff_honoured_only_when_peer_is_trusted_proxy(self, trust_xff_on):
        from api.routes_auth import _resolve_client_ip
        from starlette.requests import Request

        # Peer is loopback (in trusted set by default) → XFF parsed.
        req_trusted = Request({
            "type": "http",
            "method": "POST",
            "path": "/x",
            "headers": [(b"x-forwarded-for", b"203.0.113.42")],
            "client": ("127.0.0.1", 5000),
        })
        assert _resolve_client_ip(req_trusted) == "203.0.113.42"

        # Peer NOT trusted → XFF must be ignored even if header present.
        req_untrusted = Request({
            "type": "http",
            "method": "POST",
            "path": "/x",
            "headers": [(b"x-forwarded-for", b"203.0.113.42")],
            "client": ("198.51.100.10", 5000),
        })
        assert _resolve_client_ip(req_untrusted) == "198.51.100.10"

    def test_xff_chain_strips_trusted_hops_right_to_left(self, trust_xff_on):
        from api.routes_auth import _resolve_client_ip
        from config import config
        from starlette.requests import Request

        # Two-proxy chain: client → edge_proxy → us. Both proxies are
        # trusted. XFF: "client, edge_proxy" → resolved client.
        config.security_trusted_proxies = [
            "127.0.0.1", "::1", "localhost", "192.168.10.5",
        ]
        try:
            req = Request({
                "type": "http",
                "method": "POST",
                "path": "/x",
                "headers": [
                    (b"x-forwarded-for", b"203.0.113.42, 192.168.10.5"),
                ],
                "client": ("127.0.0.1", 5000),
            })
            assert _resolve_client_ip(req) == "203.0.113.42"
        finally:
            config.security_trusted_proxies = [
                "127.0.0.1", "::1", "localhost",
            ]

    def test_no_client_returns_unknown(self):
        from api.routes_auth import _resolve_client_ip
        from starlette.requests import Request

        req = Request({
            "type": "http",
            "method": "POST",
            "path": "/x",
            "headers": [],
            # no `client` key — Starlette tolerates this for raw scopes
        })
        assert _resolve_client_ip(req) == "unknown"


# ── End-to-end: lockout actually keys on resolved IP ─────────────────────────


class TestE2eXffAwareLockout:
    def test_proxy_with_distinct_client_ips_lockout_independently(
        self, lockout_clean, trust_xff_on
    ):
        """Two distinct attackers behind the same loopback proxy must
        be lockout-keyed independently. Without D3-A-2 they'd collapse
        into the proxy's `127.0.0.1` key."""
        from main import create_app
        from security import login_lockout
        app = create_app()

        # Each attacker uses a distinct username so the user-key gate
        # doesn't prematurely conflate them — we want this test to
        # specifically exercise the IP-key independence.
        attacker_a = {"X-Forwarded-For": "203.0.113.10"}
        attacker_b = {"X-Forwarded-For": "203.0.113.99"}

        # Hammer attacker A from the proxy until locked.
        for i in range(login_lockout.LOCKOUT_THRESHOLD):
            r = _drive(
                app,
                client=("127.0.0.1", 5000),
                path="/api/v1/auth/login/pin",
                json={"username": f"missing_a_{i}", "pin": "wrong"},
                headers=attacker_a,
            )
            assert r.status_code in (401, 429)
        # Attacker A IS now locked on its IP-key.
        r = _drive(
            app,
            client=("127.0.0.1", 5000),
            path="/api/v1/auth/login/pin",
            json={"username": "missing_a_check", "pin": "wrong"},
            headers=attacker_a,
        )
        assert r.status_code == 429, r.text

        # Attacker B's first attempt MUST NOT be locked — separate
        # XFF-derived IP key, fresh username.
        r = _drive(
            app,
            client=("127.0.0.1", 5000),
            path="/api/v1/auth/login/pin",
            json={"username": "missing_b_first", "pin": "wrong"},
            headers=attacker_b,
        )
        assert r.status_code == 401, r.text

    def test_default_pin_refusal_uses_resolved_ip(
        self, lockout_clean, trust_xff_on
    ):
        """Behind a trusted proxy, the immediate peer is loopback —
        without XFF parsing, default-PIN attempts from a remote host
        would slip through the loopback gate. With D3-A-2 they must
        be refused."""
        from main import create_app
        app = create_app()

        r = _drive(
            app,
            client=("127.0.0.1", 5000),  # proxy is loopback
            path="/api/v1/auth/login/pin",
            json={"username": "phantom", "pin": "000000"},
            headers={"X-Forwarded-For": "203.0.113.42"},
        )
        assert r.status_code == 403, r.text
        assert r.headers.get("X-Error-Code") == "PIN_DEFAULT_REMOTE_FORBIDDEN"

    def test_default_off_remote_xff_ignored_for_loopback_gate(
        self, lockout_clean
    ):
        """Without `security_trust_xff` the daemon must NOT trust XFF
        for the loopback decision — that would let an XFF-spoofing
        client bypass the gate from a non-trusted peer. The peer IS
        loopback (TestClient sentinel via direct ASGI), so default
        PIN succeeds."""
        from main import create_app
        app = create_app()

        # security_trust_xff defaults off.
        r = _drive(
            app,
            client=("127.0.0.1", 5000),
            path="/api/v1/auth/login/pin",
            json={"username": "phantom", "pin": "000000"},
            headers={"X-Forwarded-For": "203.0.113.42"},
        )
        # Default-off: XFF ignored, peer is loopback → allowed.
        assert r.status_code == 200, r.text
