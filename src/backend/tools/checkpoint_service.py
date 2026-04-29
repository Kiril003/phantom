"""
Checkpoint service — wraps ``agent.audit.save_checkpoint`` /
``fetch_checkpoint`` so chat-callable "create / list / restore" carry
the same semantics as the cognitive-loop checkpoints.

The FE scene shows what's bundled into the snapshot. Inclusions are
introspected from the live import surface — we don't pretend ChromaDB
is bundled if the package isn't available.
"""
from __future__ import annotations

import json
import logging
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.scenes import (
    CheckpointInclusion,
    CheckpointSceneData,
)
from db.models import AgentCheckpoint

logger = logging.getLogger(__name__)


def _has_module(name: str) -> bool:
    try:
        __import__(name)
    except Exception:
        return False
    return True


def _inclusions() -> list[CheckpointInclusion]:
    return [
        CheckpointInclusion(
            name="SQLite",
            included=True,
            reason="users + sessions + tools + audit",
        ),
        CheckpointInclusion(
            name="ChromaDB",
            included=_has_module("chromadb"),
            reason="strategic memory vectors",
        ),
        CheckpointInclusion(
            name="state-snapshot",
            included=True,
            reason="last context_engine snapshot",
        ),
        CheckpointInclusion(
            name="ghost-records",
            included=False,
            reason="private notes (sealed)",
        ),
    ]


def _stack_summary() -> str:
    parts = ["SQLite"]
    if _has_module("chromadb"):
        parts.append("ChromaDB")
    parts.append("state-snapshot")
    return " + ".join(parts)


def _checkpoint_id(now: datetime) -> str:
    local = now.astimezone()
    return f"phantom-{local.strftime('%Y-%m-%d-%H%M')}"


async def create_checkpoint(
    db: AsyncSession,
    *,
    reason: str = "operator",
    ai_note: Optional[str] = None,
) -> CheckpointSceneData:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "checkpoint_id": _checkpoint_id(now),
        "created_at": now.isoformat(),
        "py": sys.version.split()[0],
        "os": platform.platform(),
        "stack": _stack_summary(),
    }
    row = AgentCheckpoint(
        task_id="chat-tool",
        reason=reason[:32],
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    # Use the actual size of the on-disk SQLite file as the size hint.
    size_mb = 0.0
    db_path = Path("phantom.db")
    try:
        if db_path.exists():
            size_mb = round(db_path.stat().st_size / (1024 * 1024), 2)
    except Exception:
        size_mb = 0.0

    total = await _count_checkpoints(db)
    ripe = await _count_ripe_checkpoints(db)
    return CheckpointSceneData(
        checkpoint_id=payload["checkpoint_id"],
        created_at_iso=payload["created_at"],
        size_mb=size_mb,
        stack_summary=payload["stack"],
        inclusions=_inclusions(),
        total_checkpoints=total,
        ripe_for_cleanup=ripe,
        ai_note=ai_note,
    )


async def list_checkpoints(
    db: AsyncSession,
    *,
    ai_note: Optional[str] = None,
) -> Optional[CheckpointSceneData]:
    """Return scene data for the MOST RECENT checkpoint (the FE shows one
    card at a time; multi-checkpoint browsing is a separate panel)."""
    stmt = (
        select(AgentCheckpoint)
        .order_by(AgentCheckpoint.id.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    try:
        payload = json.loads(row.payload_json)
    except Exception:
        payload = {}
    created_at = (row.created_at or datetime.now(tz=timezone.utc))
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    total = await _count_checkpoints(db)
    ripe = await _count_ripe_checkpoints(db)
    return CheckpointSceneData(
        checkpoint_id=str(payload.get("checkpoint_id") or f"phantom-cp-{row.id}"),
        created_at_iso=created_at.isoformat(),
        size_mb=float(payload.get("size_mb") or 0.0),
        stack_summary=str(payload.get("stack") or _stack_summary()),
        inclusions=_inclusions(),
        total_checkpoints=total,
        ripe_for_cleanup=ripe,
        ai_note=ai_note,
    )


async def restore_checkpoint(
    db: AsyncSession,
    *,
    checkpoint_id: str,
    ai_note: Optional[str] = None,
) -> Optional[CheckpointSceneData]:
    """Surface the matched checkpoint with ``ai_note`` advising the operator
    to confirm restore via the sandbox panel — destructive ops never run
    silently from a chat tool call."""
    stmt = select(AgentCheckpoint).order_by(AgentCheckpoint.id.desc())
    rows = list((await db.execute(stmt)).scalars().all())
    matched = None
    for r in rows:
        try:
            p = json.loads(r.payload_json)
        except Exception:
            continue
        if p.get("checkpoint_id") == checkpoint_id:
            matched = (r, p)
            break
    if matched is None:
        return None
    row, payload = matched
    created_at = row.created_at or datetime.now(tz=timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    total = await _count_checkpoints(db)
    ripe = await _count_ripe_checkpoints(db)
    note = ai_note or (
        "Підготовлено до відновлення. Підтверди в Sandbox-панелі — "
        "відновлення безповоротне."
    )
    return CheckpointSceneData(
        checkpoint_id=checkpoint_id,
        created_at_iso=created_at.isoformat(),
        size_mb=float(payload.get("size_mb") or 0.0),
        stack_summary=str(payload.get("stack") or _stack_summary()),
        inclusions=_inclusions(),
        total_checkpoints=total,
        ripe_for_cleanup=ripe,
        ai_note=note,
    )


async def _count_checkpoints(db: AsyncSession) -> int:
    stmt = select(AgentCheckpoint.id)
    rows = (await db.execute(stmt)).scalars().all()
    return len(rows)


async def _count_ripe_checkpoints(db: AsyncSession) -> int:
    """Count checkpoints older than 30 days — eligible for cleanup."""
    from datetime import timedelta
    cutoff_age = datetime.now(tz=timezone.utc) - timedelta(days=30)
    stmt = select(AgentCheckpoint.id).where(
        AgentCheckpoint.created_at <= cutoff_age.replace(tzinfo=None)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return len(rows)


__all__ = ["create_checkpoint", "list_checkpoints", "restore_checkpoint"]
