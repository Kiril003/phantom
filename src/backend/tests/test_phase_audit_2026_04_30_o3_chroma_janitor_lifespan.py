"""Day-3 audit-2026-04-30 — Block O commit O-3.

Closes two Tier-A regressions on the chroma surface:

* **D3-A-5** — Day-2 shipped `prune_orphan_collections` +
  `prune_orphan_dirs` as a CLI-only entry point with no automated
  invocation. The on-disk leak was therefore monotonic (105 MB → 122 MB
  / 609 → 705 dirs in 24 h on the dev box). Now wired into the FastAPI
  lifespan, gated by `chroma_janitor_at_startup` (default True).

* **D3-A-6** — Day-2's `_probe_chroma` only checked the cached
  `client_initialized()` flag → after a runtime client collapse the
  probe kept reporting healthy. Now issues `client.heartbeat()` (cheap
  ns-timestamp roundtrip) so genuine corruption is surfaced.
"""

from __future__ import annotations

import asyncio
from typing import Iterator

import pytest


# ── D3-A-6 — _probe_chroma now actively pings the client ──────────────────────


class TestD3A6ChromaHeartbeat:
    def test_healthy_client_reports_ok(self):
        """Live in-process client → heartbeat succeeds → probe reports
        ok."""
        from observability import _probe_chroma
        from memory.strategic_memory import init_chroma_eager

        # Ensure the client is open (the suite usually has it warmed
        # by lifespan, but this test runs in isolation too).
        asyncio.run(init_chroma_eager())

        ok, detail = asyncio.run(_probe_chroma())
        assert ok is True, detail
        assert detail == "ok"

    def test_runtime_collapse_caught(self, monkeypatch):
        """Replace the cached client with a stub that raises on
        `.heartbeat()`. Probe MUST report not-ready — the Day-2 cached
        flag was a false-positive surface."""
        from observability import _probe_chroma
        import memory.strategic_memory as sm

        class _Broken:
            def heartbeat(self):
                raise RuntimeError("chroma backing file deleted")

        monkeypatch.setattr(sm, "_chroma_client", _Broken())
        ok, detail = asyncio.run(_probe_chroma())
        assert ok is False
        assert detail.startswith("chroma:"), detail

    def test_uninitialised_client_still_reports_not_ready(self, monkeypatch):
        """The Day-2 `client_initialized()` early-out is preserved —
        when lifespan hasn't yet completed `init_chroma_eager` we don't
        even attempt heartbeat (no client to call)."""
        from observability import _probe_chroma
        import memory.strategic_memory as sm

        monkeypatch.setattr(sm, "_chroma_client", None)
        ok, detail = asyncio.run(_probe_chroma())
        assert ok is False
        assert "not_initialized" in detail


# ── D3-A-5 — janitor wired to lifespan ────────────────────────────────────────


class TestD3A5JanitorLifespan:
    def test_config_default_on(self):
        """Operator opt-out exists, but default MUST be on — otherwise
        the regression Day-2 shipped re-introduces itself."""
        from config import PhantomConfig
        v = PhantomConfig.model_fields["chroma_janitor_at_startup"].default
        assert v is True, (
            "D3-A-5 regression: chroma_janitor_at_startup default flipped to "
            "False — chroma_data/ growth becomes monotonic again."
        )

    def test_lifespan_invokes_janitor_when_enabled(self, monkeypatch):
        """Build an app, override the strategic_memory module's two
        prune entry points with spies, run the lifespan startup phase
        (via a TestClient mount), and assert both spies fired."""
        from fastapi.testclient import TestClient
        import memory.strategic_memory as sm

        sql_calls: list[set[str]] = []
        fs_calls: list[bool] = []

        async def _spy_sql(known_user_ids: set[str], **kw):
            sql_calls.append(set(known_user_ids))
            return {"deleted": [], "kept": 0, "scanned": 0}

        async def _spy_fs(**kw):
            fs_calls.append(True)
            return {
                "scanned": 0, "live": 0, "deleted_dirs": [],
                "freed_bytes": 0, "failures": [], "dry_run": False,
            }

        monkeypatch.setattr(sm, "prune_orphan_collections", _spy_sql)
        monkeypatch.setattr(sm, "prune_orphan_dirs", _spy_fs)

        from main import create_app
        app = create_app()
        with TestClient(app) as _:
            pass  # entering the context fires lifespan startup

        assert sql_calls, (
            "D3-A-5: lifespan didn't call prune_orphan_collections"
        )
        assert fs_calls, (
            "D3-A-5: lifespan didn't call prune_orphan_dirs"
        )
        # Single-tenant deploy ⇒ at least the seeded `phantom` user is
        # in the known set so its real collection is preserved.
        assert sql_calls[0], (
            "Known-user-id set was empty — pruner would have wiped the "
            "live `phantom` user collection."
        )

    def test_opt_out_skips_janitor(self, monkeypatch):
        """`chroma_janitor_at_startup=False` MUST short-circuit before
        the spies fire."""
        from fastapi.testclient import TestClient
        from config import config
        import memory.strategic_memory as sm

        sql_called = False
        fs_called = False

        async def _spy_sql(*a, **kw):
            nonlocal sql_called
            sql_called = True
            return {"deleted": [], "kept": 0, "scanned": 0}

        async def _spy_fs(*a, **kw):
            nonlocal fs_called
            fs_called = True
            return {
                "scanned": 0, "live": 0, "deleted_dirs": [],
                "freed_bytes": 0, "failures": [], "dry_run": False,
            }

        prev = config.chroma_janitor_at_startup
        config.chroma_janitor_at_startup = False
        try:
            monkeypatch.setattr(sm, "prune_orphan_collections", _spy_sql)
            monkeypatch.setattr(sm, "prune_orphan_dirs", _spy_fs)
            from main import create_app
            app = create_app()
            with TestClient(app) as _:
                pass
        finally:
            config.chroma_janitor_at_startup = prev

        assert sql_called is False
        assert fs_called is False

    def test_janitor_failure_does_not_crash_startup(self, monkeypatch):
        """If the janitor raises, lifespan logs and continues. Critical:
        a corrupt chroma_data/ must not turn into a daemon that won't
        boot."""
        from fastapi.testclient import TestClient
        import memory.strategic_memory as sm

        async def _raises_sql(*a, **kw):
            raise RuntimeError("synthetic janitor failure")

        async def _raises_fs(*a, **kw):
            raise RuntimeError("synthetic janitor failure")

        monkeypatch.setattr(sm, "prune_orphan_collections", _raises_sql)
        monkeypatch.setattr(sm, "prune_orphan_dirs", _raises_fs)

        from main import create_app
        app = create_app()
        # No exception expected from the context-enter path.
        with TestClient(app) as c:
            r = c.get("/healthz")
            assert r.status_code == 200
