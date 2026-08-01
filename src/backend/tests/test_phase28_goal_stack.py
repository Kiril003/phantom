"""
Tests for Will Engine — Goal Stack (Phase 28).
"""
import pytest
import json
from datetime import datetime, timezone
from agent.cognition.will.goal_stack import PersistentGoalStack, Goal

@pytest.fixture
async def isolated_db(monkeypatch):
    from db.database import Base, engine, get_session
    from db.models import User
    from sqlalchemy import delete
    
    # We rely on the session DB being initialized by conftest.
    # goals_persistent.user_id is a FK to users.id — seed the test owner.
    async with get_session() as s:
        try:
            # Need to provide non-null fields
            s.add(User(id="test", username="test_goal_stack", role="Member", tenant_role="Member", pin_hash="x", preferences_json="{}"))
            await s.commit()
        except Exception:
            await s.rollback()
    
    yield get_session
    
    async with get_session() as s:
        from db.models import PersistentGoal
        await s.execute(delete(PersistentGoal).where(PersistentGoal.user_id == "test"))
        await s.execute(delete(User).where(User.id == "test"))
        await s.commit()

@pytest.mark.asyncio
async def test_goal_priority():
    g = Goal(
        user_id="test",
        description="test",
        value_alignment=0.8,
        drive_pull=0.9,
        urgency=0.5,
        tractability=0.7
    )
    # 0.8 * 0.9 * 0.5 * 0.7 = 0.252
    assert g.priority() == pytest.approx(0.252)

@pytest.mark.asyncio
async def test_goal_stack_push_and_pop(isolated_db):
    gs = PersistentGoalStack()
    
    g1 = Goal(user_id="test", description="low priority", urgency=0.1)
    g2 = Goal(user_id="test", description="high priority", urgency=0.9)
    
    await gs.push(g1)
    await gs.push(g2)
    
    # pop_highest should return g2
    highest = await gs.pop_highest()
    assert highest.description == "high priority"
    assert highest.status == "running"
    
    # Next pop should return g1
    next_highest = await gs.pop_highest()
    assert next_highest.description == "low priority"

@pytest.mark.asyncio
async def test_goal_stack_mark_done(isolated_db):
    gs = PersistentGoalStack()
    g = Goal(user_id="test", description="to be done")
    await gs.push(g)
    
    await gs.mark_done(g.id, summary="finished well")
    
    # Should not be in pop_highest anymore
    highest = await gs.pop_highest()
    assert highest is None

@pytest.mark.asyncio
async def test_goal_stack_persistence(isolated_db):
    gs = PersistentGoalStack()
    g = Goal(user_id="test", description="persistent goal")
    await gs.push(g)
    
    # New stack instance should see it
    gs2 = PersistentGoalStack()
    highest = await gs2.pop_highest()
    assert highest.id == g.id

@pytest.mark.asyncio
async def test_goal_stack_empty_pop(isolated_db):
    gs = PersistentGoalStack()
    highest = await gs.pop_highest()
    assert highest is None
