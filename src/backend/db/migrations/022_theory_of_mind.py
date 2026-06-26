"""Phase 35 (Theory of Mind & Reflexive Memory) — DDL Migrations.

Schema delta:
  • episodes          — Raw conversational turns with prosody & context.
  • semantic_memory   — Consolidated facts & semantic statements.
  • semantic_source   — Links between semantic facts and source episodes.
  • beliefs           — ToM beliefs about user and self.
  • belief_evidence   — Justifications and evidence logs for beliefs.
  • contradictions    — Open cognitive conflicts for reflection.
  • hypotheses        — Probing hypotheses and conversation agenda.
  • reflection_queue  — Event log hints sent from TURN to DREAM.

Idempotent: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
"""
from __future__ import annotations

from sqlalchemy import text


_EPISODES_DDL = """
    CREATE TABLE IF NOT EXISTS episodes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT NOT NULL,
        ts              REAL NOT NULL,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        embedding_id    TEXT,
        prosody         TEXT,
        context_snap    TEXT,
        importance      REAL DEFAULT 0.5,
        access_count    INTEGER DEFAULT 0,
        last_accessed   REAL,
        dream_processed INTEGER DEFAULT 0
    )
"""

_SEMANTIC_MEMORY_DDL = """
    CREATE TABLE IF NOT EXISTS semantic_memory (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        statement     TEXT NOT NULL,
        topic_key     TEXT,
        embedding_id  TEXT,
        importance    REAL DEFAULT 0.5,
        decay_score   REAL DEFAULT 1.0,
        created_at    REAL,
        last_accessed REAL
    )
"""

_SEMANTIC_SOURCE_DDL = """
    CREATE TABLE IF NOT EXISTS semantic_source (
        semantic_id INTEGER REFERENCES semantic_memory(id) ON DELETE CASCADE,
        episode_id  INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
        PRIMARY KEY (semantic_id, episode_id)
    )
"""

_BELIEFS_DDL = """
    CREATE TABLE IF NOT EXISTS beliefs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        subject       TEXT NOT NULL,
        statement     TEXT NOT NULL,
        predicate_key TEXT NOT NULL,
        value         TEXT,
        belief_type   TEXT NOT NULL,
        confidence    REAL DEFAULT 0.5,
        log_odds      REAL DEFAULT 0.0,
        status        TEXT DEFAULT 'active',
        superseded_by INTEGER REFERENCES beliefs(id),
        embedding_id  TEXT,
        created_at    REAL,
        updated_at    REAL,
        last_confirmed REAL
    )
"""

_BELIEF_EVIDENCE_DDL = """
    CREATE TABLE IF NOT EXISTS belief_evidence (
        belief_id   INTEGER REFERENCES beliefs(id) ON DELETE CASCADE,
        source_type TEXT,
        source_id   INTEGER,
        polarity    INTEGER,
        weight      REAL DEFAULT 1.0,
        added_at    REAL,
        PRIMARY KEY (belief_id, source_type, source_id)
    )
"""

_CONTRADICTIONS_DDL = """
    CREATE TABLE IF NOT EXISTS contradictions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        belief_a    INTEGER REFERENCES beliefs(id) ON DELETE CASCADE,
        belief_b    INTEGER REFERENCES beliefs(id) ON DELETE CASCADE,
        kind        TEXT,
        status      TEXT DEFAULT 'open',
        resolution  TEXT,
        detected_at REAL,
        resolved_at REAL
    )
"""

_HYPOTHESES_DDL = """
    CREATE TABLE IF NOT EXISTS hypotheses (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        belief_id   INTEGER REFERENCES beliefs(id) ON DELETE CASCADE,
        text        TEXT NOT NULL,
        test_mode   TEXT,
        probe_hint  TEXT,
        status      TEXT DEFAULT 'pending',
        created_at  REAL,
        resolved_at REAL
    )
"""

_REFLECTION_QUEUE_DDL = """
    CREATE TABLE IF NOT EXISTS reflection_queue (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        priority    INTEGER DEFAULT 0,
        created_at  REAL,
        consumed    INTEGER DEFAULT 0
    )
"""

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_ep_unprocessed ON episodes(dream_processed, ts)",
    "CREATE INDEX IF NOT EXISTS idx_belief_key ON beliefs(predicate_key, status)",
    "CREATE INDEX IF NOT EXISTS idx_rq_open ON reflection_queue(consumed, priority DESC, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id)",
]


async def apply(conn) -> None:
    # Create tables
    await conn.execute(text(_EPISODES_DDL))
    await conn.execute(text(_SEMANTIC_MEMORY_DDL))
    await conn.execute(text(_SEMANTIC_SOURCE_DDL))
    await conn.execute(text(_BELIEFS_DDL))
    await conn.execute(text(_BELIEF_EVIDENCE_DDL))
    await conn.execute(text(_CONTRADICTIONS_DDL))
    await conn.execute(text(_HYPOTHESES_DDL))
    await conn.execute(text(_REFLECTION_QUEUE_DDL))

    # Create indexes
    for ddl in _INDEXES:
        await conn.execute(text(ddl))
