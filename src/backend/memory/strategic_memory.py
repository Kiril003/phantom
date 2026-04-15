"""
PHANTOM OS — Strategic Memory (ChromaDB vector store).
Long-term persistent memory indexed by semantic embeddings.
One ChromaDB collection per user: "user_{user_id}".

ChromaDB PersistentClient is synchronous — all calls are wrapped in
asyncio.to_thread() to avoid blocking the event loop.
Client and embedding function are module-level singletons to avoid
reloading the ONNX model on every request.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from config import config

logger = logging.getLogger(__name__)

# ── Module-level singletons (lazy, loaded on first use) ───────────────────────

_chroma_client: Any | None = None
_embedding_fn: Any | None = None


def _get_client() -> Any:
    global _chroma_client
    if _chroma_client is None:
        import chromadb as _chromadb
        _chroma_client = _chromadb.PersistentClient(path=config.chroma_path)
    return _chroma_client


def _get_ef() -> Any:
    global _embedding_fn
    if _embedding_fn is None:
        from chromadb.utils import embedding_functions as _ef
        _embedding_fn = _ef.SentenceTransformerEmbeddingFunction(
            model_name=config.embedding_model
        )
    return _embedding_fn


def _collection_name(user_id: str) -> str:
    # ChromaDB collection names: 3-63 chars, alphanumeric + _ and -
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)[:32]
    return f"user_{safe_id}"


# ── Sync helpers (run inside to_thread) ───────────────────────────────────────

def _sync_store_fact(
    user_id: str,
    fact_id: str,
    content: str,
    category: str,
    importance: float,
    metadata_extra: dict[str, Any] | None,
) -> str:
    client = _get_client()
    ef = _get_ef()
    collection = client.get_or_create_collection(
        name=_collection_name(user_id),
        embedding_function=ef,  # type: ignore[arg-type]
    )
    meta: dict[str, Any] = {
        "user_id": user_id,
        "category": category,
        "importance": float(importance),
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
        "is_sealed": False,
    }
    if metadata_extra:
        meta.update(metadata_extra)
    collection.add(
        ids=[fact_id],
        documents=[content],
        metadatas=[meta],  # type: ignore[list-item]
    )
    return fact_id


def _sync_retrieve(
    user_id: str, query: str, k: int, min_importance: float
) -> list[str]:
    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    try:
        collection = client.get_collection(name=coll_name, embedding_function=ef)  # type: ignore[arg-type]
    except Exception:
        return []

    count = collection.count()
    if count == 0:
        return []

    where: dict[str, Any] = {"is_sealed": False}
    if min_importance > 0.0:
        where["importance"] = {"$gte": min_importance}

    try:
        results = collection.query(
            query_texts=[query],
            n_results=min(k, count),
            where=where,
        )
        docs = results.get("documents", [[]])[0]
        return [str(d) for d in docs if d]
    except Exception as exc:
        logger.warning("ChromaDB query failed for user %s: %s", user_id, exc)
        return []


def _sync_update_meta(user_id: str, fact_id: str, updates: dict[str, Any]) -> None:
    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    try:
        collection = client.get_collection(name=coll_name, embedding_function=ef)  # type: ignore[arg-type]
        collection.update(ids=[fact_id], metadatas=[updates])  # type: ignore[list-item]
    except Exception as exc:
        logger.warning("ChromaDB update failed for %s: %s", fact_id, exc)


def _sync_delete(user_id: str, fact_id: str) -> None:
    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    try:
        collection = client.get_collection(name=coll_name, embedding_function=ef)  # type: ignore[arg-type]
        collection.delete(ids=[fact_id])
    except Exception as exc:
        logger.warning("ChromaDB delete failed for %s: %s", fact_id, exc)


def _sync_count(user_id: str) -> int:
    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    try:
        collection = client.get_collection(name=coll_name, embedding_function=ef)  # type: ignore[arg-type]
        return collection.count()
    except Exception:
        return 0


# ── Public async API ──────────────────────────────────────────────────────────

async def store_fact(
    user_id: str,
    fact_id: str,
    content: str,
    category: str = "fact",
    importance: float = 0.5,
    metadata_extra: dict[str, Any] | None = None,
) -> str:
    """Store a fact in ChromaDB. Returns the embedding ID (same as fact_id)."""
    return await asyncio.to_thread(
        _sync_store_fact, user_id, fact_id, content, category, importance, metadata_extra
    )


async def retrieve_relevant(
    user_id: str,
    query: str,
    top_k: int | None = None,
    min_importance: float = 0.0,
) -> list[str]:
    """Semantic search over the user's strategic memory. Returns relevant fact strings."""
    k = top_k if top_k is not None else config.memory_top_k
    return await asyncio.to_thread(_sync_retrieve, user_id, query, k, min_importance)


