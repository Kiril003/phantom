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

from config import config


class Base(DeclarativeBase):
    pass


engine = create_async_engine(
    config.database_url,
    echo=config.debug,
    # Phase 10 — `timeout=30.0` bumps SQLite's BUSY wait from the default 5s
    # so a tool handler opening a second session during a chat turn (which
    # already holds the request's write session) doesn't get "database is
    # locked" instantly. Single-writer SQLite + chat + tools = contention.
    connect_args={"check_same_thread": False, "timeout": 30.0},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def init_db() -> None:
    """Create all tables on first startup, then apply numbered migrations."""
    async with engine.begin() as conn:
        from db import models  # noqa: F401 — registers models with Base
        await conn.run_sync(Base.metadata.create_all)

    # Phase 9.2.1 — pending column-add migrations. Idempotent; safe on fresh DBs.
    from db.migrations import apply_pending
    await apply_pending(engine)


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
