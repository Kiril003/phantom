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
import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from config import config

logger = logging.getLogger(__name__)

# ── Module-level singletons (lazy, loaded on first use) ───────────────────────

_chroma_client: Any | None = None
_embedding_fn: Any | None = None


def _chroma_settings() -> Any:
    """Chroma settings for every client we open.

    `chromadb.config.Settings` ships `anonymized_telemetry=True` with a PostHog
    backend, so a bare `PersistentClient(path=...)` starts a thread that POSTs
    usage events off the device. PHANTOM is a personal assistant that runs on
    the user's own hardware and keeps encrypted GHOST records and a sealed
    archive — nothing about it should be reporting to a third party, and the
    user is never asked. Opt out at construction, which is the only place the
    flag is read.
    """
    from chromadb.config import Settings

    return Settings(anonymized_telemetry=False)


def _get_client() -> Any:
    """Open the persistent Chroma client, or fail loudly.

    This used to treat ANY exception as "corrupted DB" and `shutil.rmtree` the
    whole store before recreating it. A locked SQLite file, a permissions blip,
    a transient I/O error or simple concurrent access was therefore enough to
    silently destroy every long-term memory the user had — irrecoverably, for a
    product whose entire premise is that it remembers. It also cascaded through
    the test suite: one wipe left later tests with a client pointed at a deleted
    path ("Could not connect to tenant default_tenant").

    Recovery is now opt-in and non-destructive: the damaged directory is moved
    aside so an operator can inspect or restore it, never deleted.
    """
    global _chroma_client
    if _chroma_client is None:
        import chromadb as _chromadb
        import os
        try:
            client = _chromadb.PersistentClient(
                path=config.chroma_path, settings=_chroma_settings(),
            )
            # Try to list collections to see if the DB metadata is corrupted
            client.list_collections()
            _chroma_client = client
        except Exception as exc:
            if not getattr(config, "chroma_auto_recover", False):
                logger.error(
                    "ChromaDB failed to open at %s: %s. Refusing to touch the "
                    "store — set `chroma_auto_recover=true` to quarantine it "
                    "and start fresh, or restore it from backup.",
                    config.chroma_path, exc,
                )
                raise
            quarantine = _quarantine_store(config.chroma_path)
            logger.error(
                "ChromaDB failed to open at %s: %s. Moved the damaged store to "
                "%s and started a fresh one — long-term memory is EMPTY until "
                "that directory is restored.",
                config.chroma_path, exc, quarantine,
            )
            os.makedirs(config.chroma_path, exist_ok=True)
            try:
                _chroma_client = _chromadb.PersistentClient(
                    path=config.chroma_path, settings=_chroma_settings(),
                )
            except Exception as retry_exc:
                logger.error("ChromaDB initialization failed again: %s", retry_exc)
                raise retry_exc
    return _chroma_client


