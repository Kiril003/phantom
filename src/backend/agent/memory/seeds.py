"""
Episodic memory write path.

On task completion the loop calls write_episode() — composes a UA summary via
LLM (free-form) then upserts (id, document, metadata) into the agent_episodes
ChromaDB collection. SQL agent_memory_seeds row remains as a dual-write so
operators can browse without ChromaDB connectivity.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from config import config

from .embedder import get_collection

logger = logging.getLogger(__name__)


_SUMMARY_PROMPT_UA = """\
Склади коротке резюме виконаної задачі у 2-3 речення українською.
Згадай: що було метою, що вдалось/не вдалось, які ключові дії були використані.
Не перекладай назви файлів, команд, URL — лиши їх англійською.

МЕТА: {goal}
РЕЗУЛЬТАТ: {outcome}
ПІДСУМКИ ДІЙ: {action_counts}
ФІНАЛЬНЕ СПОСТЕРЕЖЕННЯ: {last_observation}

Резюме:"""


async def compose_summary(
    *,
    goal: str,
    outcome: str,
    action_counts: dict[str, int],
    last_observation: str,
    task_id: str | None = None,
) -> str:
    """Call the LLM to compose a UA summary of the task. Falls back gracefully
    when no provider is reachable so episodic memory is never the reason a
    task fails to finalise.

    Phase 9.2.2: forwards task_id so this call also counts against the
    per-task LLM budget.
    """
    try:
        from ai.provider import ai_router
        prompt = _SUMMARY_PROMPT_UA.format(
            goal=goal,
            outcome=outcome,
            action_counts=json.dumps(action_counts, ensure_ascii=False),
            last_observation=(last_observation or "(none)")[:400],
        )
        response = await ai_router.generate(
            user_message=prompt,
            system_prompt="Ти стислий редактор. Відповідай чистим текстом без markdown.",
            history=[],
            task_id=task_id,
        )
        text = (response.content or "").strip()
        if text:
            return text[:500]
    except Exception as exc:
        logger.debug("compose_summary fell back to deterministic stub: %s", exc)

    # Deterministic fallback when LLM is unreachable.
    top_actions = ", ".join(f"{k}×{v}" for k, v in
                            sorted(action_counts.items(), key=lambda kv: -kv[1])[:3])
    return (
        f"Мета: {goal[:120]}. "
        f"Результат: {outcome}. "
        f"Дії: {top_actions or 'жодних'}."
    )[:500]


def _upsert_sync(*, episode_id: str, document: str, metadata: dict[str, Any]) -> None:
    from .embedder import _get_collection_sync
    coll = _get_collection_sync()
    # Chroma metadata is flat key→primitive — JSON-encode lists/dicts.
    safe_meta: dict[str, Any] = {}
    for k, v in metadata.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            safe_meta[k] = v
        else:
            safe_meta[k] = json.dumps(v, ensure_ascii=False, default=str)
    coll.upsert(ids=[episode_id], documents=[document], metadatas=[safe_meta])


async def write_episode(
    *,
    task_id: str,
    goal: str,
    outcome: str,
    summary: str,
    action_counts: dict[str, int],
    duration_s: float = 0.0,
) -> str:
    """
    Upsert one episode into ChromaDB. Returns the episode id.

    Idempotent: re-calling for the same task_id replaces the prior doc.
    """
    if not config.agent_episodic_memory_enabled:
        return ""
    episode_id = f"episode_{task_id}"
    metadata: dict[str, Any] = {
        "task_id": task_id,
        "goal": goal[:1000],
        "outcome": outcome,
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
        "duration_s": float(duration_s),
        "action_counts_json": json.dumps(action_counts, ensure_ascii=False),
    }
    try:
        await asyncio.to_thread(
            _upsert_sync,
            episode_id=episode_id,
            document=summary[:1500],
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning("episodic write_episode failed (non-fatal): %s", exc)
        return ""
    return episode_id


__all__ = ["compose_summary", "write_episode"]
