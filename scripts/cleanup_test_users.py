#!/usr/bin/env python3
"""
Cleanup leaked pytest fixtures from the live phantom.db.

Audit (docs/audit-2026-04-29-day5-holes.md, hole H-D3): the operator
profile picker was rendering 426 seeded test users — fixture rows from
`phase17a_user_*`, `t_*`, `id3-*`, `phantom_test_*`, `phantom_i7_*`,
`phantom_i4_*` test classes that wrote to the same DB the dev backend
uses. Live picker showed 432 tiles; only ~6 are real operators.

Default mode is dry-run — prints what *would* be deleted with row
counts per related table. Pass --apply to execute the deletes inside a
single transaction. Pass --include-orphans to also clear rows whose
user_id no longer exists in `users` (rare but real after partial test
crashes).

Run from repo root:

    ./.venv/bin/python scripts/cleanup_test_users.py --db src/backend/phantom.db
    ./.venv/bin/python scripts/cleanup_test_users.py --db src/backend/phantom.db --apply
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

# Patterns that match test-fixture usernames. Each is a SQL LIKE pattern;
# the escape char is `\` so a literal underscore can be matched.
TEST_USER_PATTERNS = [
    r"phase17a\_user\_%",
    r"t\_%",
    r"id3-%",
    r"phantom\_test\_%",
    r"phantom\_i7\_%",
    r"phantom\_i4\_%",
    r"phantom\_w%\_%",      # phase-W phase tests
    r"audit\_%",
    r"test\_%",
    r"e2e\_%",
]

# Tables that have a user_id column and should be cleaned alongside
# the users row. Order matters only when SQLite FOREIGN KEY enforcement
# is on — we run with `PRAGMA foreign_keys = OFF` so order is purely
# cosmetic, but kept stable for the dry-run report.
USER_OWNED_TABLES = [
    "ai_tool_use_log",
    "alarms",
    "calendar_events",
    "chat_messages",
    "chat_sessions",
    "ghost_records",
    "location_history",
    "map_pois",
    "memory_facts",
    "standing_orders",
    "state_transitions",
    "temporal_anchors",
    "timers",
    "user_facts",
]


def _matched_user_ids(conn: sqlite3.Connection) -> list[str]:
    ids: list[str] = []
    for pat in TEST_USER_PATTERNS:
        for row in conn.execute(
            "SELECT id FROM users WHERE username LIKE ? ESCAPE '\\'",
            (pat,),
        ):
            ids.append(row[0])
    # de-dup while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for uid in ids:
        if uid in seen:
            continue
        seen.add(uid)
        out.append(uid)
    return out


def _existing_user_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM users")}


def _print_dry_run(conn: sqlite3.Connection, target_ids: list[str]) -> None:
    print(f"Dry run — {len(target_ids)} test users would be deleted from `users`.")
    if not target_ids:
        return
    print()
    print("Per-pattern matches:")
    for pat in TEST_USER_PATTERNS:
        cnt = conn.execute(
            "SELECT COUNT(*) FROM users WHERE username LIKE ? ESCAPE '\\'",
            (pat,),
        ).fetchone()[0]
        if cnt:
            print(f"  {pat:<32s} {cnt}")
    print()
    print("Related rows owned by these users (would also be removed):")
    placeholders = ",".join("?" * len(target_ids))
    for table in USER_OWNED_TABLES:
        try:
            cnt = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE user_id IN ({placeholders})",
                target_ids,
            ).fetchone()[0]
        except sqlite3.OperationalError:
            cnt = 0
        if cnt:
            print(f"  {table:<24s} {cnt}")


def _print_orphans(conn: sqlite3.Connection) -> dict[str, int]:
    print("Orphan rows (user_id with no matching users.id):")
    counts: dict[str, int] = {}
    for table in USER_OWNED_TABLES:
        try:
            cnt = conn.execute(
                f"SELECT COUNT(*) FROM {table} t "
                "WHERE t.user_id IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id)"
            ).fetchone()[0]
        except sqlite3.OperationalError:
            cnt = 0
        counts[table] = cnt
        if cnt:
            print(f"  {table:<24s} {cnt}")
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        default="src/backend/phantom.db",
        help="Path to phantom.db (default: src/backend/phantom.db)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete rows. Without this, runs in dry-run mode.",
    )
    parser.add_argument(
        "--include-orphans",
        action="store_true",
        help="Also clear rows whose user_id no longer exists in `users`.",
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = OFF")  # we manage cascade ourselves

    target_ids = _matched_user_ids(conn)
    _print_dry_run(conn, target_ids)
    print()

    if args.include_orphans:
        orphan_counts = _print_orphans(conn)
        print()
    else:
        orphan_counts = {}

    if not args.apply:
        print("(dry-run — pass --apply to execute)")
        return 0

    print("Applying deletes…")
    conn.execute("BEGIN")
    try:
        if target_ids:
            placeholders = ",".join("?" * len(target_ids))
            for table in USER_OWNED_TABLES:
                try:
                    cur = conn.execute(
                        f"DELETE FROM {table} WHERE user_id IN ({placeholders})",
                        target_ids,
                    )
                    if cur.rowcount:
                        print(f"  {table}: {cur.rowcount} rows deleted")
                except sqlite3.OperationalError as exc:
                    print(f"  {table}: skipped ({exc})")
            cur = conn.execute(
                f"DELETE FROM users WHERE id IN ({placeholders})", target_ids
            )
            print(f"  users: {cur.rowcount} rows deleted")

        if args.include_orphans:
            for table, cnt in orphan_counts.items():
                if not cnt:
                    continue
                try:
                    cur = conn.execute(
                        f"DELETE FROM {table} WHERE user_id IS NOT NULL "
                        "AND user_id NOT IN (SELECT id FROM users)"
                    )
                    if cur.rowcount:
                        print(f"  {table} orphans: {cur.rowcount} rows deleted")
                except sqlite3.OperationalError as exc:
                    print(f"  {table} orphans: skipped ({exc})")

        conn.commit()
        print("Done.")
    except Exception:
        conn.rollback()
        raise

    return 0


if __name__ == "__main__":
    sys.exit(main())