def _quarantine_store(path: str) -> str:
    """Move a damaged store aside and return the new location.

    Renaming rather than deleting keeps the vectors recoverable; a wipe here is
    unrecoverable user data loss.
    """
    import os
    import time

    if not os.path.exists(path):
        return ""
    target = f"{path}.corrupt-{time.strftime('%Y%m%d-%H%M%S')}"
    suffix = 0
    while os.path.exists(target):
        suffix += 1
        target = f"{path}.corrupt-{time.strftime('%Y%m%d-%H%M%S')}-{suffix}"
    os.rename(path, target)
    return target


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
    
    # Dynamically resolve expected collection names for all active user ids
    expected_names = set()
    
    from agent.cognition.memory.embedder import _collection_name as ep_col_name
    from agent.cognition.memory.lessons import _collection_name as les_col_name
    
    import hashlib
    def _old_strategic_name(uid_str: str) -> str:
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", uid_str)
        body_budget = 49
        needs_disambig = safe_id != uid_str or len(safe_id) > body_budget or not safe_id
        if needs_disambig:
            digest = hashlib.sha256(uid_str.encode("utf-8")).hexdigest()[:8]
            body = safe_id[:body_budget] if safe_id else "x"
            return f"user_{body}_{digest}"
        return f"user_{safe_id}"

    def _old_episodes_name(uid_str: str | None = None) -> str:
        u = uid_str or "default"
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", u)
        body_budget = 45
        needs_disambig = safe_id != u or len(safe_id) > body_budget or not safe_id
        if needs_disambig:
            digest = hashlib.sha256(u.encode("utf-8")).hexdigest()[:8]
            body = safe_id[:body_budget] if safe_id else "x"
            return f"episodes_{body}_{digest}"
        return f"episodes_{safe_id}"

    def _old_lessons_name(uid_str: str | None = None) -> str:
        u = uid_str or "default"
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", u)
        body_budget = 46
        needs_disambig = safe_id != u or len(safe_id) > body_budget or not safe_id
        if needs_disambig:
            digest = hashlib.sha256(u.encode("utf-8")).hexdigest()[:8]
            body = safe_id[:body_budget] if safe_id else "x"
            return f"lessons_{body}_{digest}"
            
        return f"lessons_{safe_id}"

    uids = list(known_user_ids) + ["default"]
    for uid in uids:
        # New versioned collections
        expected_names.add(_collection_name(uid))
        expected_names.add(ep_col_name(uid))
        expected_names.add(les_col_name(uid))
        
        # Legacy collections for backward-compatibility
        if uid != "default":
            expected_names.add(_old_strategic_name(uid))
        expected_names.add(_old_episodes_name(uid))
        expected_names.add(_old_lessons_name(uid))
        
    deleted: list[str] = []
    kept: list[str] = []
    failures: list[dict[str, str]] = []
    
    prefixes = (
        "user_",
        "episodes_",
        "lessons_",
        "phantom_v1_user_",
        "phantom_v1_episodes_",
        "phantom_v1_lessons_",
    )
    
    for col in cols:
        name = getattr(col, "name", None) or str(col)
        
        # Only touch collections matching our prefixes
        if not any(name.startswith(p) for p in prefixes):
            kept.append(name)
            continue
            
        if name in expected_names:
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
    """Module-level embedding-function singleton — every Chroma consumer in
    the codebase (episodes, lessons, intelligence routes, fixtures) reaches
    the model through here, so it is also the one place worth checking that
    the on-disk vectors were written by the model we are about to query
    with. Both MiniLM and e5-small are 384-dim, so Chroma itself will never
    catch that mismatch (see memory/embedding_fn.py)."""
    global _embedding_fn
    if _embedding_fn is None:
        from memory.embedding_fn import (
            assert_store_matches_model,
            build_embedding_function,
        )
        assert_store_matches_model(config.chroma_path, config.embedding_model)
        _embedding_fn = build_embedding_function(config.embedding_model)
    return _embedding_fn


