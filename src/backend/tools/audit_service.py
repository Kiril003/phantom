"""
Audit service — projects ``AgentAuditEntry`` rows into the FE's
audit scene card.

The agent audit table is shared with phase-9 cognitive runs; this
adapter:

* picks the last N rows in the requested time window
* maps ``risk_level`` and ``error`` presence to one of {ok, retry, fail}
* computes a deterministic 8-char trace_id from the newest row id so
  the FE renders a stable mono hash for the operator to grep with.

Tool calls performed by the chat loop ALSO append into this table via
``record_tool_invocation`` (called by ``tool_executor``); that keeps
chat-tool history and agent-action history on a single timeline.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from hashlib import blake2s
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.scenes import (
    AuditSceneCounts,
    AuditSceneData,
    AuditSceneEvent,
)
from db.database import get_session
from db.models import AgentAuditEntry

logger = logging.getLogger(__name__)


def _ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _status_for(row: AgentAuditEntry) -> str:
    """Map the row to an audit chip state.

    The agent audit row has no explicit "ok" flag — the convention used by
    the cognitive runtime is: ``risk_level >= 3 AND error in result_json``
    → fail, ``retried_from is not None`` → retry, else → ok.
    """
    try:
        res = json.loads(row.result_json or "{}")
    except Exception:
        res = {}
    if (row.risk_level or 0) >= 3 and (res.get("error") or res.get("error_kind")):
        return "fail"
    if res.get("error_kind") in ("timeout",):
        return "fail"
    if res.get("error") or res.get("error_kind"):
        return "retry" if row.retried_from is None else "retry"
    if row.retried_from is not None:
        return "retry"
    return "ok"


def _duration_display(ms: int) -> str:
    if ms < 1000:
        return f"{ms}ms"
    return f"{ms / 1000:.1f}s"


def _trace_id_for(rows: list[AgentAuditEntry]) -> str:
    """Stable short hash for the audit window — operator grep handle."""
    seed = ",".join(str(r.id) for r in rows[:5]) or datetime.now(tz=timezone.utc).isoformat()
    return blake2s(seed.encode("utf-8"), digest_size=4).hexdigest()


async def recent_audit(
    db: AsyncSession,
    *,
    minutes_ago: int = 20,
    limit: int = 10,
) -> AuditSceneData:
    if minutes_ago <= 0:
        raise ValueError("minutes_ago must be > 0")
    minutes_ago = min(minutes_ago, 60 * 24 * 30)
    limit = max(1, min(limit, 50))
    cutoff = datetime.now(tz=timezone.utc) - timedelta(minutes=minutes_ago)

    stmt = (
        select(AgentAuditEntry)
        .where(AgentAuditEntry.timestamp >= cutoff.replace(tzinfo=None))
        .order_by(AgentAuditEntry.timestamp.desc())
        .limit(limit)
    )
    rows = list((await db.execute(stmt)).scalars().all())

    events: list[AuditSceneEvent] = []
    counts = {"ok": 0, "retry": 0, "fail": 0}
    for row in rows:
        ts = row.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        local = ts.astimezone()
        status = _status_for(row)
        counts[status] += 1
        # Pull a one-line text — prefer the intent field, else action_name.
        text_blob = (row.intent or row.action_name or "").strip()
        if len(text_blob) > 120:
            text_blob = text_blob[:117] + "..."
        events.append(
            AuditSceneEvent(
                event_id=str(row.id),
                time_display=local.strftime("%H:%M"),
                ts_ms=_ms(ts),
                tool=row.action_name,
                status=status,  # type: ignore[arg-type]
                text=text_blob or row.action_name,
                duration_display=_duration_display(int(row.elapsed_ms or 0)),
                duration_ms=int(row.elapsed_ms or 0),
            )
        )

    return AuditSceneData(
        window_display=f"LAST {minutes_ago}m",
        total_actions=len(rows),
        events=events,
        counts=AuditSceneCounts(**counts),
        trace_id=_trace_id_for(rows),
    )


async def record_tool_invocation(
    *,
    actor_user_id: str,
    tool_name: str,
    args_snippet: str,
    intent: Optional[str],
    duration_ms: int,
    outcome: str,
    error: Optional[str] = None,
) -> int:
    """Append a tool_executor event to the agent audit log.

    ``outcome`` ∈ {ok, retry, fail} — mapped to ``risk_level`` so
    ``recent_audit`` can re-derive the same chip later. We use a synthetic
    ``task_id="chat-tool"`` so chat-tool history stays out of the agent
    cognitive task index.
    """
    risk_level = {"ok": 1, "retry": 2, "fail": 3}.get(outcome, 1)
    result_obj = {"ok": outcome == "ok"}
    if error:
        result_obj["error"] = error
        result_obj["error_kind"] = outcome
    entry = AgentAuditEntry(
        task_id="chat-tool",
        step_idx=0,
        # `user_id` became a NOT NULL FK when agent_audit went multi-user, and
        # this writer was not updated with it — the actor was only ever stashed
        # in `sub_goal_id`. Every insert therefore violated the constraint and
        # the `except` below swallowed it at debug level, so the chat-tool audit
        # log was silently empty. `sub_goal_id` stays for backwards compatibility
        # with rows already written that way.
        user_id=actor_user_id,
        sub_goal_id=actor_user_id,
        action_name=tool_name[:64],
        args_json=args_snippet[:4000],
        intent=(intent or "")[:1024] or None,
        monologue_json=None,
        result_json=json.dumps(result_obj, ensure_ascii=False),
        risk_level=risk_level,
        elapsed_ms=int(duration_ms),
        retried_from=None,
    )
    try:
        async with get_session() as db:
            db.add(entry)
            await db.flush()
            return int(entry.id)
    except Exception as exc:  # noqa: BLE001
        # Audit must NEVER block the tool call — return -1 so callers know the
        # entry didn't persist. WARNING, not debug: this path stayed broken for
        # an entire schema migration precisely because nobody saw it at debug.
        # A gap in the audit trail is an operator-visible event.
        logger.warning("record_tool_invocation failed: %s", exc)
        return -1


__all__ = ["recent_audit", "record_tool_invocation"]
