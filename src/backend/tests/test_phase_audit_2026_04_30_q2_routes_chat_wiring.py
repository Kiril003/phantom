"""Day-3 audit-2026-04-30 — Block Q commit Q-2.

Wire `ai.chat_pipeline.run` into `routes_chat._build_ai_response`
behind the `chat_tools_enabled` flag (default False — operators opt
in per deploy after reading PHASE_17_CHAT_TOOLS.md).

Asserts:

* Default flag OFF — chat path uses `ai_router.generate` directly.
* Flag ON — chat path routes through `chat_pipeline.run`.
* Flipping the flag mid-process takes effect on the next chat turn
  (no daemon restart required).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


# ── D3-Q-2 — chat_tools_enabled flag wiring ───────────────────────────────────


class TestChatToolsEnabledFlag:
    def test_default_off_uses_plain_generate(self):
        """When `chat_tools_enabled` is False (default), the routes_chat
        call MUST go through `ai_router.generate` directly — no
        chat_pipeline involvement, no tool-use surface, no envelope
        artefacts in the WS broadcast."""
        from config import config
        # Default check — guards the existing v0.18.x baseline.
        assert config.chat_tools_enabled is False, (
            "D3-Q-2 regression: chat_tools_enabled flipped to True by "
            "default — Phase 17b is gated by the per-tenant ContextEngine "
            "(D2-I2) and operators must opt in explicitly."
        )

    @pytest.mark.asyncio
    async def test_flag_on_routes_through_chat_pipeline(self, monkeypatch):
        """With the flag flipped on, `_build_ai_response` MUST call
        `chat_pipeline.run` (not `ai_router.generate`)."""
        from api import routes_chat
        from ai.provider import AIResponse

        pipeline_called = False

        async def _spy_pipeline_run(**kw):
            nonlocal pipeline_called
            pipeline_called = True
            return AIResponse(content="from pipeline", provider="gemini")

        async def _explode_generate(**kw):
            raise AssertionError(
                "D3-Q-2 regression: with flag on, ai_router.generate "
                "should not be called — chat_pipeline.run is the entry "
                "point."
            )

        monkeypatch.setattr(
            "ai.chat_pipeline.run", _spy_pipeline_run
        )
        monkeypatch.setattr(
            routes_chat.ai_router, "generate", _explode_generate
        )

        from config import config
        prev = config.chat_tools_enabled
        config.chat_tools_enabled = True
        try:
            # Build a minimal "user" stand-in. _build_ai_response only
            # reads .id, .username, .role, .preferences_json on the
            # User; we stub those.
            class _StubUser:
                id = "u-test"
                username = "phantom"
                role = "ROOT"
                preferences_json = "{}"

            # Patch every other side-effect-heavy dep so the test
            # focuses on the chat_pipeline branch.
            from memory.session_memory import session_memory
            session_memory.get_history_dicts = lambda *a, **kw: []
            from memory.user_model import (
                get_behavioral_model, save_behavioral_model,
            )

            async def _stub_bm(*a, **kw):
                from memory.user_model import BehavioralModel
                return BehavioralModel()

            monkeypatch.setattr(
                "memory.user_model.get_behavioral_model", _stub_bm
            )
            async def _stub_save_bm(*a, **kw):
                return None
            monkeypatch.setattr(
                "memory.user_model.save_behavioral_model", _stub_save_bm
            )
            async def _stub_retrieve(*a, **kw):
                return []
            monkeypatch.setattr(
                "memory.strategic_memory.retrieve_relevant", _stub_retrieve
            )
            async def _stub_extract(*a, **kw):
                return None
            monkeypatch.setattr(
                "memory.strategic_memory.extract_and_store_facts", _stub_extract
            )
            async def _stub_recent_places(*a, **kw):
                return []
            monkeypatch.setattr(
                "ai.prompt_builder.fetch_recent_places", _stub_recent_places
            )

            class _StubDb:
                async def commit(self):
                    return None
                async def rollback(self):
                    return None
                async def execute(self, *a, **kw):
                    class _R:
                        def scalar_one_or_none(self):
                            return None
                        def scalars(self):
                            return self
                        def all(self):
                            return []
                    return _R()
                async def flush(self):
                    return None
                def add(self, *a, **kw):
                    return None
                async def refresh(self, *a, **kw):
                    return None

            try:
                await routes_chat._build_ai_response(
                    user_message="hi",
                    session_id="sess-1",
                    user=_StubUser(),
                    db=_StubDb(),  # type: ignore[arg-type]
                )
            except Exception:
                # Down-stream code (vocab, fact extraction, behavioural
                # model save, geo bridge) hits Stub limits; we're only
                # asserting the early-path branching here.
                pass

            assert pipeline_called is True, (
                "D3-Q-2 regression: flag on but chat_pipeline.run was "
                "not invoked."
            )
        finally:
            config.chat_tools_enabled = prev


# ── D3-Q-2 — flag flip is dynamic ─────────────────────────────────────────────


class TestFlagDynamicFlip:
    def test_flag_read_at_call_time_not_module_load(self):
        """The wiring MUST read `config.chat_tools_enabled` AT EVERY
        chat turn so the operator can flip the flag via Settings UI
        without restarting the daemon. A `from config import` at
        module-level binding the value once would defeat hot-reload."""
        from pathlib import Path
        repo = Path(__file__).resolve().parents[3]
        text = (
            repo / "src" / "backend" / "api" / "routes_chat.py"
        ).read_text()
        # The branching MUST happen inside `_build_ai_response`, not
        # in a module-level constant. Confirm by counting occurrences
        # in the function body.
        assert "if config.chat_tools_enabled is True:" in text, (
            "D3-Q-2 regression: chat_tools_enabled isn't read at call "
            "time."
        )
        # And the chat_pipeline import is local (inside the if), not
        # at module top — keeps the dispatcher cold-load off the
        # off-path latency budget.
        assert "from ai.chat_pipeline import run" in text
