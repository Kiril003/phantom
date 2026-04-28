"""Tier-C I-1 — Day-2 D2-T1 + D2-S2 input hardening for the chat tools.

The Day-2 audit threat-modelled three concrete bypasses against the
LLM-controlled args that flow into ``ai.tool_executor`` handlers:

* **D2-T1** — ``int(True)`` returns ``1``. An LLM that hallucinates
  ``"hours_ago": true`` would have silently been clamped to a 1-hour
  window. Reject bools explicitly.
* **D2-S2 (Unicode)** — RTL-override / zero-width / bidi codepoints
  hide wildcards or exfil intent inside an otherwise innocent-looking
  string. Reject any of them.
* **D2-S2 (ILIKE wildcards)** — raw ``%`` / ``_`` from the LLM widen
  the SQL substring filter to a full-table scan or evade the operator's
  intent. Escape them, and pass ``escape="\\\\"`` to ``ilike``.

These cases all hit ``ai.tool_executor.execute_tool`` (the canonical
chat path after Day-2 H-5).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest


# ── D2-T1 — bool rejection ────────────────────────────────────────────────────


class TestD2T1BoolRejection:
    @pytest.mark.asyncio
    async def test_search_locationhistory_rejects_bool_hours_ago(self):
        from ai.tool_executor import execute_tool
        out = await execute_tool(
            "search_locationhistory",
            {"hours_ago": True},
            user_id="phantom",
        )
        assert out.get("ok") is not True
        assert out.get("error_kind") == "invalid_args"
        assert "hours_ago" in out.get("error", "")

    @pytest.mark.asyncio
    async def test_query_temporal_anchors_rejects_bool_hours_ago(self):
        from ai.tool_executor import execute_tool
        out = await execute_tool(
            "query_temporal_anchors",
            {"hours_ago": False},
            user_id="phantom",
        )
        assert out.get("ok") is not True
        assert out.get("error_kind") == "invalid_args"

    def test_safe_int_helper_treats_bool_as_invalid(self):
        from ai.tool_executor import _safe_int
        assert _safe_int(True, lo=1, hi=720, default=24) is None
        assert _safe_int(False, lo=1, hi=720, default=24) is None
        # Real ints survive.
        assert _safe_int(48, lo=1, hi=720, default=24) == 48
        # Out-of-range clamps.
        assert _safe_int(99_999, lo=1, hi=720, default=24) == 720
        # None falls back to default.
        assert _safe_int(None, lo=1, hi=720, default=24) == 24
        # Unparseable strings reject.
        assert _safe_int("nope", lo=1, hi=720, default=24) is None


# ── D2-S2 — Unicode RTL / zero-width rejection ────────────────────────────────


class TestD2S2UnicodeRejection:
    @pytest.mark.parametrize(
        "evil",
        [
            "Home​secret",      # zero-width space sandwich
            "‮evil-rtl",        # right-to-left override
            "Home‬flip",        # pop directional formatting
            "﻿bom-prefixed",
        ],
    )
    @pytest.mark.asyncio
    async def test_search_locationhistory_rejects_unicode_danger(self, evil):
        from ai.tool_executor import execute_tool
        out = await execute_tool(
            "search_locationhistory",
            {"hours_ago": 24, "query": evil},
            user_id="phantom",
        )
        assert out.get("error_kind") == "invalid_args"

    @pytest.mark.asyncio
    async def test_query_temporal_anchors_rejects_rtl_in_state(self):
        from ai.tool_executor import execute_tool
        out = await execute_tool(
            "query_temporal_anchors",
            {"state": "FOCUS‮", "hours_ago": 24},
            user_id="phantom",
        )
        assert out.get("error_kind") == "invalid_args"

    @pytest.mark.asyncio
    async def test_recall_memory_facts_rejects_zero_width_in_query(self):
        from ai.tool_executor import execute_tool
        out = await execute_tool(
            "recall_memory_facts",
            {"query": "robot​query"},
            user_id="phantom",
        )
        assert out.get("error_kind") == "invalid_args"


# ── D2-S2 — ILIKE wildcard escape ─────────────────────────────────────────────


class TestD2S2WildcardEscape:
    def test_safe_query_str_escapes_percent_and_underscore(self):
        from ai.tool_executor import _safe_query_str
        clean, err = _safe_query_str("100%_match")
        assert err is None
        assert clean == "100\\%\\_match"
        # Backslashes get escaped first so escape-of-escape doesn't fold.
        clean, err = _safe_query_str("a\\b")
        assert err is None
        assert clean == "a\\\\b"

    def test_safe_query_str_returns_none_for_empty(self):
        from ai.tool_executor import _safe_query_str
        assert _safe_query_str(None) == (None, None)
        assert _safe_query_str("") == (None, None)
        assert _safe_query_str("   ") == (None, None)

    def test_safe_query_str_rejects_overlong(self):
        from ai.tool_executor import _safe_query_str
        clean, err = _safe_query_str("x" * 250, max_len=200)
        assert clean is None
        assert err == "invalid_args"

    def test_safe_query_str_rejects_non_string(self):
        from ai.tool_executor import _safe_query_str
        clean, err = _safe_query_str({"nested": "object"})
        assert clean is None
        assert err == "invalid_args"

    @pytest.mark.asyncio
    async def test_search_locationhistory_with_percent_widening_attempt_filters_correctly(
        self,
    ):
        # Black-box check: a raw `%` from the LLM must not match every
        # row. We seed two distinct place names with NO literal `%` in
        # them, then run a query of `%`. The escaped clause becomes
        # `LIKE '%\%%' ESCAPE '\'`, which matches only literal-`%`
        # rows — there are none, so the result must be empty.
        from db.database import init_db, get_session
        from db.models import LocationHistory, User
        from ai.tool_executor import execute_tool

        await init_db()
        user_id = str(uuid.uuid4())
        async with get_session() as db:
            db.add(User(
                id=user_id,
                username=f"phantom_i1_{user_id[:8]}",
                role="ROOT",
                pin_hash="x",
                rfid_uid_hash=None,
                preferences_json="{}",
            ))
            db.add_all([
                LocationHistory(
                    id=str(uuid.uuid4()), user_id=user_id, lat=0.0, lon=0.0,
                    source="gps", confidence=0.5,
                    place_name="Home",
                    timestamp=datetime.now(tz=timezone.utc),
                ),
                LocationHistory(
                    id=str(uuid.uuid4()), user_id=user_id, lat=0.0, lon=0.0,
                    source="gps", confidence=0.5,
                    place_name="Office",
                    timestamp=datetime.now(tz=timezone.utc),
                ),
            ])
            await db.commit()

        out = await execute_tool(
            "search_locationhistory",
            {"hours_ago": 24, "query": "%"},
            user_id=user_id,
        )
        assert out.get("ok") is True
        # With the escape, `%` becomes a literal — no place_name contains
        # a literal `%`, so the result is empty. Without the escape this
        # would have returned both Home + Office.
        assert out["count"] == 0, (
            "D2-S2 regression: ILIKE wildcards from the LLM widen the filter "
            "to a full-table scan."
        )
