"""Tier-C I-4 — Day-2 D2-R1 + D2-R3 audit-log columns for chat tools.

Phase 16 added per-chat-turn observability columns on `ai_tool_use_log`
(`prompt_excerpt`, `response_excerpt`, `prompt_sections`, `user_id`)
gated on `chat_prompt_logging_enabled`. The Day-2 audit threat-model
flagged two gaps for the chat-tool path specifically:

* **D2-R1** — there's no record of *what the LLM asked for* on a
  per-tool basis. Without `tool_args_json` an operator reviewing a
  prompt-injection incident has to reconstruct the LLM's intent from
  the chat log. Without `tool_result_summary` per-tool latency or
  error dashboards have to re-run the dispatcher.
* **D2-R3** — chat-tool rows must always carry `user_id`, regardless
  of the `chat_prompt_logging_enabled` gate. Otherwise per-tenant
  audit queries silently lose chat-tool incidents.

This file pins:
1. `005_chat_tool_audit.py` migration adds the two columns idempotently.
2. `tool_use_audit.write_log` accepts and persists them.
3. `chat_tool_dispatcher.dispatch` writes one row per attempt, with
   `user_id` populated unconditionally and the args + summary fields
   filled in.
"""

from __future__ import annotations

import json
import uuid

import pytest


@pytest.fixture()
async def fresh_db_user():
    from db.database import init_db, get_session
    from db.models import User
    await init_db()
    user_id = str(uuid.uuid4())
    async with get_session() as db:
        db.add(User(
            id=user_id,
            username=f"phantom_i4_{user_id[:8]}",
            role="ROOT",
            pin_hash="x",
            rfid_uid_hash=None,
            preferences_json="{}",
        ))
        await db.commit()
    async with get_session() as db:
        yield user_id, db


# ── D2-R1 — schema columns + ORM presence ─────────────────────────────────────


class TestD2R1Schema:
    @pytest.mark.asyncio
    async def test_migration_adds_tool_args_and_result_columns(self):
        from db.database import init_db, engine

        await init_db()
        from sqlalchemy import text
        async with engine.connect() as conn:
            res = await conn.execute(text("PRAGMA table_info(ai_tool_use_log)"))
            cols = {row[1] for row in res.fetchall()}
        assert "tool_args_json" in cols, (
            "D2-R1 regression: migration 005 did NOT add tool_args_json"
        )
        assert "tool_result_summary" in cols, (
            "D2-R1 regression: migration 005 did NOT add tool_result_summary"
        )

    def test_orm_model_exposes_new_columns(self):
        from db.models import AiToolUseLog
        cols = {c.name for c in AiToolUseLog.__table__.columns}
        assert "tool_args_json" in cols
        assert "tool_result_summary" in cols

    @pytest.mark.asyncio
    async def test_write_log_persists_new_fields(self, fresh_db_user):
        from ai.tool_use_audit import write_log
        from db.database import get_session
        from db.models import AiToolUseLog
        from sqlalchemy import select

        user_id, _ = fresh_db_user
        row_id = await write_log(
            task_id=None,
            step_idx=None,
            provider="chat",
            model="",
            tool_name="search_locationhistory",
            success=True,
            error_kind=None,
            error_message=None,
            elapsed_ms=12,
            retry_count=1,
            user_id=user_id,
            tool_args_json='{"hours_ago": 24}',
            tool_result_summary="ok rows=3",
        )
        assert isinstance(row_id, int)

        async with get_session() as db:
            row = (await db.execute(
                select(AiToolUseLog).where(AiToolUseLog.id == row_id)
            )).scalar_one()
        assert row.tool_args_json == '{"hours_ago": 24}'
        assert row.tool_result_summary == "ok rows=3"

    @pytest.mark.asyncio
    async def test_write_log_truncates_long_args_and_summary(self, fresh_db_user):
        from ai.tool_use_audit import write_log
        from db.database import get_session
        from db.models import AiToolUseLog
        from sqlalchemy import select

        user_id, _ = fresh_db_user
        long_args = '{"q":"' + "x" * 5000 + '"}'
        long_summary = "ok " + "x" * 1000
        row_id = await write_log(
            task_id=None,
            step_idx=None,
            provider="chat",
            model="",
            tool_name="recall_memory_facts",
            success=True,
            error_kind=None,
            error_message=None,
            elapsed_ms=8,
            retry_count=1,
            user_id=user_id,
            tool_args_json=long_args,
            tool_result_summary=long_summary,
        )
        async with get_session() as db:
            row = (await db.execute(
                select(AiToolUseLog).where(AiToolUseLog.id == row_id)
            )).scalar_one()
        # Bound: args ≤ 1000, summary ≤ 200.
        assert len(row.tool_args_json) <= 1000
        assert len(row.tool_result_summary) <= 200


