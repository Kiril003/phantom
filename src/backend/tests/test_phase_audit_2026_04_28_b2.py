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
            # `unsafe_mode=False` explicitly even though it is now the
            # ActionContext default: F-10c's guarantee is specifically about
            # the leashed path (`clean_env`), and stating it keeps the test
            # pinned there if the default ever moves again. The unleashed
            # path routes through `host_env_unsafe()`, where HOME stays the
            # daemon user's real home — see TestF10cUnsafeModeIsOptIn.
            ctx = ActionContext(
                task_id="t-test",
                step_idx=0,
                workspace_dir=workspace,
                unsafe_mode=False,
            )
            res = await BashRun(
                cmd='echo "$HOME"',
                timeout_s=5,
                sandboxed=False,
            ).execute(ctx)

        assert res.ok is True
        assert res.output["stdout"].strip() == workspace


# ── F-10c follow-up — the waiver must be opted into, never defaulted ──────────

class TestF10cUnsafeModeIsOptIn:
    """The "no-leash" waiver is an operator act. Anything that reaches
    `unsafe_mode=True` without an operator passing it is a regression:
    the F-10c env scrub (clean_env allowlist + workspace HOME) is the
    control, and `host_env_unsafe()`'s deny-list is not an equivalent
    substitute — see `test_manifest_secrets_are_all_denied` for why.
    """

    def test_action_context_defaults_to_leashed(self):
        from agent.actions.base import ActionContext

        ctx = ActionContext(task_id="t", step_idx=0, workspace_dir="/tmp")
        assert ctx.unsafe_mode is False

    def test_runtime_entry_points_default_to_leashed(self):
        import inspect

        from agent.kernel.executor import execute
        from agent.kernel.runtime import AgentRuntime, QueuedTask, TaskState

        for fn in (AgentRuntime.start_task, AgentRuntime._spawn_task,
                   AgentRuntime.start_mission, execute):
            param = inspect.signature(fn).parameters["unsafe_mode"]
            assert param.default is False, (
                f"{fn.__qualname__} defaults unsafe_mode={param.default!r} — "
                "the waiver must be passed in by an operator, not inherited"
            )

        # Dataclass state carries the same default so a task constructed
        # directly (rehydrate, queue drain) is leashed too.
        assert TaskState.__dataclass_fields__["unsafe_mode"].default is False
        assert QueuedTask.__dataclass_fields__["unsafe_mode"].default is False

    @pytest.mark.asyncio
    async def test_bash_run_default_ctx_scrubs_env(self, monkeypatch):
        """The F-10c guarantee holds on the *default* path, not just when a
        caller remembers to ask for it. Before the flip this asserted the
        opposite of what ran: HOME was the daemon user's real home."""
        from agent.actions.bash import BashRun
        from agent.actions.base import ActionContext

        monkeypatch.setenv("ALARMS_UA_KEY", "geo_key_should_not_leak")

        with tempfile.TemporaryDirectory() as workspace:
            # No unsafe_mode argument — this is the whole point of the test.
            ctx = ActionContext(task_id="t-test", step_idx=0, workspace_dir=workspace)
            res = await BashRun(
                cmd='echo "$HOME"; echo "${ALARMS_UA_KEY}"',
                timeout_s=5,
                sandboxed=False,
            ).execute(ctx)

        assert res.ok is True, f"bash.run failed: {res.error}"
        stdout = res.output["stdout"]
        assert stdout.splitlines()[0].strip() == workspace, (
            "HOME is not the workspace jail on the default path"
        )
        assert "geo_key_should_not_leak" not in stdout

    def test_task_loop_never_hardcodes_the_waiver(self):
        """`_fulfill_dependencies`, the ADR writer and the synth repair path
        each built their own ActionContext with a literal `unsafe_mode=True`,
        so an operator running with the shield ON still got `sudo apt-get
        install`, a `git commit` and a tool rewrite on the unleashed path.
        Every Ctx in the loop must read `state.unsafe_mode`."""
        import pathlib

        src = pathlib.Path(
            __file__
        ).resolve().parent.parent / "agent" / "kernel" / "loop.py"
        text = src.read_text(encoding="utf-8")

        assert "unsafe_mode=True" not in text, (
            "agent/kernel/loop.py hardcodes unsafe_mode=True — propagate "
            "state.unsafe_mode instead so the operator's shield toggle is "
            "honoured on every path"
        )
        assert text.count("unsafe_mode=state.unsafe_mode") >= 3

    def test_manifest_secrets_are_all_denied(self):
        """Structural guard on the deny-list gap. Geo layer manifests name
        their own secret env var via `auth.env_key` — a free-form string in
        editable YAML — so `host_env_unsafe()` cannot enumerate them by
        construction. Six shipped manifests/config keys leaked through it
        before this test existed. A new manifest with an API key now fails
        here instead of silently widening the waiver path."""
        import pathlib

        import yaml

        from agent.operations.safety.sandbox import assert_env_safe

        manifests = (
            pathlib.Path(__file__).resolve().parent.parent
            / "geo" / "layer_registry" / "manifests"
        )
        env_keys = []
        for path in sorted(manifests.glob("*.yaml")):
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            key = ((doc.get("source") or {}).get("auth") or {}).get("env_key")
            if key:
                env_keys.append((path.name, key))

        assert env_keys, "no manifest declared auth.env_key — glob or schema moved"

        leaked = []
        for name, key in env_keys:
            try:
                assert_env_safe({key: "sentinel"})
            except AssertionError:
                continue
            leaked.append(f"{key} ({name})")

        assert not leaked, (
            "layer-manifest secrets not covered by the sandbox deny-list: "
            f"{leaked} — add them to SENSITIVE_ENV_EXACT in "
            "agent/operations/safety/sandbox.py"
        )