def _collection_name(user_id: str) -> str:
    """Per-user collection name for hard cross-user isolation (audit C-4).

    The previous implementation truncated the sanitised id at 32 chars,
    which collapsed any two user UUIDs sharing a 32-char prefix into the
    same chroma collection — a P0 privacy hole because strategic memory
    is a multi-tenant kiosk surface. The fix:

    1. Keep the chroma constraint of 3..63 chars + ``[a-zA-Z0-9_-]``.
    2. Preserve uniqueness for the full ``User.id`` UUID space — when
       sanitisation would shorten the id (or the id is longer than the
       budget), append an 8-char SHA-256 suffix so two distinct user_ids
       can never collide in the post-sanitised name.
    3. Reject empty / non-string ids loudly rather than silently routing
       writes to ``user_`` (the leak vector that originally landed C-4
       on the audit board).

    Defence-in-depth ``where={"user_id": user_id}`` filters live on
    every read path (see ``_sync_retrieve``); per-user collections are
    layer one, the where-filter is layer two — both must agree before
    a document leaves the collection.
    """
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError(
            "strategic_memory: user_id must be a non-empty string "
            f"(passed: {user_id!r})"
        )

    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)
    # Chroma's max collection name is 63 chars; "phantom_v1_user_" prefix = 16,
    # "_" + 8-char hash = 9, leaves 38 for the body when we need to
    # disambiguate. Short, already-sanitised ids skip the hash so the
    # H6 janitor test fixtures keep matching.
    body_budget = 38
    needs_disambiguation = (
        safe_id != user_id  # stripping changed something
        or len(safe_id) > body_budget  # over the chroma length budget
        or not safe_id  # empty after sanitisation
    )
    if needs_disambiguation:
        import hashlib
        digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:8]
        body = safe_id[:body_budget] if safe_id else "x"
        return f"phantom_v1_user_{body}_{digest}"
    return f"phantom_v1_user_{safe_id}"


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
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    meta: dict[str, Any] = {
        "user_id": user_id,
        "category": category,
        "importance": float(importance),
        "created_at": now_iso,
        "is_sealed": False,
        "valid_from": now_iso,
        "valid_until": "none",
        "superseded_by": "none",
        "entity_slot": "none",
        "sentiment_score": 0.0,
        "recall_count": 0,
        "last_recalled_at": "none",
    }
    if metadata_extra:
        # Sanitize metadata_extra for ChromaDB compat
        sanitized = {}
        for k, v in metadata_extra.items():
            if v is None:
                sanitized[k] = "none"
            elif isinstance(v, datetime):
                sanitized[k] = v.isoformat()
            else:
                sanitized[k] = v
        meta.update(sanitized)
        
    # MemoryBrain writes durable user facts immediately while the janitor can
    # later promote the same tactical fact id. Upsert keeps that path
    # idempotent instead of failing on duplicate Chroma ids.
    collection.upsert(
        ids=[fact_id],
        documents=[content],
        metadatas=[meta],  # type: ignore[list-item]
    )
    return fact_id


