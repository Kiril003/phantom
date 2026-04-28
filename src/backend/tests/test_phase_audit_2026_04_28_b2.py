"""Block B-2 regression tests — audit 2026-04-28 security gates.

Covers:
  F-12: CORS no longer allows wildcard methods/headers.
  F-13: Baseline security-headers middleware emits the hardening set on every
        response.
  F-10c: agent_risk_tolerance default lowered to LOW (3); bash.run scrubs its
         spawned env so secrets in the daemon process are not leaked to the
         child shell.
"""

from __future__ import annotations

import os
import tempfile

import pytest


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


# ── F-13 — security headers ───────────────────────────────────────────────────

class TestF13SecurityHeaders:
    EXPECTED = {
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
    }

    def test_headers_present_on_health_route(self, client):
        resp = client.get("/api/v1/health")
        # health may 404 in some configs; the middleware still runs.
        for header, value in self.EXPECTED.items():
            assert resp.headers.get(header) == value, (
                f"Missing/incorrect {header} on /health response"
            )

    def test_headers_present_on_openapi(self, client):
        resp = client.get("/openapi.json")
        for header, value in self.EXPECTED.items():
            assert resp.headers.get(header) == value
        # CSP and HSTS should also be on every response.
        assert "default-src 'self'" in (resp.headers.get("content-security-policy") or "")
        assert resp.headers.get("strict-transport-security", "").startswith("max-age=")


# ── F-12 — CORS narrowed ──────────────────────────────────────────────────────

class TestF12CorsNarrow:
    def test_cors_methods_explicit(self):
        # Inspect the middleware stack — confirm allow_methods is no longer ["*"].
        from fastapi.middleware.cors import CORSMiddleware
        from main import create_app

        app = create_app()
        cors = next(
            (m for m in app.user_middleware if m.cls is CORSMiddleware),
            None,
        )
        assert cors is not None, "CORSMiddleware missing from app stack"
        kwargs = cors.kwargs
        methods = kwargs.get("allow_methods", [])
        headers = kwargs.get("allow_headers", [])
        assert "*" not in methods, "F-12 regression: allow_methods still wildcard"
        assert "*" not in headers, "F-12 regression: allow_headers still wildcard"
        # The replacement allow-list must cover the methods routes actually use.
        assert {"GET", "POST", "PUT", "DELETE"}.issubset(set(methods))


# ── F-10c — risk default + env scrub ──────────────────────────────────────────

class TestF10cRiskDefault:
    def test_default_risk_tolerance_is_low(self):
        # Class-level Pydantic field default (not the live runtime singleton
        # so monkeypatches from other tests can't leak through).
        from config import PhantomConfig
        field = PhantomConfig.model_fields["agent_risk_tolerance"]
        assert field.default == 3, (
            "F-10c regression: default agent_risk_tolerance not lowered to 3 (LOW)"
        )


class TestF10cBashEnvScrubbed:
    @pytest.mark.asyncio
    async def test_bash_run_env_does_not_leak_parent_secret(self, monkeypatch):
        from agent.actions.bash import BashRun
        from agent.actions.base import ActionContext

        # Plant a sentinel in the parent process env. If bash.run inherits
        # it the spawned shell will echo it — that's the leak F-10c closes.
        sentinel = "PHANTOM_AUDIT_SECRET_DO_NOT_LEAK"
        monkeypatch.setenv(sentinel, "leaked_value_12345")

        with tempfile.TemporaryDirectory() as workspace:
            ctx = ActionContext(task_id="t-test", step_idx=0, workspace_dir=workspace)
            res = await BashRun(
                cmd=f'echo "${sentinel}"',
                timeout_s=5,
                sandboxed=False,
            ).execute(ctx)

        assert res.ok is True, f"bash.run failed: {res.error}"
        stdout = res.output["stdout"]
        assert "leaked_value_12345" not in stdout, (
            "F-10c regression: parent env leaked into bash.run subprocess"
        )

    @pytest.mark.asyncio
    async def test_bash_run_keeps_path_for_resolution(self):
        # Scrubbed env still needs PATH, otherwise /bin/sh -c "ls" would fail
        # to find ls. This guards against an over-zealous future scrub.
        from agent.actions.bash import BashRun
        from agent.actions.base import ActionContext

        with tempfile.TemporaryDirectory() as workspace:
            ctx = ActionContext(task_id="t-test", step_idx=0, workspace_dir=workspace)
            res = await BashRun(
                cmd="ls /tmp >/dev/null && echo ok",
                timeout_s=5,
                sandboxed=False,
            ).execute(ctx)

        assert res.ok is True
        assert "ok" in res.output["stdout"]

    @pytest.mark.asyncio
    async def test_bash_run_home_set_to_workspace(self):
        # HOME must equal the workspace so any tool that consults $HOME
        # (e.g. pip caches) writes inside the agent's sandbox, not the
        # daemon user's home directory.
        from agent.actions.bash import BashRun
        from agent.actions.base import ActionContext

        with tempfile.TemporaryDirectory() as workspace:
            ctx = ActionContext(task_id="t-test", step_idx=0, workspace_dir=workspace)
            res = await BashRun(
                cmd='echo "$HOME"',
                timeout_s=5,
                sandboxed=False,
            ).execute(ctx)

        assert res.ok is True
        assert res.output["stdout"].strip() == workspace
