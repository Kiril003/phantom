"""Phase 17a — chat tool dispatcher (audit-2026-04-28 F-01 enablement).

Day-2 H-5 collapses the parallel implementation that used to live here:
``chat_tool_dispatcher`` is now a thin envelope-translating shim over
``ai.tool_executor``. The handlers in ``tool_executor`` are the single
source of truth for tool behavior; this test file verifies:

* the dispatcher's public API (``dispatch``, ``supported_tools``, ``_HANDLERS``)
* envelope translation (tool_executor `{ok, ...payload}` → chat
  `{ok, name, result, elapsed_ms}`, error path likewise)
* delegation contract — dispatch ACTUALLY calls execute_tool with the
  same name & args the LLM passed (no silent name remap)
* per-tool behavior remains correct end-to-end, asserted through the
  dispatcher (so the integration with the consolidated executor is
  guarded against regressions)
* config defaults stay concept-aligned (chat grounding on, limits sane)

Tool-shape assertions live in test_phase10_tool_use.py — the canonical
home for ``tool_executor`` behavior. We don't duplicate them here.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest


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
                username=f"pytest_phase17a_{user_id[:8]}",
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

    def test_mutating_tools_are_now_available_but_policy_gated(self):
        from ai.chat_tool_dispatcher import supported_tools

        names = set(supported_tools())
        # The Sentient Familiar concept expects PHANTOM to be capable of
        # acting, while the tactical/proactive planners decide when to ask.
        assert "search_web" in names
        assert "create_calendar_event" in names
        assert "get_calendar_events" in names


# ── Day-2 H-5 — delegation + drift contract ───────────────────────────────────


class TestDelegationContract:
    """Day-2 D2-A5 closure: every chat-safe tool must funnel through
    `tool_executor.execute_tool` so a single bug-fix or security patch
    propagates everywhere. These tests freeze the contract."""

    @pytest.mark.asyncio
    async def test_dispatch_calls_execute_tool_with_same_name(
        self, authed_user_and_db, monkeypatch
    ):
        from ai import chat_tool_dispatcher  # noqa: F401  (reset after)
        captured: dict = {}

        async def _fake_execute(name, args, user_id, *, timeout_s=None):  # noqa: ARG001
            captured["name"] = name
            captured["args"] = args
            captured["user_id"] = user_id
            return {"ok": True, "results": ["from-execute_tool"]}

        monkeypatch.setattr("ai.tool_executor.execute_tool", _fake_execute)

        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch(
            "search_locationhistory",
            {"hours_ago": 12},
            user_id=user_id,
            db=db,
        )
        assert out["ok"] is True
        assert out["name"] == "search_locationhistory"
        # Envelope stripped: payload only.
        assert out["result"] == {"results": ["from-execute_tool"]}
        assert captured == {
            "name": "search_locationhistory",
            "args": {"hours_ago": 12},
            "user_id": user_id,
        }

    @pytest.mark.asyncio
    async def test_executor_error_envelope_translates_to_ok_false(
        self, authed_user_and_db, monkeypatch
    ):
        async def _fake_execute(name, args, user_id, *, timeout_s=None):  # noqa: ARG001
            return {"error": "synthetic boom", "error_kind": "exception"}

        monkeypatch.setattr("ai.tool_executor.execute_tool", _fake_execute)

        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch(
            "search_locationhistory", {}, user_id=user_id, db=db
        )
        assert out["ok"] is False
        assert "synthetic boom" in out["error"]
        assert out["name"] == "search_locationhistory"

    def test_no_handler_drift_with_executor(self):
        # Drift detector for D2-A5: every name in the dispatcher's
        # catalog must exist in tool_executor's `_HANDLERS`. Adding a
        # chat-only tool here without first wiring tool_executor (or
        # vice versa) breaks the consolidated invariant.
        from ai.chat_tool_dispatcher import _HANDLERS as CHAT_HANDLERS
        from ai.tool_executor import _HANDLERS as EXEC_HANDLERS

        chat_names = set(CHAT_HANDLERS.keys())
        exec_names = set(EXEC_HANDLERS.keys())
        missing = chat_names - exec_names
        assert not missing, (
            f"D2-A5 drift: chat dispatcher exposes tools that tool_executor "
            f"does NOT implement → split-brain risk: {sorted(missing)}"
        )


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
    async def test_handler_exception_does_not_propagate(
        self, authed_user_and_db, monkeypatch
    ):
        # Replace one delegate with a raising stub. dispatch must
        # capture and report ok=False without unwinding the stack.
        from ai.chat_tool_dispatcher import dispatch
        from ai import chat_tool_dispatcher as ctd

        async def _boom(**_kw):
            raise RuntimeError("synthetic")

        monkeypatch.setitem(ctd._HANDLERS, "search_locationhistory", _boom)
        user_id, db = authed_user_and_db
        out = await dispatch(
            "search_locationhistory", {}, user_id=user_id, db=db
        )
        assert out["ok"] is False
        assert "synthetic" in out["error"]


# ── Per-tool behavior (asserted through dispatch + tool_executor) ─────────────


class TestSearchLocationHistoryThroughDispatcher:
    @pytest.mark.asyncio
    async def test_returns_rows_for_recent_visits(self, authed_user_and_db):
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
        # tool_executor envelope-stripped: result is `{"results": [...], "count": N}`.
        result = out["result"]
        assert "results" in result
        names = {r["place_name"] for r in result["results"]}
        # Distinct place names should be {Place 0, Place 1, Place 2} regardless
        # of grouping — the chat-friendly view is "what places, in this window".
        assert names == {"Place 0", "Place 1", "Place 2"}

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
        names = {r["place_name"] for r in out["result"]["results"]}
        assert "VSB Technical University" in names
        assert "Home" not in names

    @pytest.mark.asyncio
    async def test_hours_ago_clamped_to_safe_window(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, _ = authed_user_and_db
        from db.database import get_session
        async with get_session() as db:
            # Should not error on absurd values — tool_executor clamps to 1..720.
            out = await dispatch(
                "search_locationhistory",
                {"hours_ago": 999_999},
                user_id=user_id,
                db=db,
            )
        assert out["ok"] is True


class TestQueryTemporalAnchorsThroughDispatcher:
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
        rows = out["result"]["results"]
        assert len(rows) == 2
        assert all(r["state"] == "FOCUS" for r in rows)
        # Most recent first.
        assert rows[0]["activity_summary"] == "more code"


class TestRecallMemoryFactsThroughDispatcher:
    @pytest.mark.asyncio
    async def test_empty_query_is_invalid_args_error(self, authed_user_and_db):
        # Day-2 H-5 — tool_executor enforces a non-empty query (defence
        # against injection-by-empty in F-11). The chat path inherits
        # that contract via delegation: empty `query` becomes
        # ok=False/invalid_args rather than a silent empty list.
        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch("recall_memory_facts", {}, user_id=user_id, db=db)
        assert out["ok"] is False
        assert "invalid_args" in out["error"]

    @pytest.mark.asyncio
    async def test_returns_chroma_hits_with_layer_metadata(
        self, authed_user_and_db, monkeypatch
    ):
        # tool_executor's _tool_recall_memory_facts wraps each hit in
        # {content, layer, source}. Delegation must surface that shape
        # so the LLM can quote provenance back to the user.
        from ai.chat_tool_dispatcher import dispatch

        async def _fake_retrieve(*, user_id, query, **_kw):  # noqa: ARG001
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
        results = out["result"]["results"]
        contents = [r["content"] for r in results]
        assert "fact-A" in contents and "fact-B" in contents
        # Each hit must carry layer provenance so the audit/output-
        # safety classifier can decide whether to surface it.
        assert all("layer" in r for r in results)


class TestGetSystemMetricsThroughDispatcher:
    @pytest.mark.asyncio
    async def test_returns_live_metrics_shape(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch("get_system_metrics", {}, user_id=user_id, db=db)
        assert out["ok"] is True
        m = out["result"]
        # tool_executor's metrics shape — short keys, percent-as-float.
        for key in (
            "cpu_pct", "ram_pct", "ram_used_mb", "ram_total_mb",
            "disk_pct", "disk_used_gb", "disk_total_gb",
            "uptime_sec", "load_1min", "load_5min", "load_15min",
        ):
            assert key in m, f"metrics missing {key}"
        assert m["uptime_sec"] >= 0
        assert 0.0 <= m["ram_pct"] <= 100.0


class TestGetSensorStatusThroughDispatcher:
    @pytest.mark.asyncio
    async def test_returns_snapshot_summary(self, authed_user_and_db):
        from ai.chat_tool_dispatcher import dispatch

        user_id, db = authed_user_and_db
        out = await dispatch("get_sensor_status", {}, user_id=user_id, db=db)
        assert out["ok"] is True
        s = out["result"]
        # tool_executor's sensor snapshot — radar/camera/environment/gps/battery.
        for key in ("radar", "camera", "environment", "gps", "battery"):
            assert key in s, f"sensor snapshot missing {key}"
        assert "fix" in s["gps"]


# ── Config defaults ───────────────────────────────────────────────────────────


class TestPhase17aConfigDefaults:
    def test_chat_tools_enabled_default_off_for_plain_chat(self):
        from config import PhantomConfig
        assert PhantomConfig.model_fields["chat_tools_enabled"].default is False

    def test_chat_response_widgets_default_off(self):
        from config import PhantomConfig
        assert (
            PhantomConfig.model_fields["chat_response_widgets_enabled"].default
            is False
        )

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
