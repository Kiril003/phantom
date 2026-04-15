"""
PHANTOM OS — Tactical Memory (SQLite, 24-hour sliding window).
Stores medium-term facts that are relevant within a day.
Facts past the window are automatically promoted to strategic memory (ChromaDB)
or dropped if importance < threshold.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from config import config

logger = logging.getLogger(__name__)


async def store_fact(
    db: AsyncSession,
    user_id: str,
    session_id: str,
    content: str,
    category: str = "fact",
    importance: float = 0.5,
    decay_factor: float = 1.0,
) -> str:
    """
    Store a new MemoryFact in the tactical layer.
    Returns the new fact ID.
    """
    from db.models import MemoryFact

    fact_id = str(uuid.uuid4())
    fact = MemoryFact(
        id=fact_id,
        user_id=user_id,
        layer="tactical",
        category=category,
        content=content,
        importance=importance,
        source_session_id=session_id,
        decay_factor=decay_factor,
    )
    db.add(fact)
    await db.flush()
    return fact_id


async def get_recent_facts(
    db: AsyncSession,
    user_id: str,
    hours: int | None = None,
    limit: int = 50,
    min_importance: float = 0.0,
) -> list[dict[str, Any]]:
    """
    Retrieve non-sealed facts for user within the tactical window.
    Default window: config.memory_tactical_window_h (24h).
    """
    from db.models import MemoryFact

    window_h = hours if hours is not None else config.memory_tactical_window_h
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=window_h)

    stmt = (
        select(MemoryFact)
        .where(
            MemoryFact.user_id == user_id,
            MemoryFact.layer == "tactical",
            MemoryFact.is_sealed == False,  # noqa: E712
            MemoryFact.created_at >= cutoff,
            MemoryFact.importance >= min_importance,
        )
        .order_by(MemoryFact.importance.desc(), MemoryFact.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    facts = result.scalars().all()

    return [
        {
            "id": f.id,
            "content": f.content,
            "category": f.category,
            "importance": f.importance,
            "created_at": f.created_at.isoformat(),
            "access_count": f.access_count,
        }
        for f in facts
    ]


async def touch_fact(db: AsyncSession, fact_id: str) -> None:
    """Increment access_count and update accessed_at for a fact."""
    from db.models import MemoryFact

    result = await db.execute(select(MemoryFact).where(MemoryFact.id == fact_id))
    fact = result.scalar_one_or_none()
    if fact:
        fact.access_count += 1  # type: ignore[operator]
        fact.accessed_at = datetime.now(tz=timezone.utc)  # type: ignore[assignment]
        await db.flush()


async def promote_expired_facts(
    db: AsyncSession,
    user_id: str,
) -> list[dict[str, Any]]:
    """
    Find tactical facts older than the window that exceed the importance threshold.
    Returns them for the caller to promote to strategic memory, then deletes them.
    """
    from db.models import MemoryFact

    cutoff = datetime.now(tz=timezone.utc) - timedelta(
        hours=config.memory_tactical_window_h
    )
    stmt = (
        select(MemoryFact)
        .where(
            MemoryFact.user_id == user_id,
            MemoryFact.layer == "tactical",
            MemoryFact.is_sealed == False,  # noqa: E712
            MemoryFact.created_at < cutoff,
            MemoryFact.importance >= config.memory_importance_threshold,
        )
    )
    result = await db.execute(stmt)
    old_facts = result.scalars().all()

    promotable = [
        {
            "id": f.id,
            "content": f.content,
            "category": f.category,
            "importance": f.importance,
            "source_session_id": f.source_session_id,
        }
        for f in old_facts
    ]

    # Delete promoted facts from tactical layer
    if old_facts:
        fact_ids = [f.id for f in old_facts]
        await db.execute(
            delete(MemoryFact).where(MemoryFact.id.in_(fact_ids))
        )
        await db.flush()

    return promotable


async def prune_old_facts(db: AsyncSession, user_id: str) -> int:
    """
    Delete expired tactical facts below the importance threshold (no promotion).
    Returns number of deleted rows.
    """
    from db.models import MemoryFact

    cutoff = datetime.now(tz=timezone.utc) - timedelta(
        hours=config.memory_tactical_window_h
    )
    result = await db.execute(
        delete(MemoryFact).where(
            MemoryFact.user_id == user_id,
            MemoryFact.layer == "tactical",
            MemoryFact.created_at < cutoff,
            MemoryFact.importance < config.memory_importance_threshold,
        ).returning(MemoryFact.id)
    )
    deleted = len(result.fetchall())
    if deleted:
        await db.flush()
    return deleted
