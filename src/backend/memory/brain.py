"""
PHANTOM OS — unified memory brain.

This module is the narrow waist between PHANTOM's many memory stores and
the chat/agent surfaces that need to use them. The older layers still exist:
session RAM, tactical SQLite, strategic Chroma, geo-tagged facts, and agent
episode seeds. MemoryBrain makes them behave like one coherent memory system.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import config

logger = logging.getLogger(__name__)


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?。！？])\s+|\n+")
_WORD_RE = re.compile(r"[0-9A-Za-zА-Яа-яІіЇїЄєҐґ'_-]{3,}")

_STOP_WORDS = {
    "the", "and", "for", "that", "this", "with", "you", "your", "about",
    "what", "where", "when", "чому", "коли", "куди", "якщо", "тому",
    "мені", "мене", "тебе", "тому", "тут", "там", "щось", "дуже",
    "просто", "зараз", "який", "яка", "яке", "які", "что", "где",
    "когда", "для", "про", "але", "або", "или", "это", "той", "цей",
    "пам'ятаєш", "памʼятаєш", "памятаєш", "памятиш", "знаєш",
    "remember", "know", "recall",
    "привіт", "вітаю", "hello", "hi", "hey", "дякую", "thanks", "справи",
    "погода", "погоді", "weather", "новини", "news",
}

_BROAD_MEMORY_RE = re.compile(
    r"(пам[ʼ']?ята|remember|recall|що\s+ти\s+знаєш|what\s+do\s+you\s+know)",
    re.IGNORECASE,
)



_BROAD_MEMORY_RE = re.compile(
    r"(пам[ʼ']?ята|remember|recall|що\s+ти\s+знаєш|what\s+do\s+you\s+know)",
    re.IGNORECASE,
)

@dataclass(slots=True)
class MemoryWrite:
    content: str
    category: str = "fact"
    importance: float = 0.5
    durable: bool = False
    reason: str = "heuristic"

@dataclass(slots=True)
class MemoryWriteReport:
    stored_ids: list[str] = field(default_factory=list)
    strategic_ids: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

@dataclass(slots=True)
class MemoryHit:
    content: str
    layer: str
    source: str
    category: str = "fact"
    relevance: float = 0.0
    importance: float = 0.0
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def prompt_line(self) -> str:
        label = {
            "strategic": "long-term",
            "tactical": "recent",
            "archive": "archive",
            "geo": "nearby",
            "episode": "experience",
        }.get(self.layer, self.layer)
        text = _compact_text(self.content, 220)
        return f"[{label}] {text}" if text else ""

def _compact_text(value: str, limit: int = 500) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"

def _query_terms(query: str, limit: int = 8) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for raw in _WORD_RE.findall((query or "").lower()):
        if raw in _STOP_WORDS:
            continue
        if raw in seen:
            continue
        seen.add(raw)
        terms.append(raw)
        if len(terms) >= limit:
            break
    return terms

def _is_broad_memory_request(text: str) -> bool:
    return bool(_BROAD_MEMORY_RE.search(text or ""))

_EXTRACT_TOOL = {
    "name": "extract_facts",
    "description": "Extract stable, long-term memory facts from user text.",
    "parameters": {
        "type": "object",
        "properties": {
            "facts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string", "description": "The normalized atomic fact (e.g. 'I work as a developer')"},
                        "category": {"type": "string", "enum": ["identity", "profile", "preference", "pattern", "decision", "fact", "explicit"]},
                        "importance": {"type": "number", "description": "0.0 (trivial) to 1.0 (critical identity)"},
                        "durable": {"type": "boolean", "description": "True if this is long-term knowledge"},
                        "reason": {"type": "string", "description": "Why was this extracted?"}
                    },
                    "required": ["content", "category", "importance", "durable", "reason"]
                }
            }
        },
        "required": ["facts"]
    }
}

async def extract_memory_writes(text: str, *, max_items: int = 8) -> list[MemoryWrite]:
    """Extract durable user-stated memory candidates using LLM semantic parsing."""
    text = _compact_text(text, 4000)
    if not text or len(text) < 10:
        return []

    from ai.provider import ai_router
    from ai.tool_use import ToolCallResult

    sys_prompt = (
        "You are a semantic memory extractor for PHANTOM OS. Read the user's message and "
        "extract ONLY stable, durable facts about the user (identity, preferences, profile, "
        "patterns, decisions). Ignore questions, greetings, and ephemeral chatter. "
        "If they explicitly tell you to remember something, extract it as 'explicit'. "
        "Normalize the facts into the first-person perspective of the user "
        "(e.g. 'Користувач любить...' -> 'Я люблю...'). If no durable facts exist, return an empty array."
    )

    try:
        choice = await ai_router.call_with_tools(
            user_message=text,
            system_prompt=sys_prompt,
            history=[],
            tools=[_EXTRACT_TOOL],
            user_id=None,
            provider_hint="gemini-flash"
        )
        if isinstance(choice, ToolCallResult) and choice.tool_name == "extract_facts":
            writes = []
            for item in choice.arguments.get("facts", []):
                writes.append(MemoryWrite(
                    content=item["content"][:1200],
                    category=item["category"],
                    importance=float(item["importance"]),
                    durable=bool(item["durable"]),
                    reason=item["reason"][:128]
                ))
            return writes[:max_items]
    except Exception as exc:
        logger.warning("LLM memory extraction failed: %s", exc)

    return []


class MemoryBrain:
    """Unified write/recall facade for PHANTOM's memory stores."""

    async def remember_text(
        self,
        *,
        db: AsyncSession,
        user_id: str,
        session_id: str,
        text: str,
        source: str = "chat",
        durable: bool = True,
    ) -> MemoryWriteReport:
        report = MemoryWriteReport()
        writes = await extract_memory_writes(text)
        if not writes:
            report.skipped.append("no_stable_user_facts")
            return report

        from db.models import MemoryFact
        from memory.tactical_memory import store_fact as tactical_store
        from memory import strategic_memory

        for write in writes:
            existing = await db.execute(
                select(MemoryFact)
                .where(
                    MemoryFact.user_id == user_id,
                    MemoryFact.content == write.content,
                    MemoryFact.is_sealed.is_(False),
                )
                .order_by(MemoryFact.created_at.desc())
                .limit(1)
            )
            row = existing.scalar_one_or_none()
            if row is not None:
                row.accessed_at = datetime.now(tz=timezone.utc)  # type: ignore[assignment]
                row.access_count = int(row.access_count or 0) + 1
                row.importance = max(float(row.importance or 0.0), write.importance)
                fact_id = str(row.id)
            else:
                fact_id = await tactical_store(
                    db=db,
                    user_id=user_id,
                    session_id=session_id,
                    content=write.content,
                    category=write.category,
                    importance=write.importance,
                )
            report.stored_ids.append(fact_id)

            if durable and write.durable:
                try:
                    await strategic_memory.store_fact(
                        user_id=user_id,
                        fact_id=fact_id,
                        content=write.content,
                        category=write.category,
                        importance=write.importance,
                        metadata_extra={
                            "source": source,
                            "source_session_id": session_id,
                            "memory_brain_reason": write.reason,
                        },
                    )
                    report.strategic_ids.append(fact_id)
                    try:
                        row_result = await db.execute(
                            select(MemoryFact).where(MemoryFact.id == fact_id)
                        )
                        sql_row = row_result.scalar_one_or_none()
                        if sql_row is not None:
                            sql_row.embedding_id = fact_id
                    except Exception:
                        pass
                except Exception as exc:
                    logger.debug("strategic memory write failed: %s", exc)
        await db.flush()
        return report

    async def recall(
        self,
        *,
        db: AsyncSession | None,
        user_id: str,
        query: str,
        limit: int | None = None,
        lat: float | None = None,
        lon: float | None = None,
        include_agent: bool = True,
    ) -> list[MemoryHit]:
        """Recall relevant memory across durable, recent, geo, and agent stores."""
        max_hits = max(1, int(limit or config.memory_top_k or 5))
        terms = _query_terms(query)
        if not terms and not _is_broad_memory_request(query):
            return []
        hits: list[MemoryHit] = []

        strategic_limit = max(max_hits, 5)
        try:
            from memory import strategic_memory
            docs = await strategic_memory.retrieve_relevant(
                user_id=user_id,
                query=query,
                top_k=strategic_limit,
            )
            for idx, doc in enumerate(docs):
                text = _compact_text(doc, 800)
                if text:
                    hits.append(MemoryHit(
                        content=text,
                        layer="strategic",
                        source="chroma",
                        relevance=max(0.0, 1.0 - idx * 0.08),
                    ))
        except Exception as exc:
            logger.debug("memory brain strategic recall failed: %s", exc)

        if db is not None:
            try:
                hits.extend(await self._recall_sql_facts(
                    db=db,
                    user_id=user_id,
                    query=query,
                    limit=max_hits,
                ))
            except Exception as exc:
                logger.debug("memory brain SQL fact recall failed: %s", exc)

            if lat is not None and lon is not None:
                try:
                    from memory.geo_query import find_memories_near
                    rows = await find_memories_near(
                        db=db,
                        user_id=user_id,
                        lat=float(lat),
                        lon=float(lon),
                        radius_km=0.5,
                        limit=min(3, max_hits),
                    )
                    for row in rows:
                        content = _compact_text(row.get("content", ""), 500)
                        if content:
                            hits.append(MemoryHit(
                                content=content,
                                layer="geo",
                                source="memory_facts",
                                category=str(row.get("category") or "fact"),
                                importance=float(row.get("importance") or 0.0),
                                metadata={"place_name": row.get("place_name")},
                            ))
                except Exception as exc:
                    logger.debug("memory brain geo recall failed: %s", exc)

            if include_agent:
                try:
                    hits.extend(await self._recall_agent_seeds(
                        db=db,
                        user_id=user_id,
                        query=query,
                        limit=min(3, max_hits),
                    ))
                except Exception as exc:
                    logger.debug("memory brain agent recall failed: %s", exc)

        return self._dedupe_rank(hits, limit=max_hits)

    async def recall_for_prompt(
        self,
        *,
        db: AsyncSession | None,
        user_id: str,
        query: str,
        limit: int | None = None,
        lat: float | None = None,
        lon: float | None = None,
        include_agent: bool = True,
    ) -> list[str]:
        hits = await self.recall(
            db=db,
            user_id=user_id,
            query=query,
            limit=limit,
            lat=lat,
            lon=lon,
            include_agent=include_agent,
        )
        lines = [h.prompt_line() for h in hits]
        return [line for line in lines if line]

    async def _recall_sql_facts(
        self,
        *,
        db: AsyncSession,
        user_id: str,
        query: str,
        limit: int,
    ) -> list[MemoryHit]:
        from db.models import MemoryFact

        terms = _query_terms(query)
        conditions: list[Any] = [
            MemoryFact.user_id == user_id,
            MemoryFact.is_sealed.is_(False),
        ]
        if terms:
            conditions.append(or_(*(MemoryFact.content.ilike(f"%{t}%") for t in terms)))

        result = await db.execute(
            select(MemoryFact)
            .where(and_(*conditions))
            .order_by(MemoryFact.importance.desc(), MemoryFact.created_at.desc())
            .limit(max(1, limit))
        )
        rows = result.scalars().all()
        out: list[MemoryHit] = []
        for row in rows:
            out.append(MemoryHit(
                content=row.content,
                layer=row.layer,
                source="sqlite",
                category=row.category,
                importance=float(row.importance or 0.0),
                created_at=row.created_at.isoformat() if row.created_at else None,
                metadata={
                    "id": row.id,
                    "place_name": row.place_name,
                    "embedding_id": row.embedding_id,
                },
            ))
        return out

    async def _recall_agent_seeds(
        self,
        *,
        db: AsyncSession,
        user_id: str,
        query: str,
        limit: int,
    ) -> list[MemoryHit]:
        from db.models import AgentMemorySeed

        terms = _query_terms(query)
        conditions: list[Any] = [AgentMemorySeed.user_id == user_id]
        if terms:
            clauses: list[Any] = []
            for term in terms:
                clauses.append(AgentMemorySeed.goal.ilike(f"%{term}%"))
                clauses.append(AgentMemorySeed.summary.ilike(f"%{term}%"))
            conditions.append(or_(*clauses))

        result = await db.execute(
            select(AgentMemorySeed)
            .where(and_(*conditions))
            .order_by(AgentMemorySeed.created_at.desc())
            .limit(max(1, limit))
        )
        rows = result.scalars().all()
        out: list[MemoryHit] = []
        for row in rows:
            summary = _compact_text(row.summary, 260)
            goal = _compact_text(row.goal, 160)
            content = f"{goal}: {summary}" if goal and summary else summary or goal
            if not content:
                continue
            importance = 0.72 if row.outcome == "done" else 0.45
            out.append(MemoryHit(
                content=content,
                layer="episode",
                source="agent_memory_seeds",
                category="episode",
                importance=importance,
                created_at=row.created_at.isoformat() if row.created_at else None,
                metadata={
                    "task_id": row.task_id,
                    "outcome": row.outcome,
                },
            ))
        return out

    def _dedupe_rank(self, hits: list[MemoryHit], *, limit: int) -> list[MemoryHit]:
        weighted: list[tuple[float, int, MemoryHit]] = []
        layer_bonus = {
            "strategic": 0.35,
            "tactical": 0.28,
            "geo": 0.22,
            "episode": 0.12,
            "archive": 0.10,
        }
        for idx, hit in enumerate(hits):
            key = _compact_text(hit.content, 260).lower()
            if not key:
                continue
            score = (
                float(hit.relevance or 0.0)
                + float(hit.importance or 0.0)
                + layer_bonus.get(hit.layer, 0.0)
            )
            weighted.append((score, idx, hit))

        weighted.sort(key=lambda item: (-item[0], item[1]))
        out: list[MemoryHit] = []
        seen: set[str] = set()
        for _, _, hit in weighted:
            key = _compact_text(hit.content, 220).lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(hit)
            if len(out) >= limit:
                break
        return out


memory_brain = MemoryBrain()


__all__ = [
    "MemoryBrain",
    "MemoryHit",
    "MemoryWrite",
    "MemoryWriteReport",
    "extract_memory_writes",
    "memory_brain",
]
