"""
Phase 9.3a (AD-02) — config hot-reload from DB.

Writing a row via `db.settings_repo.save()` should make `config.reload_from_db()`
pick it up in-process so Settings-UI-style changes stick without a uvicorn
restart. Also covers: unknown keys get ignored, repeat calls are idempotent,
bogus values that Pydantic rejects don't corrupt the singleton.
"""
from __future__ import annotations

import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase093a")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p93a_cfg_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_reload_picks_up_new_row(isolated_db):
    """A fresh write to settings table is visible in config after reload."""
    from config import config
    from db import settings_repo

    original = config.ai_call_min_interval_ms
    try:
        await settings_repo.save("ai_call_min_interval_ms", 777, user_id=None)
        applied = await config.reload_from_db()
        assert "ai_call_min_interval_ms" in applied
        assert config.ai_call_min_interval_ms == 777
    finally:
        config.ai_call_min_interval_ms = original


@pytest.mark.asyncio
async def test_reload_updates_on_subsequent_write(isolated_db):
    """Two consecutive writes both land; second overrides first."""
    from config import config
    from db import settings_repo

    original = config.agent_max_llm_calls_per_task
    try:
        await settings_repo.save("agent_max_llm_calls_per_task", 10, user_id=None)
        await config.reload_from_db()
        assert config.agent_max_llm_calls_per_task == 10

        await settings_repo.save("agent_max_llm_calls_per_task", 25, user_id=None)
        await config.reload_from_db()
        assert config.agent_max_llm_calls_per_task == 25
    finally:
        config.agent_max_llm_calls_per_task = original


@pytest.mark.asyncio
async def test_reload_ignores_unknown_keys(isolated_db):
    """Rows whose key isn't on PhantomConfig are silently skipped."""
    from config import config
    from db import settings_repo

    await settings_repo.save("this_key_does_not_exist_9999", "trash", user_id=None)
    # Must not raise, must not mutate anything.
    applied = await config.reload_from_db()
    assert "this_key_does_not_exist_9999" not in applied
    assert not hasattr(config, "this_key_does_not_exist_9999")


@pytest.mark.asyncio
async def test_reload_rejects_invalid_type(isolated_db):
    """A row whose value fails Pydantic validation leaves the singleton unchanged."""
    from config import config
    from db import settings_repo

    original = config.agent_max_llm_calls_per_task
    try:
        # Literal-typed field (ai_primary_provider) rejects unknown values.
        await settings_repo.save("ai_primary_provider", "not_a_real_provider", user_id=None)
        before = config.ai_primary_provider
        await config.reload_from_db()
        assert config.ai_primary_provider == before

        # int-typed field rejects a string.
        await settings_repo.save("agent_max_llm_calls_per_task", "definitely-not-an-int",
                                 user_id=None)
        await config.reload_from_db()
        assert config.agent_max_llm_calls_per_task == original
    finally:
        config.agent_max_llm_calls_per_task = original


@pytest.mark.asyncio
async def test_reload_returns_only_changed_keys(isolated_db):
    """applied dict only contains rows whose value actually changed."""
    from config import config
    from db import settings_repo

    # Baseline write.
    await settings_repo.save("ai_call_min_interval_ms", 3000, user_id=None)
    config.ai_call_min_interval_ms = 3000  # align in-memory with DB
    applied_1 = await config.reload_from_db()
    # Second reload with identical values — should yield nothing new.
    applied_2 = await config.reload_from_db()

    assert "ai_call_min_interval_ms" not in applied_2
    # applied_1 may still contain other baseline overrides from defaults but
    # not this key since we pre-aligned it.
    _ = applied_1
