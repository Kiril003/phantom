"""Tier-C I-3 — Day-2 D2-D1: per-call dispatcher wall-clock cap.

``tool_executor.execute_tool`` has its own ``asyncio.wait_for(...,
timeout=10s)``, but a handler installed by tests or by a future Phase 17b
path that bypasses tool_executor would otherwise be unbounded.
chat_tool_dispatcher now enforces its own ceiling regardless, driven by
``config.chat_tool_call_timeout_s``.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest


@pytest.fixture()
async def authed_user_and_db():
    from db.database import init_db, get_session
    from db.models import User
    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        db.add(User(
            id=user_id,
            username=f"phantom_i3_{user_id[:8]}",
            role="ROOT",
            pin_hash="x",
            rfid_uid_hash=None,
            preferences_json="{}",
        ))
        await db.commit()
    async with get_session() as db:
        yield user_id, db


class TestD2D1DispatcherTimeout:
    @pytest.mark.asyncio
    async def test_handler_that_hangs_returns_timeout_error(
        self, authed_user_and_db, monkeypatch
    ):
        # Replace the search_locationhistory delegate with a sleeper that
        # would otherwise hang the chat turn forever. The dispatcher
        # MUST enforce its own ceiling and surface a timeout error.
        from ai import chat_tool_dispatcher as ctd
        from config import config

        async def _sleeper(**_kw):
            await asyncio.sleep(2.0)
            return {"ok": True}

        monkeypatch.setitem(ctd._HANDLERS, "search_locationhistory", _sleeper)
        # Pin a tight ceiling so the test is fast — but >0 so the
        # default-fallback branch isn't exercised here.
        monkeypatch.setattr(config, "chat_tool_call_timeout_s", 0.1)

        user_id, db = authed_user_and_db
        out = await ctd.dispatch(
            "search_locationhistory", {}, user_id=user_id, db=db
        )
        assert out["ok"] is False
        assert out["error"].startswith("timeout:")
        assert out["elapsed_ms"] >= 100  # should fire close to the ceiling
        assert out["elapsed_ms"] < 1000   # should NOT have run the full 2 s

    @pytest.mark.asyncio
    async def test_default_timeout_used_when_config_misconfigured(
        self, authed_user_and_db, monkeypatch
    ):
        # Negative / zero / NaN values should fall through to the
        # built-in safe default (10 s) rather than disable the cap.
        from ai import chat_tool_dispatcher as ctd
        from config import config

        async def _instant(**_kw):
            return {"ok": True, "results": []}

        monkeypatch.setitem(ctd._HANDLERS, "search_locationhistory", _instant)
        monkeypatch.setattr(config, "chat_tool_call_timeout_s", 0)

        user_id, db = authed_user_and_db
        out = await ctd.dispatch(
            "search_locationhistory", {}, user_id=user_id, db=db
        )
        # The instant handler returns OK; the test verifies that timeout=0
        # didn't cause a SyntaxError / immediate-cancel — i.e. the
        # default-fallback branch took effect.
        assert out["ok"] is True

    def test_config_default_value_is_reasonable(self):
        from config import PhantomConfig
        v = PhantomConfig.model_fields["chat_tool_call_timeout_s"].default
        # 1 s would be too tight (Nominatim retries), 60 s is past the
        # tolerable chat-turn ceiling. Lock the band.
        assert 3.0 <= float(v) <= 30.0