def _sync_retrieve(
    user_id: str, query: str, k: int, min_importance: float, user_trust_level: float = 0.5
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

    # C-4 defense-in-depth: AND the user_id filter on every read
    clauses: list[dict[str, Any]] = [
        {"is_sealed": False},
        {"user_id": user_id},
    ]
    if min_importance > 0.0:
        clauses.append({"importance": {"$gte": min_importance}})
    where: dict[str, Any] = {"$and": clauses} if len(clauses) > 1 else clauses[0]

    try:
        # Fetch up to 20 candidates for multi-signal reranking
        n_candidates = min(max(20, k), count)
        results = collection.query(
            query_texts=[query],
            n_results=n_candidates,
            where=where,
        )
        docs = results.get("documents", [[]])[0]
        ids = results.get("ids", [[]])[0]
        metas = results.get("metadatas", [[]])[0] or [{} for _ in docs]
        distances = results.get("distances", [[]])[0] or [0.0 for _ in docs]

        # Retrieve weights and settings
        w1 = getattr(config, "cognitive_memory_semantic_weight", 0.60)
        w2 = getattr(config, "cognitive_memory_recency_weight", 0.15)
        w3 = getattr(config, "cognitive_memory_recall_weight", 0.15)
        w4 = getattr(config, "cognitive_memory_sentiment_weight", 0.10)
        w5 = getattr(config, "cognitive_memory_state_weight", 0.0)
        half_life = getattr(config, "cognitive_memory_decay_half_life_days", 30.0)

        now = datetime.now(tz=timezone.utc)
        now_iso = now.isoformat()
        reranked: list[tuple[float, str, dict[str, Any], str]] = []

        for doc, fid, meta, dist in zip(docs, ids, metas, distances):
            if not doc:
                continue

            meta_dict = dict(meta or {})
            # C-4 belt-and-braces: refuse any row whose metadata user_id doesn't match
            meta_user = meta_dict.get("user_id")
            if meta_user is None or meta_user != user_id:
                continue

            # Phase 9.4c-qw fix #4 — defensive filter against test-fixture leakage
            place_name = meta_dict.get("place_name")
            if (
                isinstance(doc, str)
                and doc.startswith("Fact ")
                and isinstance(place_name, str)
                and place_name.startswith("Place ")
            ):
                continue

            # Phase 12.0 Temporal filter: skip if superseded/invalidated
            if meta_dict.get("valid_until", "none") != "none":
                continue

            # Phase 12.5 Trust-Gate filter: skip if disclosure_threshold > user_trust_level
            disclosure_threshold = float(meta_dict.get("disclosure_threshold", 0.0))
            if disclosure_threshold > user_trust_level:
                continue

            # Scorer calculation:
            # 1) Semantic similarity (1 - cosine distance)
            semantic_sim = max(0.0, min(1.0, 1.0 - float(dist)))
            
            # 2) Recency decay
            valid_from_str = meta_dict.get("valid_from", meta_dict.get("created_at", now_iso))
            try:
                valid_from = datetime.fromisoformat(valid_from_str)
                age_days = max(0.0, (now - valid_from).total_seconds() / (24 * 3600))
            except Exception:
                age_days = 0.0
            decay = 2.0 ** (-age_days / max(1.0, half_life))

            # 3) Log recall count
            recall_count = int(meta_dict.get("recall_count", 0))
            recall_score = math.log(max(0, recall_count) + 1)

            # 4) Sentiment score contribution
            sentiment_score = abs(float(meta_dict.get("sentiment_score", 0.0)))

            # State bonus (w5) is currently inactive/0 by default
            state_bonus = 0.0

            # Combined scorer formula
            score = (
                w1 * semantic_sim
                + w2 * decay
                + w3 * recall_score
                + w4 * sentiment_score
                + w5 * state_bonus
            )

            reranked.append((score, doc, meta_dict, fid))

        # Sort by score descending
        reranked.sort(key=lambda item: -item[0])

        # Take top-k, increment recall count for those matches asynchronously (or locally here)
        top_matches = reranked[:k]
        out_docs: list[str] = []
        for score, doc, meta_dict, fid in top_matches:
            out_docs.append(str(doc))
            
            # Increment recall metadata in ChromaDB (background update)
            try:
                meta_dict["recall_count"] = int(meta_dict.get("recall_count", 0)) + 1
                meta_dict["last_recalled_at"] = now_iso
                collection.update(ids=[fid], metadatas=[meta_dict])
            except Exception as e:
                logger.debug("Failed to update recall count for fact %s: %s", fid, e)

        return out_docs
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


def _sync_supersede_fact(user_id: str, old_fact_id: str, new_fact_id: str) -> None:
    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    try:
        collection = client.get_collection(name=coll_name, embedding_function=ef)
        # Fetch current metadata to preserve other fields
        res = collection.get(ids=[old_fact_id], include=["metadatas"])
        metas = res.get("metadatas", [])
        if metas and metas[0]:
            updated_meta = dict(metas[0])
            updated_meta["valid_until"] = datetime.now(tz=timezone.utc).isoformat()
            updated_meta["superseded_by"] = new_fact_id
            collection.update(ids=[old_fact_id], metadatas=[updated_meta])
    except Exception as exc:
        logger.warning("ChromaDB supersede failed for %s: %s", old_fact_id, exc)


def _sync_query_with_distances(user_id: str, query: str, k: int) -> list[dict[str, Any]]:
    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    try:
        collection = client.get_collection(name=coll_name, embedding_function=ef)
    except Exception:
        return []

    count = collection.count()
    if count == 0:
        return []

    where = {"user_id": user_id}
    try:
        results = collection.query(
            query_texts=[query],
            n_results=min(k, count),
            where=where,
        )
        ids = results.get("ids", [[]])[0]
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0] or [{} for _ in ids]
        distances = results.get("distances", [[]])[0] or [0.0 for _ in ids]
        
        out = []
        for fid, doc, meta, dist in zip(ids, docs, metas, distances):
            meta_dict = dict(meta or {})
            # Filter out superseded facts (if valid_until is set to something other than "none")
            if meta_dict.get("valid_until", "none") != "none":
                continue
            out.append({
                "id": fid,
                "content": str(doc or ""),
                "metadata": meta_dict,
                "distance": float(dist),
            })
        return out
    except Exception as exc:
        logger.warning("ChromaDB query_with_distances failed for user %s: %s", user_id, exc)
        return []


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
        # C-4 — count only THIS user's records. Stale fixture rows
        # without ``user_id`` metadata existed in the legacy collection
        # and would inflate the per-user fact count from a fresh user's
        # perspective; the where-filter excludes them.
        try:
            res = collection.get(where={"user_id": user_id}, include=[])
            ids = res.get("ids", []) if isinstance(res, dict) else []
            return len(ids)
        except Exception:
            return collection.count()
    except Exception:
        return 0


