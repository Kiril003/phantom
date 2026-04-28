#!/usr/bin/env python3
"""PHANTOM OS — ChromaDB orphan-collection janitor.

Closes audit-2026-04-28 F-17: tests that create per-user collections
without an explicit cleanup leak `chroma_data/<uuid>/` dirs forever. By
the Day-2 audit (2026-04-29) the dev box had 633 such dirs; the cold
`/readyz` `list_collections()` scan was 2-3 s and tripping the K8s
1 s liveness probe.

Usage::

    python scripts/chroma_janitor.py --dry-run     # report only
    python scripts/chroma_janitor.py               # actually delete

The janitor:

1. Connects to the configured ChromaDB PersistentClient.
2. Reads the distinct ``User.id`` set from the SQL DB.
3. For every ``user_<safe_id>`` collection NOT matching a real user, calls
   ``client.delete_collection(name=...)``.
4. Prints a summary line + one row per deletion.

Idempotent: safe to re-run. Won't touch collections without the
``user_`` prefix (Phase-19+ may add tenant- or topic- prefixed ones —
the janitor's contract is "user collections only" by design).
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

# Make the backend package importable when running from anywhere.
ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "src" / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


_SAFE_ID_RE = re.compile(r"[^a-zA-Z0-9_-]")


def _safe_id(user_id: str) -> str:
    """Mirror of `memory.strategic_memory._collection_name`'s suffix
    derivation. Kept identical so the suffix-vs-user comparison in the
    janitor is exact."""
    return _SAFE_ID_RE.sub("", user_id)[:32]


async def _known_safe_ids() -> set[str]:
    from sqlalchemy import select

    from db.database import init_db, get_session
    from db.models import User

    await init_db()
    async with get_session() as db:
        rows = (await db.execute(select(User.id))).scalars().all()
    return {_safe_id(uid) for uid in rows if isinstance(uid, str)}


async def _run(dry_run: bool) -> int:
    from memory.strategic_memory import (
        init_chroma_eager,
        prune_orphan_collections,
        prune_orphan_dirs,
    )

    # Warm the client so list_collections is ready before either pass runs.
    await init_chroma_eager()

    safe_ids = await _known_safe_ids()
    print(f"chroma_janitor: {len(safe_ids)} known user(s) in DB")

    # Pass 1 — drop user_* collections whose suffix isn't a live user.
    coll_summary = await prune_orphan_collections(safe_ids, dry_run=dry_run)
    print(
        f"chroma_janitor[collections]: scanned={coll_summary['scanned']} "
        f"kept={coll_summary['kept']} "
        f"{'would_delete' if dry_run else 'deleted'}="
        f"{len(coll_summary['deleted'])} failures={len(coll_summary['failures'])}"
    )
    for name in coll_summary["deleted"]:
        verb = "would-delete" if dry_run else "deleted"
        print(f"  {verb} collection: {name}")
    for f in coll_summary["failures"]:
        print(f"  FAILED collection: {f['name']} — {f['error']}")

    # Pass 2 — remove UUID-named filesystem dirs the live client doesn't claim.
    dir_summary = await prune_orphan_dirs(dry_run=dry_run)
    mb = dir_summary["freed_bytes"] / (1024 * 1024)
    print(
        f"chroma_janitor[dirs]: scanned={dir_summary['scanned']} "
        f"live={dir_summary['live']} "
        f"{'would_delete' if dry_run else 'deleted'}="
        f"{len(dir_summary['deleted_dirs'])} "
        f"{'would_free' if dry_run else 'freed'}={mb:.1f} MiB "
        f"failures={len(dir_summary['failures'])}"
    )
    for name in dir_summary["deleted_dirs"][:20]:
        verb = "would-delete" if dry_run else "deleted"
        print(f"  {verb} dir: {name}")
    if len(dir_summary["deleted_dirs"]) > 20:
        print(f"  ... and {len(dir_summary['deleted_dirs']) - 20} more")
    for f in dir_summary["failures"]:
        print(f"  FAILED dir: {f['name']} — {f['error']}")

    failures = len(coll_summary["failures"]) + len(dir_summary["failures"])
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be deleted without touching the store.",
    )
    args = parser.parse_args()
    return asyncio.run(_run(args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
