"""
Phase 9.4c-qw fix #4 — one-shot cleanup of test-fixture pollution.

Earlier integration tests inserted MemoryFact rows of the shape
``content="Fact N", place_name="Place N", place_lat=50.00X, place_lon=30.00X``
into the production SQLite. They surface in spatial recall and steal
top-K slots, drowning out real geo facts.

Idempotent — second run reports 0 deletions. Sweeps both the live
``memory_facts`` SQLite table and the per-user ChromaDB collections
(``user_*``) in case any escaped through the embedding writer too.

Usage::

    cd src/backend
    .venv/bin/python scripts/cleanup_test_fixtures.py
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

# Make sure the backend package root is on sys.path so this script is
# runnable from anywhere (`.venv/bin/python scripts/...`).
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from sqlalchemy import text  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("cleanup_test_fixtures")


_DELETE_SQL = text(
    """
    DELETE FROM memory_facts
    WHERE content LIKE 'Fact %'
      AND place_name LIKE 'Place %'
      AND abs(place_lat - 50.0) < 1.0
      AND abs(place_lon - 30.0) < 1.0
    """
)


async def _delete_sqlite_rows() -> int:
    from db.database import AsyncSessionLocal  # noqa: PLC0415

    async with AsyncSessionLocal() as db:
        res = await db.execute(_DELETE_SQL)
        await db.commit()
        return int(res.rowcount or 0)


def _delete_chroma_rows() -> int:
    """Best-effort sweep of ChromaDB collections for the same fixture pattern."""
    try:
        from memory.strategic_memory import _get_client, _get_ef  # noqa: PLC0415
    except Exception as exc:
        log.warning("ChromaDB unavailable, skipping vector sweep: %s", exc)
        return 0

    client = _get_client()
    ef = _get_ef()
    deleted = 0
    try:
        collections = client.list_collections()
    except Exception as exc:
        log.warning("Listing collections failed: %s", exc)
        return 0

    for coll_meta in collections:
        try:
            name = getattr(coll_meta, "name", None) or coll_meta
            collection = client.get_collection(name=name, embedding_function=ef)
        except Exception:
            continue
        try:
            # ChromaDB doesn't accept arbitrary text predicates inside `where`,
            # so we have to scan and filter client-side.
            data = collection.get(include=["documents", "metadatas"])
        except Exception as exc:
            log.warning("Fetch from %s failed: %s", name, exc)
            continue
        ids = data.get("ids") or []
        docs = data.get("documents") or [None] * len(ids)
        metas = data.get("metadatas") or [None] * len(ids)
        bad_ids: list[str] = []
        for fid, doc, meta in zip(ids, docs, metas):
            if not doc:
                continue
            place = (meta or {}).get("place_name") or ""
            if (
                isinstance(doc, str)
                and doc.startswith("Fact ")
                and isinstance(place, str)
                and place.startswith("Place ")
            ):
                bad_ids.append(fid)
        if bad_ids:
            try:
                collection.delete(ids=bad_ids)
                deleted += len(bad_ids)
                log.info("Removed %d fixtures from ChromaDB collection %s",
                         len(bad_ids), name)
            except Exception as exc:
                log.warning("ChromaDB delete failed for %s: %s", name, exc)

    return deleted


async def main() -> int:
    sqlite_deleted = await _delete_sqlite_rows()
    log.info("Deleted %d rows from memory_facts (SQLite)", sqlite_deleted)
    chroma_deleted = _delete_chroma_rows()
    log.info("Deleted %d entries from ChromaDB user_* collections", chroma_deleted)
    return sqlite_deleted + chroma_deleted


if __name__ == "__main__":
    total = asyncio.run(main())
    log.info("Done. Total purged: %d", total)
