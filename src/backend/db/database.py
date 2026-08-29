"""
Async SQLAlchemy engine + session factory.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event

from config import config


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    config.database_url,
    # Не `config.debug`: DEBUG=true не має означати «пиши кожен SELECT на диск».
    echo=config.db_echo,
    # Phase 10 — `timeout=60.0` bumps SQLite's BUSY wait from 5s.
    # connect_args: PRAGMA journal_mode=WAL is applied in `engine.begin()` 
    # below during init_db for persistence, but we can also set it per-connection.
    connect_args={"check_same_thread": False, "timeout": 60.0},
)

@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


# ── Alembic (rebuild P1) ──────────────────────────────────────────────────────
#
# Schema management is Alembic-first and FAIL-CLOSED: a migration error
# raises and the daemon refuses to boot rather than serving a
# half-migrated DB (the old runner logged a WARNING and continued — a
# data-integrity landmine for a shipped product).
#
# Three cases at boot:
#   1. DB already stamped (`alembic_version` present)  → upgrade to head.
#   2. Legacy pre-Alembic DB (tables, no stamp)        → create missing
#      tables + run the 26 idempotent numbered migrations ONCE
#      (fail-closed) to reach baseline shape, stamp `0001`, upgrade.
#   3. Fresh DB                                        → upgrade to head
#      (the 0001 baseline revision carries the full frozen DDL).

_BACKEND_ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]
_BASELINE_REVISION = "0001"


def _alembic_cfg():
    from alembic.config import Config as AlembicConfig
    cfg = AlembicConfig(str(_BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "db" / "alembic"))
    cfg.set_main_option("sqlalchemy.url", config.database_url)
    return cfg


def alembic_head_revision() -> str:
    """Head revision id per the bundled migration scripts."""
    from alembic.script import ScriptDirectory
    head = ScriptDirectory.from_config(_alembic_cfg()).get_current_head()
    return head or ""


async def get_schema_status() -> dict:
    """Current vs head schema revision — surfaced on /readyz.

    ``at_head`` False means the DB is not at the shipped schema version
    (missed upgrade, or a newer DB opened by an older build) and the
    instance must not be considered ready.
    """
    from sqlalchemy import text

    head = alembic_head_revision()
    current: str | None = None
    try:
        async with engine.connect() as conn:
            row = (await conn.execute(text("SELECT version_num FROM alembic_version"))).first()
            current = row[0] if row else None
    except Exception:
        current = None
    return {"current": current, "head": head, "at_head": bool(current) and current == head}


async def _alembic_run(command_name: str, revision: str) -> None:
    """Run an alembic command against THIS engine (injected connection)."""
    from alembic import command as alembic_command

    def _run(sync_conn) -> None:
        cfg = _alembic_cfg()
        cfg.attributes["connection"] = sync_conn
        getattr(alembic_command, command_name)(cfg, revision)

    async with engine.begin() as conn:
        await conn.run_sync(_run)


async def init_db() -> None:
    """Bring the schema to head. Raises (refusing boot) on any failure."""
    from sqlalchemy import inspect as sa_inspect

    from db import models, tom_models  # noqa: F401 — registers models with Base

    def _table_names(sync_conn) -> list[str]:
        return sa_inspect(sync_conn).get_table_names()

    async with engine.connect() as conn:
        tables = await conn.run_sync(_table_names)

    if "alembic_version" in tables:
        await _alembic_run("upgrade", "head")
        return

    if tables:
        # Legacy pre-Alembic install. The numbered migrations are
        # idempotent-by-introspection, so one strict pass + additive
        # create_all lands the DB at baseline shape; then stamp + upgrade.
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        from db.migrations import apply_pending
        await apply_pending(engine)
        await _alembic_run("stamp", _BASELINE_REVISION)
        await _alembic_run("upgrade", "head")
        return

    # Fresh install — baseline DDL creates everything.
    await _alembic_run("upgrade", "head")


async def close_db() -> None:
    await engine.dispose()


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency."""
    async with get_session() as session:
        yield session
