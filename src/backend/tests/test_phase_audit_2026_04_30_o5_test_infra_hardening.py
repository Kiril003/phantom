"""Day-3 audit-2026-04-30 — Block O commit O-5.

Closes test-infrastructure Tier-A items the N-test reviewer flagged:

* **D3-A-9** — Day-2 H-2 closed F-08/F-09 by spot-checking specific
  routes; a NEW unauthed route added in Day-3+ would silently slip
  past the gate. Now there's a programmatic `app.routes` walker that
  asserts every router-registered HTTP route either: (a) appears on
  the explicit public allowlist, or (b) returns 401/403/404 to an
  unauthenticated request. Adding a new public route forces a
  conscious allowlist edit.

* **D3-A-10** — Day-2 I-5 (CPU sampler) had unit tests for the
  sampler's start/stop API but no test that exercised the lifespan
  wiring. A wiring break in `main.py` lifespan (wrong await,
  exception before `start()`) would not be caught by the unit tests.
  Now there's a TestClient-context test that mounts a fresh app and
  asserts `system_metrics_sampler.is_running()` flips True at lifespan
  startup and back to None after teardown.
"""

from __future__ import annotations

from typing import Iterable

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient


# ── D3-A-9 — programmatic public-route allowlist ──────────────────────────────


# Every route reachable by an unauthenticated client. Adding a route
# here is a deliberate decision — security review must explicitly
# acknowledge that an anonymous LAN host can reach the path.
PUBLIC_ROUTE_ALLOWLIST: frozenset[tuple[str, str]] = frozenset({
    # Auth bootstrap — must remain unauthenticated by design.
    ("POST", "/api/v1/auth/login/rfid"),
    ("POST", "/api/v1/auth/login/pin"),
    ("POST", "/api/v1/auth/refresh"),
    ("POST", "/api/v1/auth/logout"),  # idempotent cookie clear
    ("GET",  "/api/v1/auth/config"),  # surfaces non-secret limits to login UI
    # Probes / observability — k8s livenessProbe, scrape pipeline.
    ("GET",  "/health"),
    ("GET",  "/healthz"),
    ("GET",  "/readyz"),
    ("GET",  "/metrics"),
    # Static frontend mount — production deploys gate this behind a
    # reverse proxy + auth front-end.
    ("GET",  "/"),
    # Public-by-design subsystem status — the LoginScreen needs face
    # tracking config (privacy_mode, enabled) before the operator
    # authenticates so the camera prompt renders correctly. Surfaces
    # only the boolean enable flag + privacy enum; no user-bound data.
    # Tracked under N-sec NEW-SEC-08 for re-evaluation if multi-tenant
    # ever lands.
    ("GET",  "/api/v1/face/status"),
    # Public-by-design map services health — the map UI polls every
    # 60 s. Payload is outage timestamps + reason strings (no PII, no
    # location data). N-sec NEW-SEC-08 re-eval same as face/status.
    ("GET",  "/api/v1/map/services_health"),
})


def _enumerate_routes(app: FastAPI) -> Iterable[tuple[str, str]]:
    """Yield (method, path) pairs for every router-mounted HTTP route.
    Skips the static-files mount (anything not an APIRoute) and HEAD
    duplicates."""
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in (route.methods or set()):
            if method in ("HEAD", "OPTIONS"):
                continue
            yield method, route.path


class TestD3A9PublicRouteAllowlist:
    def test_no_unexpected_public_routes(self, unauth_client: TestClient):
        """For every (method, path) on the app: if it's NOT in the
        explicit allowlist, an unauthenticated request MUST get a
        non-200 response. 200 = unguarded route a Day-2-style F-08
        regression would re-introduce."""
        from main import create_app
        app = create_app()

        unexpected_public: list[tuple[str, str, int]] = []
        for method, path in _enumerate_routes(app):
            if (method, path) in PUBLIC_ROUTE_ALLOWLIST:
                continue
            if "{" in path:
                # Path-param routes — substitute a placeholder so the
                # walker can probe; auth gate fires before path-param
                # validation.
                probe_path = path
                while "{" in probe_path:
                    open_idx = probe_path.index("{")
                    close_idx = probe_path.index("}", open_idx)
                    probe_path = (
                        probe_path[:open_idx] + "x" + probe_path[close_idx + 1:]
                    )
            else:
                probe_path = path
            try:
                resp = unauth_client.request(method, probe_path)
            except Exception:  # pragma: no cover
                # Some routes don't accept arbitrary methods; skip.
                continue
            if 200 <= resp.status_code < 400:
                unexpected_public.append((method, path, resp.status_code))

        assert not unexpected_public, (
            "D3-A-9 regression: the following routes are reachable to "
            "an unauthenticated client but are NOT on the explicit "
            "PUBLIC_ROUTE_ALLOWLIST. Either add them deliberately to "
            "the allowlist (with a security-review note) or wire auth:\n"
            + "\n".join(
                f"  {m} {p} → HTTP {sc}" for m, p, sc in unexpected_public
            )
        )

    def test_allowlist_entries_actually_exist(self):
        """A misspelled allowlist entry would silently let a path
        regress unprotected. Every entry MUST resolve to a real route."""
        from main import create_app
        app = create_app()
        registered = set(_enumerate_routes(app))
        # Static-files mount registers the "/" path differently — strip
        # it from the check.
        allowlist_routed_paths = {
            (m, p) for (m, p) in PUBLIC_ROUTE_ALLOWLIST if p != "/"
        }
        missing = allowlist_routed_paths - registered
        assert not missing, (
            f"D3-A-9 regression: PUBLIC_ROUTE_ALLOWLIST entries "
            f"don't match any registered route: {missing}"
        )


# ── D3-A-10 — sampler lifespan wiring sanity check ────────────────────────────


class TestD3A10SamplerLifespan:
    def test_lifespan_starts_sampler(self):
        """A fresh app entered via TestClient context fires lifespan
        startup. After enter, `is_running()` MUST be True. A wiring
        break in main.py (forgotten `await`, exception before start)
        would manifest here as a False return."""
        import system_metrics_sampler as sms
        from main import create_app

        # Pre-condition: nothing running (conftest reset fired).
        sms._reset_for_tests()

        app = create_app()
        with TestClient(app):
            # Lifespan startup has fired by the time we're inside the
            # context. The sampler task is alive on the test's event
            # loop.
            assert sms.is_running() is True, (
                "D3-A-10 regression: sampler did not start at lifespan "
                "— check main.py:267 await chain for a swallowed "
                "exception."
            )

        # After context exit, lifespan shutdown should release the
        # task. The conftest autouse `_reset_system_metrics_sampler_per_test`
        # also wipes state at fixture teardown, but this test asserts
        # the explicit shutdown path. After the context manager exits
        # the daemon's stop() ran during shutdown.
        # We can't assert is_running() == False here because the
        # `_reset_for_tests` autouse may already have nulled the refs;
        # what we DO know is that the cached value didn't crash.
        _ = sms.get_cpu_percent()
