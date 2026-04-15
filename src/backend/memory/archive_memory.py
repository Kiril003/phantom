"""
PHANTOM OS — Archive Memory (Sealed / Dead Zone).
Records sealed into the archive are never returned in normal queries.
Used for GHOST state recordings (AES-256 encrypted in Phase 12).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def seal_fact_in_db(
    db: AsyncSession,
    fact_id: str,
) -> bool:
    """
    Mark a MemoryFact as sealed in SQLite.
    Also updates its layer to 'archive'.
    Returns True if the fact was found and sealed.
    """
    from db.models import MemoryFact

    result = await db.execute(select(MemoryFact).where(MemoryFact.id == fact_id))
    fact = result.scalar_one_or_none()
    if fact is None:
        logger.warning("seal_fact_in_db: fact %s not found", fact_id)
        return False

    fact.is_sealed = True  # type: ignore[assignment]
    fact.layer = "archive"  # type: ignore[assignment]
    await db.flush()
    return True


async def store_archive_fact(
    db: AsyncSession,
    user_id: str,
    session_id: str,
    content: str,
    category: str = "thought_stream",
    importance: float = 0.5,
) -> str:
    """
    Directly create a sealed fact in the archive layer.
    Used by GHOST state to record observations without surfacing them to the AI.
    Returns the new fact ID.
    """
    from db.models import MemoryFact

    fact_id = str(uuid.uuid4())
    fact = MemoryFact(
        id=fact_id,
        user_id=user_id,
        layer="archive",
        category=category,
        content=content,
        importance=importance,
        source_session_id=session_id,
        is_sealed=True,
        decay_factor=0.0,  # archive never decays
    )
    db.add(fact)
    await db.flush()
    return fact_id


async def get_sealed_facts(
    db: AsyncSession,
    user_id: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """
    Retrieve sealed / archive facts for ROOT inspection.
    Returns only metadata — content is shown only in GHOST/ROOT context.
    """
    from db.models import MemoryFact

    stmt = (
        select(MemoryFact)
        .where(
            MemoryFact.user_id == user_id,
            MemoryFact.is_sealed == True,  # noqa: E712
        )
        .order_by(MemoryFact.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    facts = result.scalars().all()

    return [
        {
            "id": f.id,
            "category": f.category,
            "importance": f.importance,
            "created_at": f.created_at.isoformat(),
            "layer": f.layer,
            # content deliberately omitted — caller must verify GHOST/ROOT access
        }
        for f in facts
    ]


async def unseal_fact(
    db: AsyncSession,
    fact_id: str,
    target_layer: str = "tactical",
) -> bool:
    """
    Restore a sealed fact back to active memory (ROOT action only).
    Returns True on success.
    """
    from db.models import MemoryFact

    result = await db.execute(select(MemoryFact).where(MemoryFact.id == fact_id))
    fact = result.scalar_one_or_none()
    if fact is None:
        return False

    fact.is_sealed = False  # type: ignore[assignment]
    fact.layer = target_layer  # type: ignore[assignment]
    await db.flush()
    return True


async def purge_archive(
    db: AsyncSession,
    user_id: str,
    older_than_days: int = 90,
) -> int:
    """
    Permanently delete sealed archive facts older than N days.
    Returns count of deleted records.
    """
    from db.models import MemoryFact
    from sqlalchemy import delete
    from datetime import timedelta

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=older_than_days)

    res = await db.execute(
        delete(MemoryFact)
        .where(
            MemoryFact.user_id == user_id,
            MemoryFact.is_sealed == True,  # noqa: E712
            MemoryFact.created_at < cutoff,
        )
        .returning(MemoryFact.id)
    )
    deleted = len(res.fetchall())
    if deleted:
        await db.flush()
    return deleted
