"""
Phase 23-G — Lesson distillation + injection.

After every task `done`, `distill_lesson` extracts a TRANSFERABLE rule
from the task's observations and writes it to a dedicated ChromaDB
collection. Before the next task plans anything, `recall_lessons` finds
the top-K lessons whose goal embeddings are similar to the current goal
and `format_lessons_for_prompt` renders them as a concise list that the
strategic + tactical planners inject above the tool catalog.

This is meta-learning over sessions — the agent literally compounds
its know-how. Claude Code / Coworker / Cursor / Aider do NOT have an
analogue: they reset between turns/sessions. PHANTOM keeps and uses it.

Storage: separate Chroma collection `agent_lessons` (different from
`agent_episodes`) so retrieval is goal-similarity tight + episode-similarity
wide on the same task store.

Schema (one row):
  id              str  — `lesson_<task_id>`
  document        str  — full lesson text (1-3 sentences UA)
  metadata.kind          = "lesson"
  metadata.goal          = task goal (truncated 1000)
  metadata.outcome       = "done" only — failed/timeout tasks generate
                           a different note format that's still helpful.
  metadata.what_worked   = bullet (≤200 chars)
  metadata.what_avoid    = bullet (≤200 chars) or ""
  metadata.applicability = short tag the LLM uses to phrase "коли мета
                           включає X, …"; if LLM omits it we fall back
                           to first noun-phrase of the goal.
  metadata.task_id       = origin task
  metadata.created_at    = ISO timestamp

A lesson is NEVER a substitute for an episode — both write paths run.
Episode = "what happened in task X". Lesson = "what to do/avoid for
goals like Y" — prescriptive, transferable, NOT bound to one task.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from config import config

logger = logging.getLogger(__name__)


_LESSON_COLLECTION = "agent_lessons"


# ─── Distillation ────────────────────────────────────────────────────────────


_DISTILL_PROMPT_UA = """\
Витягни 1-2 уроки з виконаної задачі для майбутніх схожих задач.
Стисло. Прескриптивно. Без переказу подій. Перекладай "що працювало"
як готову інструкцію, а "чого уникати" як попередження.

МЕТА: {goal}
РЕЗУЛЬТАТ: {outcome}
КЛЮЧОВІ ДІЇ: {action_counts}
ОСТАННЄ СПОСТЕРЕЖЕННЯ: {last_observation}

Поверни строго JSON:
{{
  "what_worked": "<≤200 символів — інструкція що робити>",
  "what_avoid": "<≤200 символів — попередження або \\"\\">",
  "applicability": "<≤80 символів — коротка фраза 'коли мета … '>"
}}

