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


def client_initialized() -> bool:
    """True when `_get_client` has been invoked at least once. Cheap check
    used by readiness probes so /readyz doesn't trigger a cold scan over
    leaked-collection dirs (audit-2026-04-29 D2-A6 / G-1)."""
    return _chroma_client is not None


async def init_chroma_eager() -> dict[str, Any]:
    """Open the chroma client + enumerate collections at lifespan startup
    so the first /readyz hit doesn't pay the 2-3 s cold-scan cost.

    Returns ``{"collections": int, "elapsed_ms": int}``. Never raises —
    if chroma is unavailable the call returns ``{"ok": False, "error":
    ...}`` and the daemon continues; readyz will then 503.
    """
    import time as _t

    def _warm() -> dict[str, Any]:
        t0 = _t.monotonic()
        client = _get_client()
        try:
            cols = client.list_collections()
            count = len(cols)
        except (KeyError, Exception) as exc:
            # Phase 9.4c audit hotfix — Chroma 0.5.x raises KeyError: '_type'
            # if the metadata JSON in chroma.sqlite3 was written by an
            # incompatible older version. Log it and return 0 so the
            # system continues; readyz will report 503 if strict health
            # is required.
            logger.error("Chroma list_collections failed (likely metadata version mismatch): %s", exc)
            count = 0

        return {
            "collections": count,
            "elapsed_ms": int((_t.monotonic() - t0) * 1000),
        }

    try:
        return await asyncio.to_thread(_warm)
    except Exception as exc:  # noqa: BLE001
        logger.warning("init_chroma_eager failed: %s", exc)
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _sync_prune_orphans(
    known_user_ids: set[str], dry_run: bool
) -> dict[str, Any]:
    client = _get_client()
    cols = client.list_collections()
    deleted: list[str] = []
    kept: list[str] = []
    failures: list[dict[str, str]] = []
    for col in cols:
        # PersistentClient returns Collection objects; the .name attribute
        # is the canonical lookup key for delete_collection.
        name = getattr(col, "name", None) or str(col)
        if not name.startswith("user_"):
            kept.append(name)
            continue
        # Strip the prefix and compare against known users. The prefix
        # safe_id is sanitised in `_collection_name` so this is a direct
        # match — no test-fixture leakage logic here, that lives in
        # `_sync_retrieve`.
        suffix = name[len("user_") :]
        if suffix in known_user_ids:
            kept.append(name)
            continue
        if dry_run:
            deleted.append(name)
            continue
        try:
            client.delete_collection(name=name)
            deleted.append(name)
        except Exception as exc:  # noqa: BLE001
            failures.append({"name": name, "error": f"{type(exc).__name__}: {exc}"})
    return {
        "scanned": len(cols),
        "kept": len(kept),
        "deleted": deleted,
        "failures": failures,
        "dry_run": dry_run,
    }


async def prune_orphan_collections(
    known_user_ids: set[str], *, dry_run: bool = False
) -> dict[str, Any]:
    """Delete `user_*` ChromaDB collections whose suffix isn't a known
    user id. Closes audit F-17 — the leaked-collection backlog (633 dirs
    on the dev box at the time of the Day-2 audit) was caused by tests
    that create a transient user collection and never delete it.

    `known_user_ids` is the caller's responsibility — typically the
    distinct `User.id` set from the SQL DB. `dry_run=True` reports what
    would be deleted without touching anything.
    """
    return await asyncio.to_thread(_sync_prune_orphans, known_user_ids, dry_run)


