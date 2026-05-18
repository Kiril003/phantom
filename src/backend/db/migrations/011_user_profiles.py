"""Phase 1-B (companion-v2 Identity) — multi-Profile per User.

Schema delta:
  • profiles                  — per-User sub-identity rows.
  • paired_devices.profile_id — NEW NULLABLE COLUMN. Every paired
                                 phone/Wear/desktop binds to one profile;
                                 nullability lets legacy rows survive
                                 the migration until backfill catches them.

Backfill: every existing User who already owns at least one PairedDevice
gets a "Primary" profile auto-created and all of that user's pre-Phase-1-B
devices repointed at it. Users with zero devices get nothing — their
first ``/pair/init`` will lazily seed a Primary via
``_resolve_or_bootstrap_profile`` in routes_pair.py, keeping the migration
deterministic on greenfield installs.

Idempotent: PRAGMA table_info introspection guards both the column add
and the backfill, ``CREATE TABLE IF NOT EXISTS`` and
``CREATE INDEX IF NOT EXISTS`` cover the rest. Safe to re-run on an
already-migrated DB and on an empty DB where Base.metadata.create_all
already declared the same shape.

The shape here MUST stay byte-equivalent to the SQLAlchemy ORM
declaration in ``db/models.py`` — column order / nullability / types
match. Adding a new column to either the ORM or this migration without
updating the other will desync the schema between fresh installs and
upgraded ones.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import text


_PROFILES_DDL = """
    CREATE TABLE IF NOT EXISTS profiles (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(64) NOT NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'OPERATOR',
        avatar_uri VARCHAR(512),
        created_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL,
        archived_at DATETIME,
        is_primary INTEGER NOT NULL DEFAULT 0,
        behavioral_model_json TEXT NOT NULL DEFAULT '{}'
    )
"""

_INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS ix_profiles_user ON profiles (user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_user_display_name "
    "ON profiles (user_id, display_name)",
    "CREATE INDEX IF NOT EXISTS ix_paired_devices_profile "
    "ON paired_devices (profile_id)",
]


async def apply(conn) -> None:
    # 1) profiles table
    await conn.execute(text(_PROFILES_DDL))

    # 2) paired_devices.profile_id — guarded ALTER.
    # SQLite ALTER TABLE accepts only a single ADD COLUMN per statement,
    # and PRAGMA introspection is the canonical way to ask "do I already
    # have this column" without trying-and-catching. (Try-and-catch on
    # SQLite ALTER ADD COLUMN is unreliable across drivers — aiosqlite
    # surfaces the error as `OperationalError("duplicate column name")`
    # but PostgreSQL/MySQL drivers raise different classes; PRAGMA keeps
    # the migration deterministic on every backend SQLite supports.)
    cols_result = await conn.execute(text("PRAGMA table_info(paired_devices)"))
    existing_cols = {row[1] for row in cols_result.fetchall()}
    if "profile_id" not in existing_cols:
        # FK is informational only on SQLite when added via ALTER —
        # PRAGMA foreign_keys=ON does not back-check existing rows, and
        # SQLite's ALTER ADD COLUMN cannot carry a REFERENCES clause
        # anyway. The FK is declared in the ORM (``ForeignKey(...)`` on
        # ``PairedDevice.profile_id``) so PostgreSQL/MySQL deployments
        # get the constraint enforced; SQLite carries it as a hint only.
        await conn.execute(
            text("ALTER TABLE paired_devices ADD COLUMN profile_id VARCHAR(36)")
        )

    # 3) indexes
    for ddl in _INDEX_DDL:
        await conn.execute(text(ddl))

    # 4) Backfill. For every User who has at least one PairedDevice but
    # zero Profile rows, mint a Primary and repoint that user's
    # devices at it.
    now_iso = datetime.now(tz=timezone.utc).isoformat(sep=" ", timespec="seconds")
    distinct_users = await conn.execute(
        text(
            """
            SELECT DISTINCT pd.user_id
            FROM paired_devices pd
            LEFT JOIN profiles p ON p.user_id = pd.user_id
            WHERE p.id IS NULL
            """
        )
    )
    for (user_id,) in distinct_users.fetchall():
        if not user_id:
            continue
        profile_id = str(uuid.uuid4())
        await conn.execute(
            text(
                """
                INSERT INTO profiles
                    (id, user_id, display_name, role,
                     created_at, last_seen_at,
                     is_primary, behavioral_model_json)
                VALUES
                    (:id, :uid, 'Primary', 'OPERATOR',
                     :now, :now,
                     1, '{}')
                """
            ),
            {"id": profile_id, "uid": user_id, "now": now_iso},
        )
        await conn.execute(
            text(
                """
                UPDATE paired_devices
                SET profile_id = :pid
                WHERE user_id = :uid AND profile_id IS NULL
                """
            ),
            {"pid": profile_id, "uid": user_id},
        )
