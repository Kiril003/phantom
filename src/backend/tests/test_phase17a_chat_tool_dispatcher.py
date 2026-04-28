"""Phase 17a — chat tool dispatcher (audit-2026-04-28 F-01 enablement).

Builds the dispatcher table that Phase 17b's call_with_tools loop
consumes. This commit ships handlers for the 5 read-only tools; the
3 deferred tools (search_web, get_calendar_events, create_calendar_event)
land later with their own security review.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select


@pytest.fixture()
async def authed_user_and_db():
    """Provide a fresh User row + a live AsyncSession bound to the test DB."""
    from db.database import init_db, get_session
    from db.models import User

    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        db.add(
            User(
                id=user_id,
                username=f"phase17a_user_{user_id[:8]}",
                role="ROOT",
                pin_hash="x",
                rfid_uid_hash=None,
                preferences_json="{}",
            )
        )
        await db.commit()
    async with get_session() as db:
        yield user_id, db


# ── Public API surface ────────────────────────────────────────────────────────


class TestSupportedToolsContract:
    def test_supported_tools_includes_phase17a_set(self):
        from ai.chat_tool_dispatcher import supported_tools

        names = set(supported_tools())
        assert {
            "search_locationhistory",
            "query_temporal_anchors",
            "recall_memory_facts",
            "get_system_metrics",
            "get_sensor_status",
        }.issubset(names)

    def test_deferred_tools_not_advertised(self):
        from ai.chat_tool_dispatcher import supported_tools

        names = set(supported_tools())
        # Until Phase 17b ships handlers for these, dispatch returns
        # `unknown_tool`. Don't advertise them via supported_tools so
        # the future call_with_tools wiring filters them out cleanly.
        assert "search_web" not in names
        assert "create_calendar_event" not in names
        assert "get_calendar_events" not in names


# ── Error paths ───────────────────────────────────────────────────────────────


class TestDispatchErrorShape:
    @pytest.mark.asyncio
    async def test_unknown_tool_returns_ok_false(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch("does_not_exist", {}, user_id=user_id, db=db)
        assert out["ok"] is False
        assert "unknown_tool" in out["error"]
        assert out["name"] == "does_not_exist"
        assert isinstance(out["elapsed_ms"], int)

    @pytest.mark.asyncio
    async def test_handler_exception_does_not_propagate(self, authed_user_and_db, monkeypatch):
        # Force search_locationhistory to raise on the SQLAlchemy import
        # path. dispatch must capture and return ok=False.
        from ai.chat_tool_dispatcher import dispatch
        from ai import chat_tool_dispatcher as ctd

        async def _boom(**_kw):
            raise RuntimeError("synthetic")

        monkeypatch.setitem(ctd._HANDLERS, "search_locationhistory", _boom)
        user_id, db = authed_user_and_db
        out = await dispatch("search_locationhistory", {}, user_id=user_id, db=db)
        assert out["ok"] is False
        assert "synthetic" in out["error"]


# ── Handlers ──────────────────────────────────────────────────────────────────


class TestSearchLocationHistory:
    @pytest.mark.asyncio
    async def test_returns_distinct_places_in_window(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch
        from db.database import get_session
        from db.models import LocationHistory

        user_id, _ = authed_user_and_db
        now = datetime.now(tz=timezone.utc)
        rows = [
            LocationHistory(
                id=str(uuid.uuid4()),
                user_id=user_id,
                lat=48.45 + 0.001 * i,
                lon=35.02,
                source="gps",
                confidence=0.9,
                place_name=f"Place {i % 3}",
                city="Dnipro",
                country="UA",
                country_code="UA",
                timestamp=now - timedelta(hours=i),
            )
            for i in range(6)
        ]
        async with get_session() as db:
            db.add_all(rows)
            await db.commit()

        async with get_session() as db:
            out = await dispatch(
                "search_locationhistory",
                {"hours_ago": 24},
                user_id=user_id,
                db=db,
            )

        assert out["ok"] is True
        result = out["result"]
        names = {r["place_name"] for r in result}
        assert names == {"Place 0", "Place 1", "Place 2"}, (
            "search_locationhistory should collapse same-place rows"
        )

    @pytest.mark.asyncio
    async def test_query_substring_filter(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch
        from db.database import get_session
        from db.models import LocationHistory

        user_id, _ = authed_user_and_db
        async with get_session() as db:
            db.add_all([
                LocationHistory(
                    id=str(uuid.uuid4()), user_id=user_id, lat=0.0, lon=0.0,
                    source="gps", confidence=0.5,
                    place_name="VSB Technical University",
                    timestamp=datetime.now(tz=timezone.utc),
                ),
                LocationHistory(
                    id=str(uuid.uuid4()), user_id=user_id, lat=0.0, lon=0.0,
                    source="gps", confidence=0.5,
                    place_name="Home",
                    timestamp=datetime.now(tz=timezone.utc),
                ),
            ])
            await db.commit()

        async with get_session() as db:
            out = await dispatch(
                "search_locationhistory",
                {"hours_ago": 24, "query": "VSB"},
                user_id=user_id,
                db=db,
            )

        assert out["ok"] is True
        names = {r["place_name"] for r in out["result"]}
        assert "VSB Technical University" in names
        assert "Home" not in names

    @pytest.mark.asyncio
    async def test_hours_ago_clamped_to_safe_window(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, _ = authed_user_and_db
        from db.database import get_session
        async with get_session() as db:
            # Should not error on absurd values — clamps to 1..720.
            out = await dispatch(
                "search_locationhistory",
                {"hours_ago": 999_999},
                user_id=user_id,
                db=db,
            )
        assert out["ok"] is True


class TestQueryTemporalAnchors:
    @pytest.mark.asyncio
    async def test_filters_by_state_and_returns_recent_first(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch
        from db.database import get_session
        from db.models import TemporalAnchor

        user_id, _ = authed_user_and_db
        now = datetime.now(tz=timezone.utc)
        async with get_session() as db:
            db.add_all([
                TemporalAnchor(
                    id=str(uuid.uuid4()), user_id=user_id,
                    timestamp=now - timedelta(hours=2),
                    state="FOCUS", mood="calm focused",
                    activity_summary="working on code",
                ),
                TemporalAnchor(
                    id=str(uuid.uuid4()), user_id=user_id,
                    timestamp=now - timedelta(hours=1),
                    state="DIALOGUE", mood="engaged",
                    activity_summary="talking with user",
                ),
                TemporalAnchor(
                    id=str(uuid.uuid4()), user_id=user_id,
                    timestamp=now - timedelta(minutes=30),
                    state="FOCUS", mood="calm",
                    activity_summary="more code",
                ),
            ])
            await db.commit()

        async with get_session() as db:
            out = await dispatch(
                "query_temporal_anchors",
                {"state": "FOCUS"},
                user_id=user_id,
                db=db,
            )
        assert out["ok"] is True
        rows = out["result"]
        assert len(rows) == 2
        assert all(r["state"] == "FOCUS" for r in rows)
        # Most recent first.
        assert rows[0]["activity_summary"] == "more code"


class TestRecallMemoryFacts:
    @pytest.mark.asyncio
    async def test_empty_query_returns_empty(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch("recall_memory_facts", {}, user_id=user_id, db=db)
        assert out["ok"] is True
        assert out["result"] == []

    @pytest.mark.asyncio
    async def test_calls_strategic_memory(self, authed_user_and_db, monkeypatch):
        from ai.chat_tool_dispatcher import dispatch

        captured = {}

        async def _fake_retrieve(*, user_id, query, **_kw):  # noqa: ARG001
            captured["q"] = query
            return ["fact-A", "fact-B"]

        monkeypatch.setattr(
            "memory.strategic_memory.retrieve_relevant", _fake_retrieve
        )
        user_id, db = authed_user_and_db
        out = await dispatch(
            "recall_memory_facts",
            {"query": "робота"},
            user_id=user_id,
            db=db,
        )
        assert out["ok"] is True
        assert out["result"] == ["fact-A", "fact-B"]
        assert captured["q"] == "робота"


class TestGetSystemMetrics:
    @pytest.mark.asyncio
    async def test_returns_live_metrics_shape(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch("get_system_metrics", {}, user_id=user_id, db=db)
        assert out["ok"] is True
        m = out["result"]
        for key in (
            "cpu_percent", "ram_percent", "ram_available_mb", "ram_total_mb",
            "disk_percent", "disk_free_gb", "uptime_s",
            "load_avg_1m", "load_avg_5m", "load_avg_15m",
        ):
            assert key in m, f"metrics missing {key}"
        assert m["uptime_s"] >= 0
        assert 0.0 <= m["ram_percent"] <= 100.0


class TestGetSensorStatus:
    @pytest.mark.asyncio
    async def test_returns_snapshot_summary(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch("get_sensor_status", {}, user_id=user_id, db=db)
        assert out["ok"] is True
        s = out["result"]
        assert "presence" in s and "body" in s
        assert "where" in s and "env" in s
        assert "system" in s
        assert "state" in s["system"]


# ── Config defaults ───────────────────────────────────────────────────────────


class TestPhase17aConfigDefaults:
    def test_chat_tools_enabled_default_off(self):
        from config import PhantomConfig
        assert PhantomConfig.model_fields["chat_tools_enabled"].default is False

    def test_locationhistory_limit_default_reasonable(self):
        from config import PhantomConfig
        n = PhantomConfig.model_fields["chat_tool_locationhistory_limit"].default
        assert 5 <= n <= 100

    def test_max_calls_per_turn_default_low(self):
        from config import PhantomConfig
        n = PhantomConfig.model_fields["chat_tool_max_calls_per_turn"].default
        # Must be ≥ 1 (otherwise tool-use is disabled even when flag is on)
        # and ≤ 8 (otherwise depth-cap from F-11 prompt-injection threat
        # model is too lenient).
        assert 1 <= n <= 8
