"""
Episodic memory read path — top-k similarity search over agent_episodes.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from config import config

from .embedder import _get_collection_sync

logger = logging.getLogger(__name__)


def _query_sync(query: str, k: int, user_id: str | None = None) -> list[dict[str, Any]]:
    coll = _get_collection_sync(user_id)
    try:
        n_avail = int(coll.count())
    except Exception:
        n_avail = 0
    if n_avail == 0:
        return []
    try:
        uid = user_id or "default"
        where = {"user_id": uid}
        kwargs: dict[str, Any] = {"query_texts": [query], "n_results": min(k, n_avail)}
        kwargs["where"] = where
        results = coll.query(**kwargs)
    except Exception as exc:
        logger.warning("episodic recall query failed: %s", exc)
        return []

    docs = results.get("documents", [[]])[0] or []
    metas = results.get("metadatas", [[]])[0] or []
    distances = results.get("distances", [[]])[0] or []

    out: list[dict[str, Any]] = []
    for i, doc in enumerate(docs):
        meta = metas[i] if i < len(metas) else {}
        action_counts = meta.get("action_counts_json")
        if isinstance(action_counts, str):
            try:
                action_counts = json.loads(action_counts)
            except Exception:
                action_counts = {}
        relevance = 1.0 - float(distances[i]) if i < len(distances) else 0.0
        out.append({
            "task_id": meta.get("task_id"),
            "goal": meta.get("goal"),
            "outcome": meta.get("outcome"),
            "summary": doc,
            "created_at": meta.get("created_at"),
            "user_id": meta.get("user_id"),
            "duration_s": float(meta.get("duration_s") or 0.0),
            "action_counts": action_counts or {},
            "relevance": relevance,
        })
    return out


async def recall(
    query: str,
    k: int | None = None,
    *,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    """Top-k similar past episodes for the given query string."""
    if not config.agent_episodic_memory_enabled:
        return []
    limit = k if k is not None else config.agent_episodic_top_k
    return await asyncio.to_thread(_query_sync, query, max(1, int(limit)), user_id)


def format_episodes_for_prompt(episodes: list[dict[str, Any]]) -> str:
    """Format episodes for injection into a planner prompt (UA labels)."""
    if not episodes:
        return ""
    lines: list[str] = []
    for ep in episodes:
        ts = (ep.get("created_at") or "")[:19].replace("T", " ")
        goal = (ep.get("goal") or "")[:120]
        outcome = ep.get("outcome") or "?"
        summary = (ep.get("summary") or "").strip()[:240]
        lines.append(f"- [{ts}] \"{goal}\" → {outcome}. {summary}")
    return "\n".join(lines)


__all__ = ["recall", "format_episodes_for_prompt"]
