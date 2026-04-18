"""
One-time backfill — convert SQL agent_memory_seeds rows into ChromaDB
agent_episodes documents. Idempotent because we use deterministic ids
(`episode_{task_id}`) and ChromaDB upsert.

CLI:  python -m agent.memory.backfill
Lifespan auto-trigger: when chroma collection.count() < seeds row count, run.
"""
from __future__ import annotations

import asyncio
import json
import logging

from sqlalchemy import select

from db.database import get_session, init_db
from db.models import AgentMemorySeed

from .embedder import count as collection_count
from .seeds import write_episode

logger = logging.getLogger(__name__)


async def backfill_all() -> dict[str, int]:
    """Walk every SQL seed row and upsert into ChromaDB. Returns counts."""
    async with get_session() as db:
        result = await db.execute(select(AgentMemorySeed))
        seeds = list(result.scalars().all())

    written = 0
    skipped = 0
    for seed in seeds:
        try:
            try:
                key_actions_raw = json.loads(seed.key_actions or "[]")
            except Exception:
                key_actions_raw = []
            action_counts: dict[str, int] = {}
            if isinstance(key_actions_raw, list):
                for entry in key_actions_raw:
                    if isinstance(entry, (list, tuple)) and len(entry) == 2:
                        action_counts[str(entry[0])] = int(entry[1])
                    elif isinstance(entry, dict) and "name" in entry:
                        action_counts[str(entry["name"])] = int(entry.get("count", 1))
            ep_id = await write_episode(
                task_id=seed.task_id,
                goal=seed.goal,
                outcome=seed.outcome,
                summary=seed.summary,
                action_counts=action_counts,
                duration_s=0.0,
            )
            if ep_id:
                written += 1
            else:
                skipped += 1
        except Exception as exc:
            logger.warning("backfill skipped seed %s: %s", seed.id, exc)
            skipped += 1
    return {"seeds_total": len(seeds), "written": written, "skipped": skipped}


async def backfill_if_behind() -> dict[str, int] | None:
    """Lifespan helper — only backfills when ChromaDB is behind SQL."""
    async with get_session() as db:
        result = await db.execute(select(AgentMemorySeed.id))
        sql_count = len(list(result.scalars().all()))
    chroma_count = await collection_count()
    if chroma_count >= sql_count:
        return None
    logger.info("Episodic memory backfill: chroma=%d < sql=%d, syncing",
                chroma_count, sql_count)
    return await backfill_all()


async def _main_cli() -> None:
    await init_db()
    stats = await backfill_all()
    print(f"backfill_all: {stats}")


if __name__ == "__main__":
    asyncio.run(_main_cli())