def _sync_purge_stale_records(user_id: str) -> dict[str, Any]:
    """Drop legacy records that lack ``user_id`` metadata from this
    user's collection. They predate C-4 (when collections were shared)
    so they belong to no one and can't be re-attributed.

    Idempotent. Returns ``{"removed": int}``. Used by migration scripts
    and the C-4 isolation tests as a one-shot janitor.
    """
    client = _get_client()
    ef = _get_ef()
    coll_name = _collection_name(user_id)
    try:
        collection = client.get_collection(
            name=coll_name, embedding_function=ef  # type: ignore[arg-type]
        )
    except Exception:
        return {"removed": 0}

    try:
        res = collection.get(include=["metadatas"])
        ids = res.get("ids", []) if isinstance(res, dict) else []
        metas = res.get("metadatas", []) if isinstance(res, dict) else []
    except Exception as exc:
        logger.warning("purge_stale: get() failed for %s: %s", user_id, exc)
        return {"removed": 0}

    stale: list[str] = []
    for fid, meta in zip(ids, metas):
        if not isinstance(meta, dict) or meta.get("user_id") != user_id:
            stale.append(fid)
    if not stale:
        return {"removed": 0}
    try:
        collection.delete(ids=stale)
    except Exception as exc:
        logger.warning("purge_stale: delete() failed for %s: %s", user_id, exc)
        return {"removed": 0}
    return {"removed": len(stale)}


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
    user_trust_level: float = 0.5,
) -> list[str]:
    """Semantic search over the user's strategic memory. Returns relevant fact strings."""
    k = top_k if top_k is not None else config.memory_top_k
    return await asyncio.to_thread(_sync_retrieve, user_id, query, k, min_importance, user_trust_level)


async def supersede_fact(user_id: str, old_fact_id: str, new_fact_id: str) -> None:
    """Mark an old fact as superseded by a new fact in ChromaDB metadata."""
    await asyncio.to_thread(_sync_supersede_fact, user_id, old_fact_id, new_fact_id)


async def query_with_distances(user_id: str, query: str, k: int) -> list[dict[str, Any]]:
    """Perform a raw query over ChromaDB returning facts with their cosine distances."""
    return await asyncio.to_thread(_sync_query_with_distances, user_id, query, k)


async def seal_fact(user_id: str, fact_id: str) -> None:
    """Mark a fact as sealed (never returned in normal queries)."""
    await asyncio.to_thread(_sync_update_meta, user_id, fact_id, {"is_sealed": True})


async def delete_fact(user_id: str, fact_id: str) -> None:
    """Permanently remove a fact from ChromaDB."""
    await asyncio.to_thread(_sync_delete, user_id, fact_id)


async def user_fact_count(user_id: str) -> int:
    """Return total number of facts stored for a user."""
    return await asyncio.to_thread(_sync_count, user_id)


async def purge_stale_records(user_id: str) -> dict[str, Any]:
    """C-4 migration helper: delete records in this user's collection
    that lack ``user_id`` metadata (left over from the pre-isolation
    schema). Returns ``{"removed": int}``. Safe to call repeatedly.
    """
    return await asyncio.to_thread(_sync_purge_stale_records, user_id)


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
    """Post-turn memory write pipeline.

    Kept for backward compatibility with older call sites/tests. The real
    implementation now lives in ``memory.brain`` so a chat turn writes to the
    same durable path that prompt recall and tools read from.
    """
    from memory.brain import memory_brain

    report = await memory_brain.remember_text(
        db=db,
        user_id=user_id,
        session_id=session_id,
        text=conversation_summary,
        source="chat",
        durable=True,
    )
    return report.stored_ids
