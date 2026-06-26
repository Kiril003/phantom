"""Phase 36 (DREAM Journal) — DDL Migrations.

Creates the dream_jobs and dream_mutations tables for transactional staging.
"""
from __future__ import annotations

from sqlalchemy import text


_DREAM_JOBS_DDL = """
    CREATE TABLE IF NOT EXISTS dream_jobs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at      REAL NOT NULL,
        phase           TEXT NOT NULL, -- planning | applying | done | aborted
        stage           TEXT NOT NULL, -- summarize | beliefs | contradictions | hypotheses
        batch_lo        INTEGER NOT NULL,
        batch_hi        INTEGER NOT NULL,
        heartbeat       REAL NOT NULL,
        committed_at    REAL
    )
"""

_DREAM_MUTATIONS_DDL = """
    CREATE TABLE IF NOT EXISTS dream_mutations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id          INTEGER NOT NULL REFERENCES dream_jobs(id) ON DELETE CASCADE,
        seq             INTEGER NOT NULL,
        op              TEXT NOT NULL,
        target_id       INTEGER,
        precond         TEXT,
        payload         TEXT NOT NULL
    )
"""

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_dream_jobs_phase ON dream_jobs(phase)",
    "CREATE INDEX IF NOT EXISTS idx_dream_mutations_job_seq ON dream_mutations(job_id, seq)",
]


async def apply(conn) -> None:
    await conn.execute(text(_DREAM_JOBS_DDL))
    await conn.execute(text(_DREAM_MUTATIONS_DDL))
    for ddl in _INDEXES:
        await conn.execute(text(ddl))
