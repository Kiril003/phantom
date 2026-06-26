import pytest

from agent.will.arbitration import intent_mutex, IntentBusy


def test_try_acquire_blocks_second_holder():
    intent_mutex.release("will")  # ensure clean
    assert intent_mutex.try_acquire("will") is True
    assert intent_mutex.held_by == "will"
    assert intent_mutex.try_acquire("proactive") is False
    intent_mutex.release("will")
    assert intent_mutex.held_by is None


@pytest.mark.asyncio
async def test_hold_context_manager_releases():
    async with intent_mutex.hold("will"):
        assert intent_mutex.held_by == "will"
    assert intent_mutex.held_by is None


@pytest.mark.asyncio
async def test_hold_raises_when_busy():
    assert intent_mutex.try_acquire("proactive") is True
    with pytest.raises(IntentBusy):
        async with intent_mutex.hold("will"):
            pass
    intent_mutex.release("proactive")
    assert intent_mutex.held_by is None
