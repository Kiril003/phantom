"""Phase 16 — chat-prompt observability (audit-2026-04-28 step 4).

The Phase 16 plan from docs/AUTONOMOUS_DAY_PLAN.md called for four steps:

  1. Inject RECENT VISITED PLACES — already wired in routes_chat.py:192
  2. Inject NEARBY OSM features — already wired in prompt_builder.py:270
  3. Inject emotion block — already wired in routes_chat.py:197-227
  4. Add prompt-excerpt logging on ai_tool_use_log — THIS COMMIT.

This test suite covers step 4 end-to-end.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import select


# ── _detect_prompt_sections ───────────────────────────────────────────────────

class TestDetectSections:
    def test_empty_prompt_returns_empty(self):
        from api.routes_chat import _detect_prompt_sections
        assert _detect_prompt_sections("") == ""

    def test_full_prompt_detects_all_known_sections(self):
        from api.routes_chat import _detect_prompt_sections
        sample = (
            "PHANTOM is here.\n"
            "CURRENT STATE: SHADOW\n"
            "TONE: warm\n"
            "USER: kiril\n"
            "RELEVANT MEMORY: ...\n"
            "RECENT PLACES (last 24h):\n  • home\n"
            "NEARBY (within 500m):\n  • cafe\n"
            "INNER STATE: focused\n"
            "BODY: breathing=14bpm\n"
            "ENV: 22.0°C\n"
            "SYSTEM: cpu=10%\n"
        )
        sections = _detect_prompt_sections(sample).split(",")
        assert "identity" in sections
        assert "state" in sections
        assert "recent_places" in sections
        assert "nearby" in sections
        assert "emotion" in sections
        assert "memory" in sections
        assert "body" in sections

    def test_minimal_prompt_only_known_sections(self):
        from api.routes_chat import _detect_prompt_sections
        sections = _detect_prompt_sections(
            "PHANTOM is alive.\nCURRENT STATE: SHADOW\n"
        )
        # Should not falsely claim recent_places/nearby/emotion etc.
        assert "recent_places" not in sections
        assert "nearby" not in sections
        assert "emotion" not in sections
        assert "identity" in sections
        assert "state" in sections


# ── write_log integration ─────────────────────────────────────────────────────

class TestWriteLogChatColumns:
    @pytest.mark.asyncio
    async def test_write_log_persists_chat_columns(self):
        from ai.tool_use_audit import write_log
        from db.database import init_db, get_session
        from db.models import AiToolUseLog

        await init_db()

        uid = str(uuid.uuid4())
        row_id = await write_log(
            task_id=None,
            step_idx=None,
            provider="gemini",
            model="gemini-2.0-flash",
            tool_name="chat:text",
            success=True,
            error_kind=None,
            error_message=None,
            elapsed_ms=120,
            retry_count=1,
            user_id=uid,
            prompt_excerpt="PHANTOM is alive...",
            response_excerpt="Привіт, Кіріл.",
            prompt_sections="identity,state,tone,recent_places",
        )
        assert row_id is not None

        async with get_session() as db:
            result = await db.execute(
                select(AiToolUseLog).where(AiToolUseLog.id == row_id)
            )
            saved = result.scalar_one()

        assert saved.user_id == uid
        assert saved.prompt_excerpt == "PHANTOM is alive..."
        assert saved.response_excerpt == "Привіт, Кіріл."
        assert "recent_places" in (saved.prompt_sections or "")

    @pytest.mark.asyncio
    async def test_write_log_no_chat_columns_remains_backward_compatible(self):
        # Regression — existing call sites that don't pass chat fields
        # must keep working with all new fields nullable.
        from ai.tool_use_audit import write_log
        from db.database import init_db, get_session
        from db.models import AiToolUseLog

        await init_db()

        row_id = await write_log(
            task_id="t-bw",
            step_idx=0,
            provider="ollama",
            model="gemma:2b",
            tool_name="search_web",
            success=True,
            error_kind=None,
            error_message=None,
            elapsed_ms=80,
            retry_count=1,
        )
        assert row_id is not None

        async with get_session() as db:
            result = await db.execute(
                select(AiToolUseLog).where(AiToolUseLog.id == row_id)
            )
            saved = result.scalar_one()

        assert saved.user_id is None
        assert saved.prompt_excerpt is None
        assert saved.response_excerpt is None
        assert saved.prompt_sections is None


# ── Config defaults ───────────────────────────────────────────────────────────

class TestPhase16ConfigDefaults:
    def test_chat_prompt_logging_default_off(self):
        # Privacy-conscious default — operator opts in via Settings UI.
        from config import PhantomConfig
        assert PhantomConfig.model_fields["chat_prompt_logging_enabled"].default is False

    def test_chat_prompt_excerpt_max_chars_default_reasonable(self):
        from config import PhantomConfig
        default = PhantomConfig.model_fields["chat_prompt_excerpt_max_chars"].default
        assert 200 <= default <= 4000, (
            f"chat_prompt_excerpt_max_chars default ({default}) outside "
            "the 200–4000 sweet spot — too short is useless for ops, "
            "too long persists effectively-full content."
        )