# ── Filesystem-level orphan cleanup (F-17) ─────────────────────────────────────
#
# Per-collection HNSW indices live in `<chroma_path>/<collection-uuid>/`. When
# tests delete the SQLite metadata without cleaning the dir (or when the
# operator wipes the DB but not the path), those dirs persist as 100s of MB
# of dead weight. `list_collections()` doesn't iterate them — but the disk
# pressure still hurts cold start, backups, and Docker image size. The
# CLI janitor calls `prune_orphan_dirs` after `prune_orphan_collections`
# so the two layers stay in sync.


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _live_collection_ids(client: Any) -> set[str]:
    """Return the set of UUID directory names that the persistent client
    currently considers live. Each Collection object exposes `.id` —
    str(UUID) — which matches the on-disk dir name."""
    out: set[str] = set()
    try:
        cols = client.list_collections()
    except (KeyError, Exception) as exc:
        logger.error("Chroma list_collections failed in janitor: %s", exc)
        return out

    for col in cols:
        # Defensive check: some versions return dicts, some return objects.
        if isinstance(col, dict):
            cid = col.get("id")
        else:
            cid = getattr(col, "id", None)
        if cid is not None:
            out.add(str(cid))
    return out


def _sync_prune_orphan_dirs(dry_run: bool) -> dict[str, Any]:
    import shutil
    from pathlib import Path as _Path

    base = _Path(config.chroma_path)
    if not base.is_dir():
        return {
            "scanned": 0,
            "live": 0,
            "deleted_dirs": [],
            "freed_bytes": 0,
            "failures": [],
            "dry_run": dry_run,
        }

    client = _get_client()
    live = _live_collection_ids(client)

    deleted: list[str] = []
    failures: list[dict[str, str]] = []
    freed_bytes = 0
    scanned = 0
    for entry in base.iterdir():
        if not entry.is_dir():
            continue
        if not _UUID_RE.match(entry.name):
            # Some chromadb versions also create a `metadata` or
            # similarly-named dir — leave anything that's not a UUID alone.
            continue
        scanned += 1
        if entry.name in live:
            continue
        # Compute size before delete so the summary reports actual freed
        # bytes — useful when running in dry-run mode to size the impact.
        size = 0
        try:
            for sub in entry.rglob("*"):
                if sub.is_file():
                    try:
                        size += sub.stat().st_size
                    except OSError:
                        pass
        except OSError:
            pass

        if dry_run:
            deleted.append(entry.name)
            freed_bytes += size
            continue

        try:
            shutil.rmtree(entry)
            deleted.append(entry.name)
            freed_bytes += size
        except Exception as exc:  # noqa: BLE001
            failures.append({"name": entry.name, "error": f"{type(exc).__name__}: {exc}"})

    return {
        "scanned": scanned,
        "live": len(live),
        "deleted_dirs": deleted,
        "freed_bytes": freed_bytes,
        "failures": failures,
        "dry_run": dry_run,
    }


async def prune_orphan_dirs(*, dry_run: bool = False) -> dict[str, Any]:
    """Remove UUID-named subdirs of `config.chroma_path` that no longer
    correspond to a live collection. These are HNSW index leftovers
    from tests / DB resets that the SQL-side `prune_orphan_collections`
    pass can't see — without them, audit F-17's "533 dirs / 110 MB"
    backlog stays on disk forever.

    Returns ``{"scanned", "live", "deleted_dirs", "freed_bytes",
    "failures", "dry_run"}``. Idempotent.
    """
    return await asyncio.to_thread(_sync_prune_orphan_dirs, dry_run)


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
        metas = results.get("metadatas", [[]])[0] or [{} for _ in docs]
        # Phase 9.4c-qw fix #4 — defensive filter against test-fixture
        # leakage. Pre-cleanup the prod DB had ~70 rows of the form
        # ("Fact N", "Place N") at (50.0, 30.0) that competed with
        # real geo facts for top-K slots.
        out: list[str] = []
        for doc, meta in zip(docs, metas):
            if not doc:
                continue
            place_name = (meta or {}).get("place_name") if isinstance(meta, dict) else None
            if (
                isinstance(doc, str)
                and doc.startswith("Fact ")
                and isinstance(place_name, str)
                and place_name.startswith("Place ")
            ):
                continue
            out.append(str(doc))
        return out
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
