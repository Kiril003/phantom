"""
Vertical V11 — Intelligence Hub REST surface.

Two endpoints under `/api/v1/`:

  GET  /intelligence-hub          — single-call aggregate of every piece of
                                    operator-related knowledge for the
                                    authenticated user. Vault cards return
                                    metadata only (no secret plaintext).

  POST /intelligence-hub/search   — ranked cross-corpus semantic search
                                    across vault, facts, lessons, strategic
                                    memory, and agent decisions.

Per-user isolation is absolute: every query is scoped to the authenticated
user's id.  Vault secrets are NEVER returned — only redacted summaries.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import (
    AgentAuditEntry,
    User,
    UserFact,
    VaultCard,
)
from security.auth import TokenPayload, require_auth
from security.crypto import InvalidToken, decrypt_pii

logger = logging.getLogger(__name__)

router = APIRouter(tags=["intelligence"])


# ─── Response shapes ─────────────────────────────────────────────────────────


class VaultCardMeta(BaseModel):
    """Metadata-only view of a vault card — no secret field values."""
    id: str
    kind: str
    title: str
    redacted_summary: str   # e.g. "AWS access key · last revealed 2h ago"
    secret_count: int
    plain_count: int
    updated_at: datetime
    last_accessed_at: Optional[datetime]
    tags: list[str]


class UserFactView(BaseModel):
    id: str
    category: str
    label: Optional[str]
    text: str           # decrypted value (plaintext)
    source: str         # "user_facts"
    captured_at: datetime
    exclude_from_prompts: bool


class LessonView(BaseModel):
    lesson_id: str
    task_id: Optional[str]
    what_worked: str
    what_avoid: str
    applicability: str
    times_helped: int   # approximated from relevance hits; 0 when unavailable
    created_at: Optional[str]


class MemoryFactView(BaseModel):
    fact_id: str
    content: str
    category: str
    importance: float
    created_at: Optional[str]


class DecisionView(BaseModel):
    id: int
    task_id: str
    step_idx: int
    action_name: str
    intent: Optional[str]
    ok: bool
    elapsed_ms: int
    timestamp: datetime


class IntelligenceHubSnapshot(BaseModel):
    user_id: str
    composed_at: str
    counts: dict[str, int]
    vault_cards: list[VaultCardMeta]
    user_facts: list[UserFactView]
    behavioural_model: dict[str, Any]
    lessons: list[LessonView]
    memory_facts: list[MemoryFactView]
    recent_decisions: list[DecisionView]


# ─── Search shapes ────────────────────────────────────────────────────────────


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=400)
    sources: Optional[list[Literal["vault", "facts", "lessons", "memory", "decisions"]]] = None
    top_k: int = Field(default=10, ge=1, le=50)


class SearchHit(BaseModel):
    source: str
    object_id: str
    snippet: str
    score: float
    metadata: dict[str, Any]


class SearchResponse(BaseModel):
    hits: list[SearchHit]
    query: str
    elapsed_ms: int


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _redacted_summary(card: VaultCard) -> str:
    """Build a useful but secret-free summary string for a vault card."""
    try:
        raw = json.loads(card.fields_json or "{}")
    except Exception:
        raw = {}
    secret_count = sum(
        1 for v in raw.values()
        if isinstance(v, dict) and v.get("secret")
    )
    plain_count = len(raw) - secret_count

    parts: list[str] = [f"kind={card.kind}"]
    if plain_count > 0:
        parts.append(f"{plain_count} plain field(s)")
    if secret_count > 0:
        parts.append(f"{secret_count} secret(s)")
    if card.last_accessed_at:
        delta_s = int(
            (datetime.now(tz=timezone.utc) - card.last_accessed_at.replace(tzinfo=timezone.utc)).total_seconds()
        )
        if delta_s < 3600:
            parts.append(f"last accessed {delta_s // 60}m ago")
        elif delta_s < 86400:
            parts.append(f"last accessed {delta_s // 3600}h ago")
        else:
            parts.append(f"last accessed {delta_s // 86400}d ago")
    return " · ".join(parts)


def _serialise_vault_meta(card: VaultCard) -> VaultCardMeta:
    try:
        raw = json.loads(card.fields_json or "{}")
    except Exception:
        raw = {}
    try:
        tags = json.loads(card.tags_json or "[]")
        if not isinstance(tags, list):
            tags = []
    except Exception:
        tags = []

    secret_count = sum(1 for v in raw.values() if isinstance(v, dict) and v.get("secret"))
    plain_count = len(raw) - secret_count
    return VaultCardMeta(
        id=card.id,
        kind=card.kind,
        title=card.label,
        redacted_summary=_redacted_summary(card),
        secret_count=secret_count,
        plain_count=plain_count,
        updated_at=card.updated_at,
        last_accessed_at=card.last_accessed_at,
        tags=list(tags),
    )


def _decrypt_fact_safe(fact: UserFact) -> str:
    """Decrypt a UserFact value; return '[corrupt]' on error."""
    try:
        return decrypt_pii(fact.value_encrypted)
    except (InvalidToken, Exception):
        return "[corrupt]"


async def _load_vault_cards(db: AsyncSession, user_id: str) -> list[VaultCardMeta]:
    stmt = (
        select(VaultCard)
        .where(VaultCard.owner_user_id == user_id, VaultCard.deleted_at.is_(None))
        .order_by(desc(VaultCard.updated_at))
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialise_vault_meta(r) for r in rows]


async def _load_user_facts(db: AsyncSession, user_id: str) -> list[UserFactView]:
    stmt = (
        select(UserFact)
        .where(UserFact.user_id == user_id)
        .order_by(UserFact.created_at)
    )
    rows = (await db.execute(stmt)).scalars().all()
    out: list[UserFactView] = []
    for r in rows:
        out.append(UserFactView(
            id=r.id,
            category=r.category,
            label=r.label,
            text=_decrypt_fact_safe(r),
            source="user_facts",
            captured_at=r.created_at,
            exclude_from_prompts=bool(r.exclude_from_prompts),
        ))
    return out


async def _load_recent_decisions(db: AsyncSession, user_id: str, limit: int = 20) -> list[DecisionView]:
    stmt = (
        select(AgentAuditEntry)
        .where(AgentAuditEntry.user_id == user_id)
        .order_by(desc(AgentAuditEntry.id))
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    out: list[DecisionView] = []
    for r in rows:
        try:
            result = json.loads(r.result_json or "{}")
            ok = bool(result.get("ok", True))
        except Exception:
            ok = True
        out.append(DecisionView(
            id=r.id,
            task_id=r.task_id,
            step_idx=r.step_idx,
            action_name=r.action_name,
            intent=r.intent,
            ok=ok,
            elapsed_ms=r.elapsed_ms,
            timestamp=r.timestamp,
        ))
    return out


async def _load_lessons(user_id: str, top_k: int = 20) -> list[LessonView]:
    """Pull top-k lessons from ChromaDB.  Returns [] if ChromaDB unavailable."""
    try:
        from agent.cognition.memory.lessons import recall_lessons
        rows = await recall_lessons(query=f"user:{user_id}", k=top_k, user_id=user_id)
        out: list[LessonView] = []
        for r in rows:
            out.append(LessonView(
                lesson_id=r.get("lesson_id") or f"lesson_{r.get('task_id', '')}",
                task_id=r.get("task_id"),
                what_worked=r.get("what_worked") or "",
                what_avoid=r.get("what_avoid") or "",
                applicability=r.get("applicability") or "",
                times_helped=0,
                created_at=r.get("created_at"),
            ))
        return out
    except Exception as exc:
        logger.debug("_load_lessons ChromaDB unavailable: %s", exc)
        return []


async def _load_memory_facts(user_id: str, top_k: int = 30) -> list[MemoryFactView]:
    """Pull top-k strategic memory facts.  Returns [] if ChromaDB unavailable."""
    try:
        from memory.strategic_memory import _get_client, _get_ef, _collection_name
        import asyncio

        def _sync_get_all() -> list[dict[str, Any]]:
            client = _get_client()
            ef = _get_ef()
            coll_name = _collection_name(user_id)
            try:
                coll = client.get_collection(name=coll_name, embedding_function=ef)
            except Exception:
                return []
            try:
                res = coll.get(
                    where={"user_id": user_id},
                    include=["documents", "metadatas"],
                    limit=top_k,
                )
            except Exception:
                # ChromaDB may not support 'limit' in get() — fall back to a
                # broad fetch then slice
                try:
                    res = coll.get(
                        where={"user_id": user_id},
                        include=["documents", "metadatas"],
                    )
                except Exception:
                    return []

            ids = res.get("ids", []) or []
            docs = res.get("documents", []) or []
            metas = res.get("metadatas", []) or []
            out: list[dict[str, Any]] = []
            for i, fid in enumerate(ids[:top_k]):
                doc = docs[i] if i < len(docs) else ""
                meta = metas[i] if i < len(metas) else {}
                if not doc:
                    continue
                out.append({
                    "fact_id": fid,
                    "content": doc,
                    "category": (meta or {}).get("category", "fact"),
                    "importance": float((meta or {}).get("importance", 0.5)),
                    "created_at": (meta or {}).get("created_at"),
                })
            return out

        rows = await asyncio.to_thread(_sync_get_all)
        return [MemoryFactView(**r) for r in rows]
    except Exception as exc:
        logger.debug("_load_memory_facts ChromaDB unavailable: %s", exc)
        return []


async def _load_behavioural_model(db: AsyncSession, user_id: str) -> dict[str, Any]:
    row = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if row is None:
        return {}
    try:
        return json.loads(row.behavioral_model_json or "{}")
    except Exception:
        return {}


# ─── GET /intelligence-hub ───────────────────────────────────────────────────


@router.get("/intelligence-hub", response_model=IntelligenceHubSnapshot)
async def get_intelligence_hub(
    token: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> IntelligenceHubSnapshot:
    """Single-call aggregate of every piece of operator-related knowledge.

    Vault cards return metadata only — no secret plaintext.
    Reveal of secrets stays gated on the existing /vault/cards/{id}/reveal
    endpoint with its audit trail and biometric gate.
    """
    user_id = token.user_id

    import asyncio
    vault_cards, user_facts, decisions, lessons, memory_facts, bmodel = await asyncio.gather(
        _load_vault_cards(db, user_id),
        _load_user_facts(db, user_id),
        _load_recent_decisions(db, user_id, limit=20),
        _load_lessons(user_id, top_k=20),
        _load_memory_facts(user_id, top_k=30),
        _load_behavioural_model(db, user_id),
    )

    counts = {
        "vault_cards": len(vault_cards),
        "facts": len(user_facts),
        "lessons": len(lessons),
        "memory_facts": len(memory_facts),
        "recent_decisions": len(decisions),
    }

    return IntelligenceHubSnapshot(
        user_id=user_id,
        composed_at=datetime.now(tz=timezone.utc).isoformat(),
        counts=counts,
        vault_cards=vault_cards,
        user_facts=user_facts,
        behavioural_model=bmodel,
        lessons=lessons,
        memory_facts=memory_facts,
        recent_decisions=decisions,
    )


# ─── POST /intelligence-hub/search ───────────────────────────────────────────


@router.post("/intelligence-hub/search", response_model=SearchResponse)
async def search_intelligence(
    req: SearchRequest,
    token: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> SearchResponse:
    """Ranked cross-corpus semantic search across the operator's knowledge corpora.

    Sources:
      vault     — card title + kind + tags via LIKE (secrets excluded from vectors)
      facts     — user_facts decrypted text via LIKE
      lessons   — ChromaDB semantic search via recall_lessons
      memory    — ChromaDB semantic search via retrieve_relevant
      decisions — agent_audit intent + action_name via LIKE
    """
    t0 = time.monotonic()
    user_id = token.user_id
    q = req.query.strip()
    sources = set(req.sources) if req.sources else {"vault", "facts", "lessons", "memory", "decisions"}
    hits: list[SearchHit] = []

    import asyncio

    # ── vault ────────────────────────────────────────────────────────────────
    if "vault" in sources:
        try:
            q_lower = q.lower()
            stmt = (
                select(VaultCard)
                .where(
                    VaultCard.owner_user_id == user_id,
                    VaultCard.deleted_at.is_(None),
                )
                .order_by(desc(VaultCard.updated_at))
                .limit(200)
            )
            rows = (await db.execute(stmt)).scalars().all()
            for card in rows:
                try:
                    tags = json.loads(card.tags_json or "[]")
                    tags_str = " ".join(tags) if isinstance(tags, list) else ""
                except Exception:
                    tags_str = ""
                hay = f"{card.label} {card.kind} {tags_str}".lower()
                if q_lower in hay:
                    score = 0.7 if q_lower in card.label.lower() else 0.5
                    hits.append(SearchHit(
                        source="vault",
                        object_id=card.id,
                        snippet=f"{card.kind}: {card.label}",
                        score=score,
                        metadata={
                            "kind": card.kind,
                            "updated_at": card.updated_at.isoformat(),
                            "tags": tags if isinstance(tags, list) else [],
                        },
                    ))
        except Exception as exc:
            logger.warning("search vault failed: %s", exc)

    # ── facts ─────────────────────────────────────────────────────────────────
    if "facts" in sources:
        try:
            stmt = (
                select(UserFact)
                .where(UserFact.user_id == user_id)
                .order_by(UserFact.created_at)
            )
            rows = (await db.execute(stmt)).scalars().all()
            q_lower = q.lower()
            for fact in rows:
                plaintext = _decrypt_fact_safe(fact)
                label_str = (fact.label or "").lower()
                if q_lower in plaintext.lower() or q_lower in label_str or q_lower in fact.category.lower():
                    snippet = plaintext[:200] if plaintext != "[corrupt]" else "[encrypted — key rotation needed]"
                    hits.append(SearchHit(
                        source="facts",
                        object_id=fact.id,
                        snippet=snippet,
                        score=0.65,
                        metadata={
                            "category": fact.category,
                            "label": fact.label,
                            "exclude_from_prompts": bool(fact.exclude_from_prompts),
                            "captured_at": fact.created_at.isoformat(),
                        },
                    ))
        except Exception as exc:
            logger.warning("search facts failed: %s", exc)

    # ── lessons ───────────────────────────────────────────────────────────────
    if "lessons" in sources:
        try:
            from agent.cognition.memory.lessons import recall_lessons
            lessons = await recall_lessons(query=q, k=req.top_k, user_id=user_id)
            for lesson in lessons:
                snippet = " | ".join(filter(None, [
                    lesson.get("what_worked", "")[:120],
                    lesson.get("what_avoid", "")[:120],
                ]))
                hits.append(SearchHit(
                    source="lessons",
                    object_id=lesson.get("lesson_id") or f"lesson_{lesson.get('task_id', '')}",
                    snippet=snippet or lesson.get("document", "")[:200],
                    score=float(lesson.get("relevance", 0.5)),
                    metadata={
                        "task_id": lesson.get("task_id"),
                        "applicability": lesson.get("applicability"),
                        "created_at": lesson.get("created_at"),
                    },
                ))
        except Exception as exc:
            logger.debug("search lessons ChromaDB unavailable: %s", exc)

    # ── memory ────────────────────────────────────────────────────────────────
    if "memory" in sources:
        try:
            from memory.strategic_memory import retrieve_relevant
            docs = await retrieve_relevant(user_id, query=q, top_k=req.top_k)
            for i, doc in enumerate(docs):
                score = max(0.3, 0.9 - i * 0.05)
                hits.append(SearchHit(
                    source="memory",
                    object_id=f"mem_{user_id}_{i}",
                    snippet=doc[:200],
                    score=score,
                    metadata={},
                ))
        except Exception as exc:
            logger.debug("search memory ChromaDB unavailable: %s", exc)

    # ── decisions ─────────────────────────────────────────────────────────────
    if "decisions" in sources:
        try:
            q_lower = q.lower()
            stmt = (
                select(AgentAuditEntry)
                .where(
                    AgentAuditEntry.user_id == user_id,
                    or_(
                        AgentAuditEntry.intent.ilike(f"%{q}%"),
                        AgentAuditEntry.action_name.ilike(f"%{q}%"),
                    ),
                )
                .order_by(desc(AgentAuditEntry.id))
                .limit(50)
            )
            rows = (await db.execute(stmt)).scalars().all()
            for r in rows:
                snippet = (r.intent or r.action_name or "")[:200]
                hits.append(SearchHit(
                    source="decisions",
                    object_id=str(r.id),
                    snippet=snippet,
                    score=0.6,
                    metadata={
                        "task_id": r.task_id,
                        "action_name": r.action_name,
                        "step_idx": r.step_idx,
                        "timestamp": r.timestamp.isoformat(),
                    },
                ))
        except Exception as exc:
            logger.warning("search decisions failed: %s", exc)

    # ── rank + cap ────────────────────────────────────────────────────────────
    hits.sort(key=lambda h: h.score, reverse=True)
    hits = hits[:req.top_k]

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return SearchResponse(hits=hits, query=q, elapsed_ms=elapsed_ms)


@router.post("/intelligence-hub/consolidate")
async def trigger_consolidation(
    token: TokenPayload = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Manually trigger the memory consolidation cycle for the authenticated user."""
    from memory.consolidation import run_consolidation_cycle
    user_id = token.user_id
    report = await run_consolidation_cycle(db, user_id)
    return {"ok": True, "report": report}