# ── D2-R3 — dispatcher writes one row, user_id always set ─────────────────────


class TestD2R3DispatcherAuditWrites:
    @pytest.mark.asyncio
    async def test_dispatch_writes_audit_row_on_success(
        self, fresh_db_user, monkeypatch
    ):
        from ai import chat_tool_dispatcher as ctd
        from db.database import get_session
        from db.models import AiToolUseLog
        from sqlalchemy import select

        user_id, db = fresh_db_user

        async def _instant(**_kw):
            return {"ok": True, "results": [{"x": 1}, {"x": 2}], "count": 2}

        monkeypatch.setitem(ctd._HANDLERS, "search_locationhistory", _instant)

        out = await ctd.dispatch(
            "search_locationhistory",
            {"hours_ago": 6},
            user_id=user_id,
            db=db,
        )
        assert out["ok"] is True

        async with get_session() as db2:
            rows = (await db2.execute(
                select(AiToolUseLog)
                .where(AiToolUseLog.tool_name == "search_locationhistory")
                .where(AiToolUseLog.user_id == user_id)
                .order_by(AiToolUseLog.id.desc())
                .limit(1)
            )).scalars().all()

        assert len(rows) == 1, (
            "D2-R3 regression: dispatch did not write an audit row"
        )
        row = rows[0]
        # D2-R3 — user_id is ALWAYS set, no logging-flag gate.
        assert row.user_id == user_id
        assert row.success is True
        assert row.provider == "chat"
        # D2-R1 — args + summary populated.
        assert row.tool_args_json is not None
        assert json.loads(row.tool_args_json) == {"hours_ago": 6}
        assert "rows=2" in (row.tool_result_summary or "")

    @pytest.mark.asyncio
    async def test_dispatch_writes_audit_row_on_unknown_tool(
        self, fresh_db_user
    ):
        from ai.chat_tool_dispatcher import dispatch
        from db.database import get_session
        from db.models import AiToolUseLog
        from sqlalchemy import select

        user_id, db = fresh_db_user

        out = await dispatch("does_not_exist", {"a": 1}, user_id=user_id, db=db)
        assert out["ok"] is False

        async with get_session() as db2:
            row = (await db2.execute(
                select(AiToolUseLog)
                .where(AiToolUseLog.tool_name == "does_not_exist")
                .where(AiToolUseLog.user_id == user_id)
                .order_by(AiToolUseLog.id.desc())
                .limit(1)
            )).scalar_one_or_none()

        assert row is not None, (
            "D2-R3 regression: dispatch did not audit the unknown-tool path"
        )
        assert row.user_id == user_id
        assert row.success is False
        assert "unknown_tool" in (row.error_kind or "")

    @pytest.mark.asyncio
    async def test_dispatch_writes_audit_row_on_handler_exception(
        self, fresh_db_user, monkeypatch
    ):
        from ai import chat_tool_dispatcher as ctd
        from db.database import get_session
        from db.models import AiToolUseLog
        from sqlalchemy import select

        user_id, db = fresh_db_user

        async def _boom(**_kw):
            raise RuntimeError("synthetic")

        monkeypatch.setitem(ctd._HANDLERS, "search_locationhistory", _boom)

        out = await ctd.dispatch(
            "search_locationhistory", {}, user_id=user_id, db=db
        )
        assert out["ok"] is False

        async with get_session() as db2:
            row = (await db2.execute(
                select(AiToolUseLog)
                .where(AiToolUseLog.tool_name == "search_locationhistory")
                .where(AiToolUseLog.user_id == user_id)
                .order_by(AiToolUseLog.id.desc())
                .limit(1)
            )).scalar_one_or_none()

        assert row is not None
        assert row.user_id == user_id
        assert row.success is False
        # error_kind is the head of the dispatcher's "<Type>: <msg>" string.
        assert row.error_kind in ("RuntimeError", "error")

    @pytest.mark.asyncio
    async def test_audit_failure_does_not_block_dispatch(
        self, fresh_db_user, monkeypatch
    ):
        # If write_log itself raises (DB blew up, etc.), dispatch must
        # still return a clean result. Audit is best-effort.
        from ai import chat_tool_dispatcher as ctd

        async def _instant(**_kw):
            return {"ok": True, "results": []}

        monkeypatch.setitem(ctd._HANDLERS, "search_locationhistory", _instant)

        async def _boom_write(**_kw):
            raise RuntimeError("audit DB melted")

        monkeypatch.setattr("ai.tool_use_audit.write_log", _boom_write)

        user_id, db = fresh_db_user
        out = await ctd.dispatch(
            "search_locationhistory", {}, user_id=user_id, db=db
        )
        assert out["ok"] is True, (
            "D2-R3 regression: dispatch let an audit-write failure "
            "propagate up — telemetry must never block the chat turn."
        )
