"""PHANTOM OS — Core Narrative Memory Layer.

Manages SQLite versioned Core Narrative logs for self-editing reflection
concerning assistant-user relationships and overall system status.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.provider import ai_router
from db.models import CoreNarrativeLog

logger = logging.getLogger(__name__)

_REWRITE_SYSTEM_PROMPT = "Ти когнітивний архітектор пам'яті PHANTOM OS. Відповідаєш чистим JSON."

_REWRITE_PROMPT_TEMPLATE = """\
Поточний core_narrative (твоє узагальнене уявлення про ваші стосунки та спільний статус):
{previous_text}

Нові/актуальні факти, засвоєні за останній період:
{facts}

Перепиши core_narrative (обсягом 300-500 токенів, природна мова, від першої особи AI: "Я...", "Ми...").
Узагальни, хто ви один для одного зараз. Зміни тільки те, що реально змінилось на основі нових фактів.
Поверни строго JSON-об'єкт:
{{
  "text": "<новий узагальнений текст core_narrative>",
  "diff_summary": "<короткий опис змін в 1-2 реченнях, що саме змінилось і чому>"
}}

Без прози поза JSON. Без markdown. Без коментарів.
"""


async def get_latest_core_narrative(db: AsyncSession, user_id: str) -> CoreNarrativeLog | None:
    """Fetch the latest versioned core narrative log for the user."""
    try:
        stmt = (
            select(CoreNarrativeLog)
            .where(CoreNarrativeLog.user_id == user_id)
            .order_by(CoreNarrativeLog.created_at.desc(), CoreNarrativeLog.version.desc())
            .limit(1)
        )
        res = await db.execute(stmt)
        return res.scalar_one_or_none()
    except Exception as exc:
        logger.warning("Failed to fetch latest core narrative: %s", exc)
        return None


async def save_core_narrative(
    db: AsyncSession,
    user_id: str,
    text: str,
    diff_summary: str | None = None,
) -> CoreNarrativeLog | None:
    """Insert a new version of the core narrative into the log."""
    try:
        latest = await get_latest_core_narrative(db, user_id)
        next_version = (latest.version + 1) if latest else 1

        new_log = CoreNarrativeLog(
            user_id=user_id,
            version=next_version,
            text=text,
            diff_summary=diff_summary,
            created_at=datetime.now(tz=timezone.utc),
        )
        db.add(new_log)
        await db.flush()
        logger.info("Saved core_narrative log version %d for user %s", next_version, user_id)
        return new_log
    except Exception as exc:
        logger.warning("Failed to save core narrative: %s", exc)
        return None


async def rewrite_core_narrative(
    db: AsyncSession,
    user_id: str,
    recent_facts: list[str],
) -> str | None:
    """Perform LLM-based consolidation rewrite of the core narrative."""
    latest = await get_latest_core_narrative(db, user_id)
    previous_text = latest.text if latest else "Ми тільки знайомимося. Я Familiar, твій автономний асистент PHANTOM OS."

    if not recent_facts:
        logger.debug("No new facts for core narrative rewrite.")
        return previous_text

    facts_block = "\n".join(f"- {f}" for f in recent_facts)
    prompt = _REWRITE_PROMPT_TEMPLATE.format(
        previous_text=previous_text,
        facts=facts_block,
    )

    try:
        response = await ai_router.generate(
            user_message=prompt,
            system_prompt=_REWRITE_SYSTEM_PROMPT,
            history=[],
        )
        raw = (response.content or "").strip()
        if not raw:
            return None

        # Clean optional markdown code blocks if the model ignored instructions
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()

        data = json.loads(raw)
        if not isinstance(data, dict):
            return None

        new_text = str(data.get("text") or "").strip()
        diff_summary = str(data.get("diff_summary") or "").strip()

        if new_text:
            await save_core_narrative(db, user_id, new_text, diff_summary)
            return new_text
    except Exception as exc:
        logger.warning("Failed to rewrite core narrative: %s", exc)
        return None

    return None


async def inject_core_narrative_context(db: AsyncSession, user_id: str) -> str:
    """Format and return the latest core narrative log for system prompt injection."""
    latest = await get_latest_core_narrative(db, user_id)
    if latest and latest.text:
        return f"\n[Core Narrative (наші взаємини та поточний статус)]:\n{latest.text.strip()}\n"
    return ""
