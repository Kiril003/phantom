"""
Tests for Will Engine — Drives (Phase 28).
"""
import pytest
from datetime import datetime, timezone
from agent.cognition.will.drives import DriveSystem, Drive
from ai.sentience.endocrine import endocrine_system

@pytest.mark.asyncio
async def test_drive_initialization():
    ds = DriveSystem()
    assert len(ds.drives) == 7
    assert "curiosity" in ds.drives
    assert ds.drives["curiosity"].current_level == 0.5

@pytest.mark.asyncio
async def test_drive_pressure():
    drive = Drive(name="test", current_level=0.3)
    assert drive.pressure() == pytest.approx(0.7)
    
    drive.current_level = 1.0
    assert drive.pressure() == 0.0

@pytest.mark.asyncio
async def test_drive_dominant():
    ds = DriveSystem()
    ds.drives["curiosity"].current_level = 0.1 # high pressure
    ds.drives["mastery"].current_level = 0.9 # low pressure
    
    dom = ds.dominant()
    assert dom.name == "curiosity"

@pytest.mark.asyncio
async def test_drive_satisfy():
    ds = DriveSystem()
    initial = ds.drives["curiosity"].current_level
    ds.satisfy("curiosity", 0.2)
    assert ds.drives["curiosity"].current_level == pytest.approx(initial + 0.2)

@pytest.mark.asyncio
async def test_drive_tick_hormonal_modulation():
    ds = DriveSystem()
    ds._last_tick = datetime.now(tz=timezone.utc)
    endocrine_system.stimulus(dopamine_delta=0.5)
    
    from unittest.mock import patch
    future_now = ds._last_tick.timestamp() + 3600
    with patch('agent.cognition.will.drives.datetime') as mock_date:
        mock_date.now.return_value = datetime.fromtimestamp(future_now, tz=timezone.utc)
        initial_curiosity = ds.drives["curiosity"].current_level
        ds.tick()
        assert ds.drives["curiosity"].current_level < initial_curiosity

@pytest.fixture
async def isolated_db(monkeypatch):
    from db.database import Base, engine, get_session
    from db.models import User
    from sqlalchemy import delete
    
    # We rely on the session DB being initialized by conftest.
    async with get_session() as s:
        try:
            # Need to provide non-null fields
            s.add(User(id="test", username="test_drives", role="Member", tenant_role="Member", pin_hash="x", preferences_json="{}"))
            await s.commit()
        except Exception:
            await s.rollback()
            
    yield get_session
    
    async with get_session() as s:
        from db.models import DriveState
        await s.execute(delete(DriveState).where(DriveState.user_id == "test"))
        await s.execute(delete(User).where(User.id == "test"))
        await s.commit()

@pytest.mark.asyncio
async def test_drive_persistence(isolated_db):
    ds = DriveSystem()
    ds.drives["curiosity"].current_level = 0.8
    ds.drives["beauty"].current_level = 0.2
    
    await ds.save()
    
    # New system instance should load saved values
    ds2 = DriveSystem()
    await ds2.load()
    
    assert ds2.drives["curiosity"].current_level == pytest.approx(0.8)
    assert ds2.drives["beauty"].current_level == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_drive_reward_lowers_pressure_and_persists(isolated_db):
    """A completed will-goal satisfies the drives it served; the change
    persists so motivation actually moves across restarts (will loop)."""
    ds = DriveSystem()
    ds.drives["autonomy"].current_level = 0.4
    ds.drives["achievement"].current_level = 0.4

    await ds.reward({"autonomy": 0.12, "achievement": 0.12})

    # Pressure dropped in-memory.
    assert ds.drives["autonomy"].current_level == pytest.approx(0.52)
    assert ds.drives["achievement"].current_level == pytest.approx(0.52)

    # And the reward was persisted (survives a restart).
    ds2 = DriveSystem()
    await ds2.load()
    assert ds2.drives["autonomy"].current_level == pytest.approx(0.52)
    assert ds2.drives["achievement"].current_level == pytest.approx(0.52)