async def seal_fact(user_id: str, fact_id: str) -> None:
    """Mark a fact as sealed (never returned in normal queries)."""
    await asyncio.to_thread(_sync_update_meta, user_id, fact_id, {"is_sealed": True})


async def delete_fact(user_id: str, fact_id: str) -> None:
    """Permanently remove a fact from ChromaDB."""
    await asyncio.to_thread(_sync_delete, user_id, fact_id)


async def user_fact_count(user_id: str) -> int:
    """Return total number of facts stored for a user."""
    return await asyncio.to_thread(_sync_count, user_id)


# ── Fact categorization heuristics ────────────────────────────────────────────

_CATEGORY_PATTERNS: list[tuple[str, list[str]]] = [
    ("preference", [
        r"\bподобається\b", r"\bне\s+подобається\b", r"\bлюблю\b", r"\bне\s+люблю\b",
        r"\blike\b", r"\bdislike\b", r"\bprefer\b", r"\bfavorite\b",
        r"\bвибираю\b", r"\bзавжди\b", r"\bніколи\b",
    ]),
    ("decision", [
        r"\bвирішив\b", r"\bвирішила\b", r"\bplan\b", r"\bпланую\b",
        r"\bdecided\b", r"\bwill\b", r"\bзбираюсь\b", r"\bbudu\b",
    ]),
    ("event", [
        r"\bвчора\b", r"\bсьогодні\b", r"\bзавтра\b", r"\byesterday\b",
        r"\btoday\b", r"\btomorrow\b", r"\bwas\b", r"\bwent\b",
        r"\bбув\b", r"\bпішов\b", r"\bповернувся\b",
    ]),
    ("emotion", [
        r"\bвтомився\b", r"\bщасливий\b", r"\bсумний\b", r"\bстрес\b",
        r"\btired\b", r"\bhappy\b", r"\bsad\b", r"\banxious\b",
        r"\bтривога\b", r"\bрадість\b",
    ]),
    ("pattern", [
        r"\bзазвичай\b", r"\bщодня\b", r"\bщотижня\b", r"\busually\b",
        r"\bevery\b", r"\balways\b", r"\bnever\b", r"\bregularly\b",
    ]),
]


def _classify_sentence(sentence: str) -> str:
    """Classify a sentence into one of the MemoryFact categories."""
    lower = sentence.lower()
    for category, patterns in _CATEGORY_PATTERNS:
        for pat in patterns:
            if re.search(pat, lower):
                return category
    return "fact"


def _score_importance(sentence: str, category: str) -> float:
    """Score importance 0–1 based on sentence length, category, and keywords."""
    word_count = len(sentence.split())
    # Base from length: 20w→0.5, 40w→0.7, 5w→0.3
    base = min(0.9, 0.3 + word_count * 0.015)

    # Category boosts
    boosts = {
        "decision": 0.15,
        "event": 0.1,
        "preference": 0.1,
        "emotion": 0.05,
        "pattern": 0.1,
        "fact": 0.0,
    }
    return min(1.0, base + boosts.get(category, 0.0))


# ── Memory write pipeline ─────────────────────────────────────────────────────

async def extract_and_store_facts(
    user_id: str,
    session_id: str,
    conversation_summary: str,
    db: Any,
) -> list[str]:
    """
    Post-turn memory write pipeline:
    1. Split conversation summary into candidate sentences.
    2. Classify each sentence into a MemoryFact category.
    3. Score importance (0–1).
    4. Store facts above threshold in the tactical layer.
    5. Return stored fact IDs.
    """
    from memory.tactical_memory import store_fact as tactical_store

    # Sentence splitting: split on ". ", ".\n", "! ", "? "
    raw_sentences = re.split(r"(?<=[.!?])\s+", conversation_summary.replace("\n", " "))
    sentences = [s.strip() for s in raw_sentences if len(s.strip()) > 20]

    stored_ids: list[str] = []
    for sentence in sentences[:15]:  # Cap at 15 sentences per turn
        category = _classify_sentence(sentence)
        importance = _score_importance(sentence, category)

        if importance >= config.memory_importance_threshold:
            fact_id = await tactical_store(
                db=db,
                user_id=user_id,
                session_id=session_id,
                content=sentence,
                category=category,
                importance=importance,
            )
            stored_ids.append(fact_id)

    return stored_ids