Без прози поза JSON. Без markdown. Без коментарів.
"""


async def distill_lesson(
    *,
    goal: str,
    outcome: str,
    action_counts: dict[str, int],
    last_observation: str,
    task_id: str | None = None,
) -> dict[str, str] | None:
    """LLM-based distillation. Returns ``None`` on parse/LLM failure
    so the caller can skip storage without raising. The runtime treats
    distillation as best-effort; an offline LLM must NEVER block task
    finalisation."""
    if not config.agent_lessons_enabled:
        return None

    try:
        from ai.json_response import JsonResponseError
        from ai.provider import ai_router
        prompt = _DISTILL_PROMPT_UA.format(
            goal=goal[:600],
            outcome=outcome,
            action_counts=json.dumps(action_counts, ensure_ascii=False)[:400],
            last_observation=(last_observation or "(none)")[:400],
        )
        response = await ai_router.generate(
            user_message=prompt,
            system_prompt=(
                "Ти стислий редактор уроків. Відповідаєш чистим JSON."
            ),
            history=[],
            task_id=task_id,
        )
        raw = (response.content or "").strip()
        if not raw:
            return None
        # Strip optional ``` fences just in case the LLM ignored markdown rule.
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()
        data = json.loads(raw)
    except (json.JSONDecodeError, JsonResponseError) as exc:
        logger.debug("lesson distill JSON parse failed: %s", exc)
        return None
    except Exception as exc:
        logger.debug("lesson distill LLM failed: %s", exc)
        return None

    if not isinstance(data, dict):
        return None

    what_worked = str(data.get("what_worked") or "").strip()[:200]
    what_avoid = str(data.get("what_avoid") or "").strip()[:200]
    applicability = str(data.get("applicability") or "").strip()[:80]

    if not what_worked and not what_avoid:
        return None  # nothing transferable, don't pollute the collection

    if not applicability:
        # Fallback applicability — first ~60 chars of the goal so retrieval
        # has SOMETHING to render even if the LLM dropped the field.
        applicability = (goal or "схожої задачі")[:60].strip()

    return {
        "what_worked": what_worked,
        "what_avoid": what_avoid,
        "applicability": applicability,
    }


# ─── Storage ─────────────────────────────────────────────────────────────────


def _get_lessons_collection_sync() -> Any:
    """Resolve the dedicated lessons collection, lazy-initialising on first
    call. Reuses Phase-3 strategic_memory's PersistentClient + embedding
    function singletons so we don't reload the SentenceTransformer or
    re-open the SQLite store."""
    from memory.strategic_memory import _get_client, _get_ef
    client = _get_client()
    ef = _get_ef()
    return client.get_or_create_collection(
        name=_LESSON_COLLECTION,
        embedding_function=ef,
    )


def _upsert_lesson_sync(*, lesson_id: str, document: str, metadata: dict[str, Any]) -> None:
    coll = _get_lessons_collection_sync()
    safe_meta: dict[str, Any] = {}
    for k, v in metadata.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            safe_meta[k] = v
        else:
            safe_meta[k] = json.dumps(v, ensure_ascii=False, default=str)
    coll.upsert(ids=[lesson_id], documents=[document], metadatas=[safe_meta])


async def write_lesson(
    *,
    task_id: str,
    goal: str,
    outcome: str,
    lesson: dict[str, str],
) -> str:
    """Persist a distilled lesson. Returns the lesson id (empty string when
    lessons are disabled or storage failed). Idempotent per task_id."""
    if not config.agent_lessons_enabled:
        return ""
    lesson_id = f"lesson_{task_id}"
    # The "document" is what ChromaDB embeds for similarity search. We
    # bake the applicability + worked + avoid into one string so the
    # embedding captures all three angles without relying on metadata.
    parts: list[str] = []
    if lesson.get("applicability"):
        parts.append(f"коли {lesson['applicability']}")
    if lesson.get("what_worked"):
        parts.append(f"робити: {lesson['what_worked']}")
    if lesson.get("what_avoid"):
        parts.append(f"уникати: {lesson['what_avoid']}")
    document = " · ".join(parts).strip()
    if not document:
        return ""
    document = (f"{goal[:120]} → " + document)[:1500]
    metadata: dict[str, Any] = {
        "kind": "lesson",
        "task_id": task_id,
        "goal": goal[:1000],
        "outcome": outcome,
        "what_worked": lesson.get("what_worked", ""),
        "what_avoid": lesson.get("what_avoid", ""),
        "applicability": lesson.get("applicability", ""),
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    try:
        await asyncio.to_thread(
            _upsert_lesson_sync,
            lesson_id=lesson_id,
            document=document,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning("lessons write_lesson failed (non-fatal): %s", exc)
        return ""
    return lesson_id


# ─── Recall + format ─────────────────────────────────────────────────────────


def _query_lessons_sync(query: str, k: int) -> list[dict[str, Any]]:
    try:
        coll = _get_lessons_collection_sync()
    except Exception as exc:
        logger.debug("lessons collection unavailable: %s", exc)
        return []
    try:
        n_avail = int(coll.count())
    except Exception:
        n_avail = 0
    if n_avail == 0:
        return []
    try:
        results = coll.query(query_texts=[query], n_results=min(k, n_avail))
    except Exception as exc:
        logger.warning("lessons recall query failed: %s", exc)
        return []

    docs = results.get("documents", [[]])[0] or []
    metas = results.get("metadatas", [[]])[0] or []
    distances = results.get("distances", [[]])[0] or []

    out: list[dict[str, Any]] = []
    for i, doc in enumerate(docs):
        meta = metas[i] if i < len(metas) else {}
        relevance = 1.0 - float(distances[i]) if i < len(distances) else 0.0
        out.append({
            "lesson_id": meta.get("lesson_id") or f"lesson_{meta.get('task_id', '')}",
            "task_id": meta.get("task_id"),
            "goal": meta.get("goal"),
            "what_worked": meta.get("what_worked") or "",
            "what_avoid": meta.get("what_avoid") or "",
            "applicability": meta.get("applicability") or "",
            "document": doc,
            "created_at": meta.get("created_at"),
            "relevance": relevance,
        })
    return out


async def recall_lessons(query: str, k: int | None = None) -> list[dict[str, Any]]:
    """Top-k similar lessons for the given query (usually the new task's
    goal string). Returns lessons whose relevance is above the configured
    minimum so cold-cache or off-topic lessons do not get injected."""
    if not config.agent_lessons_enabled:
        return []
    limit = k if k is not None else int(config.agent_lessons_top_k)
    if limit <= 0:
        return []
    rows = await asyncio.to_thread(_query_lessons_sync, query, max(1, int(limit)))
    threshold = float(getattr(config, "agent_lessons_min_relevance", 0.35) or 0.0)
    return [r for r in rows if r.get("relevance", 0.0) >= threshold]


def format_lessons_for_prompt(lessons: list[dict[str, Any]]) -> str:
    """Render lessons as a UA bullet list for prompt injection. Empty
    string when no lessons survive the relevance filter — callers
    should NOT inject any heading in that case."""
    if not lessons:
        return ""
    lines: list[str] = ["УРОКИ З ПОПЕРЕДНІХ СХОЖИХ ЗАДАЧ:"]
    for ln in lessons:
        what = (ln.get("what_worked") or "").strip()
        avoid = (ln.get("what_avoid") or "").strip()
        applicability = (ln.get("applicability") or "").strip()
        bullet_parts: list[str] = []
        if applicability:
            bullet_parts.append(f"коли {applicability}")
        if what:
            bullet_parts.append(f"роби {what}")
        if avoid:
            bullet_parts.append(f"уникай {avoid}")
        if bullet_parts:
            lines.append("- " + "; ".join(bullet_parts))
    return "\n".join(lines).strip()


__all__ = [
    "distill_lesson",
    "write_lesson",
    "recall_lessons",
    "format_lessons_for_prompt",
]
