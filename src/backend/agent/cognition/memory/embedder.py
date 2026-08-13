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


#: Fallback prefix, used when the configured one sanitises to nothing. Matches
#: the historical hardcoded value so existing collections keep their names.
_DEFAULT_PREFIX = "phantom_v1_episodes"

#: Longest configured prefix accepted before truncation, chosen so the 63-char
#: Chroma ceiling still leaves room for a body and the 8-char digest.
_MAX_PREFIX_LEN = 40


def _collection_prefix() -> str:
    """Collection-name prefix, from ``config.agent_episodic_collection``.

    The per-user naming below replaced a single global collection, and the
    config knob was left behind reading nothing — an operator could set it and
    silently get no effect, and the test fixture that monkeypatches it got no
    isolation at all, so "isolated" tests quietly shared one collection.
    """
    from config import config

    raw = getattr(config, "agent_episodic_collection", "") or ""
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", raw).strip("_-")
    # Cap the prefix too, not just the body: Chroma's limit is on the whole
    # name, so a long configured prefix would otherwise overflow it no matter
    # how far the body was trimmed. 40 leaves room for a body plus the digest.
    safe = safe[:_MAX_PREFIX_LEN].rstrip("_-")
    return safe or _DEFAULT_PREFIX


def _collection_name(user_id: str | None = None) -> str:
    """Per-user collection name for hard cross-user isolation."""
    uid = user_id or "default"
    prefix = _collection_prefix()
    # Keep the chroma constraint of 3..63 chars + ``[a-zA-Z0-9_-]``.
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", uid)
    # Budget derived from the prefix rather than assumed: 63 cap, minus the
    # prefix, minus "_" separators, minus the 8-char digest.
    body_budget = max(1, 63 - len(prefix) - 2 - 8)
    needs_disambiguation = (
        safe_id != uid  # stripping changed something
        or len(safe_id) > body_budget  # over the chroma length budget
        or not safe_id  # empty after sanitisation
        # Chroma also requires the name to START and END with an alphanumeric
        # character. The `phantom_v1_episodes_` prefix covers the start, but an
        # id ending in `_` or `-` did not: `__system__` produced
        # `phantom_v1_episodes___system__`, which Chroma rejects. Every episodic
        # write for that actor then failed as a "non-fatal" warning, so system
        # memory was silently never recorded. Routing through the digest branch
        # fixes it — the hash suffix always ends alphanumeric.
        or not safe_id[-1].isalnum()
    )
    if needs_disambiguation:
        digest = hashlib.sha256(uid.encode("utf-8")).hexdigest()[:8]
        body = safe_id[:body_budget] if safe_id else "x"
        return f"{prefix}_{body}_{digest}"
    return f"{prefix}_{safe_id}"


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
