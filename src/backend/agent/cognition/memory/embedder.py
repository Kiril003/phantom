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

import hashlib
import re

logger = logging.getLogger(__name__)


def _collection_name(user_id: str | None = None) -> str:
    """Per-user collection name for hard cross-user isolation."""
    uid = user_id or "default"
    # Keep the chroma constraint of 3..63 chars + ``[a-zA-Z0-9_-]``.
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", uid)
    # Chroma's max collection name is 63 chars; "phantom_v1_episodes_" prefix = 20,
    # "_" + 8-char hash = 9, leaves 34 for the body.
    body_budget = 34
    needs_disambiguation = (
        safe_id != uid  # stripping changed something
        or len(safe_id) > body_budget  # over the chroma length budget
        or not safe_id  # empty after sanitisation
    )
    if needs_disambiguation:
        digest = hashlib.sha256(uid.encode("utf-8")).hexdigest()[:8]
        body = safe_id[:body_budget] if safe_id else "x"
        return f"phantom_v1_episodes_{body}_{digest}"
    return f"phantom_v1_episodes_{safe_id}"


def _get_collection_sync(user_id: str | None = None) -> Any:
    """Sync getter — must run via asyncio.to_thread()."""
    # Phase 3's strategic_memory keeps the persistent client + embedding fn as
    # module-level singletons. Use them so first-touch costs amortize.
    from memory.strategic_memory import _get_client, _get_ef

    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    return client.get_or_create_collection(
        name=coll_name,
        embedding_function=ef,
    )


async def get_collection(user_id: str | None = None) -> Any:
    """Async wrapper around the sync ChromaDB lookup."""
    return await asyncio.to_thread(_get_collection_sync, user_id)


def _count_sync(user_id: str | None = None) -> int:
    coll = _get_collection_sync(user_id)
    try:
        return int(coll.count())
    except Exception:
        return 0


async def count(user_id: str | None = None) -> int:
    """Number of episode docs currently in the collection."""
    return await asyncio.to_thread(_count_sync, user_id)


def _wipe_sync(user_id: str | None = None) -> int:
    """Test helper — drops the collection."""
    from memory.strategic_memory import _get_client
    client = _get_client()
    try:
        coll_name = _collection_name(user_id)
        client.delete_collection(name=coll_name)
        return 1
    except Exception:
        return 0


async def wipe(user_id: str | None = None) -> int:
    """Test helper — drops the collection."""
    return await asyncio.to_thread(_wipe_sync, user_id)


__all__ = ["get_collection", "count", "wipe"]
