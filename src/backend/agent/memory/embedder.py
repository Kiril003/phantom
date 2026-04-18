"""
Shared ChromaDB collection accessor for agent episodes.

Reuses the SAME PersistentClient + embedding function instances Phase 3 uses
(see memory/strategic_memory.py module singletons) so we don't reload the
SentenceTransformer model.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from config import config

logger = logging.getLogger(__name__)


def _get_collection_sync() -> Any:
    """Sync getter — must run via asyncio.to_thread()."""
    # Phase 3's strategic_memory keeps the persistent client + embedding fn as
    # module-level singletons. Use them so first-touch costs amortize.
    from memory.strategic_memory import _get_client, _get_ef

    client = _get_client()
    ef = _get_ef()
    return client.get_or_create_collection(
        name=config.agent_episodic_collection,
        embedding_function=ef,
    )


async def get_collection() -> Any:
    """Async wrapper around the sync ChromaDB lookup."""
    return await asyncio.to_thread(_get_collection_sync)


def _count_sync() -> int:
    coll = _get_collection_sync()
    try:
        return int(coll.count())
    except Exception:
        return 0


async def count() -> int:
    """Number of episode docs currently in the collection."""
    return await asyncio.to_thread(_count_sync)


def _wipe_sync() -> int:
    """Test helper — drops the agent_episodes collection."""
    from memory.strategic_memory import _get_client
    client = _get_client()
    try:
        client.delete_collection(name=config.agent_episodic_collection)
        return 1
    except Exception:
        return 0


async def wipe() -> int:
    """Test helper — drops the agent_episodes collection."""
    return await asyncio.to_thread(_wipe_sync)


__all__ = ["get_collection", "count", "wipe"]
