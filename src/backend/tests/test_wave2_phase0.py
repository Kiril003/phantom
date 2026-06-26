"""Pytest suite for Phase 0 Skeletons (Lockdown, Referee, Witness Leases).
Tests FSM preemption, lockouts, Ed25519 lease validations, and rollback compensation callbacks.
"""
from __future__ import annotations

import asyncio
import time
import pytest
from unittest.mock import AsyncMock, MagicMock
from cryptography.hazmat.primitives.asymmetric import ed25519

from security.lockdown import LockdownController
from core.referee import RuntimeReferee, OutputFrame, PriorityTier
from security.witness import (
    WitnessVerifier, CapabilityLease, ReversibilityClass, capability_lease,
    active_lease_var, verifier_var, lockdown_var, cosign_token_var
)


@pytest.fixture
def keys():
    """Generates Ed25519 keypair for test signing."""
    private_key = ed25519.Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    return private_key, public_key


@pytest.fixture
def mock_io_terminate():
    return AsyncMock()


@pytest.fixture
def lockdown_controller(mock_io_terminate):
    return LockdownController(terminate_io_callback=mock_io_terminate)


@pytest.fixture
def mock_nudge_ignored():
    return AsyncMock()


@pytest.fixture
async def referee(lockdown_controller, mock_nudge_ignored):
    ref = RuntimeReferee(lockdown_controller=lockdown_controller, on_nudge_ignored_callback=mock_nudge_ignored)
    ref.start_sweeper()
    yield ref
    ref.stop_sweeper()


# ── 1. Lockdown Controller Tests ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_lockdown_drains_in_flight_tasks(lockdown_controller, mock_io_terminate):
    # Register in-flight transaction
    async with lockdown_controller.critical_section():
        assert lockdown_controller._in_flight_critical == 1
        
        # Trigger lockdown in the background
        trigger_task = asyncio.create_task(lockdown_controller.trigger("Test panic"))
        
        # Give trigger loop a millisecond to set event and wait on condition
        await asyncio.sleep(0.01)
        assert lockdown_controller.is_active
        assert mock_io_terminate.call_count == 0  # Should wait for drain
        
    # Exited critical section -> trigger_task should complete and call terminate_io
    await trigger_task
    assert mock_io_terminate.call_count == 1


@pytest.mark.asyncio
async def test_lockdown_drain_timeout(lockdown_controller, mock_io_terminate):
    # Simulate a stuck transaction that never exits critical_section
    async def stuck_task():
        async with lockdown_controller.critical_section():
            await asyncio.sleep(1.0)
            
    asyncio.create_task(stuck_task())
    await asyncio.sleep(0.01)
    
    # Trigger lockdown. It should timeout after 50ms and forcefully call terminate_io
    t0 = time.monotonic()
    await lockdown_controller.trigger("Timeout test")
    t1 = time.monotonic()
    
    assert (t1 - t0) >= 0.05
    assert mock_io_terminate.call_count == 1


@pytest.mark.asyncio
async def test_lockdown_mutual_re_arm(lockdown_controller, referee):
    # Setup some stack and nudge items
    nudge = OutputFrame("n_re_arm", PriorityTier.NUDGE, {"value": 1.0}, ttl=10.0)
    await referee.emit(nudge)
    assert referee.nudge_slot == nudge

    # Trigger lockdown
    await lockdown_controller.trigger("Emergency")
    assert lockdown_controller.is_active
    assert referee.nudge_slot is None

    # Re-arm lockdown controller
    lockdown_controller.re_arm()
    assert not lockdown_controller.is_active
    # Referee should be cleared and ready
    assert referee.nudge_slot is None
    assert len(referee.stack) == 0


# ── 2. Runtime Referee Stack and Nudge Slot Tests ──────────────────────────────

@pytest.mark.asyncio
async def test_referee_nudge_slot_replacement(referee, mock_nudge_ignored):
    # Emit first nudge
    nudge1 = OutputFrame("n1", PriorityTier.NUDGE, {"value": 5.0}, ttl=10.0)
    assert await referee.emit(nudge1)
    assert referee.nudge_slot == nudge1
    
    # Emit second nudge with lower value -> should be rejected
    nudge2 = OutputFrame("n2", PriorityTier.NUDGE, {"value": 2.0}, ttl=10.0)
    assert not await referee.emit(nudge2)
    assert referee.nudge_slot == nudge1
    assert mock_nudge_ignored.call_count == 0
    
    # Emit third nudge with higher value -> should replace first and trigger ignore for n1
    nudge3 = OutputFrame("n3", PriorityTier.NUDGE, {"value": 8.0}, ttl=10.0)
    assert await referee.emit(nudge3)
    assert referee.nudge_slot == nudge3

    await asyncio.sleep(0.01) # Wait for on_nudge_ignored task to run
    assert mock_nudge_ignored.call_count == 1
    assert mock_nudge_ignored.call_args[0][0] == nudge1


@pytest.mark.asyncio
async def test_referee_sweep_loop_expiry(referee, mock_nudge_ignored):
    # Emit nudge with short TTL
    nudge = OutputFrame("n_expire", PriorityTier.NUDGE, {"value": 1.0}, ttl=0.1)
    await referee.emit(nudge)
    assert referee.nudge_slot == nudge
    
    # Wait for sweeper to run
    await asyncio.sleep(0.4)
    assert referee.nudge_slot is None
    assert mock_nudge_ignored.call_count == 1


@pytest.mark.asyncio
async def test_referee_sentinel_preemption(referee):
    conv = OutputFrame("chat", PriorityTier.CONVERSATION, {}, ttl=10.0)
    await referee.emit(conv)
    assert referee.stack[-1] == conv
    
    # Sentinel preempts active conversation
    sentinel = OutputFrame("alarm", PriorityTier.SENTINEL, {}, ttl=10.0)
    await referee.emit(sentinel)
    assert referee.stack[-1] == sentinel
    assert conv.last_resumed_at is None  # conv is suspended


# ── 3. Witness & capability_lease Decorator Tests ──────────────────────────────

@pytest.mark.asyncio
async def test_capability_lease_success(keys, lockdown_controller):
    priv, pub = keys
    verifier = WitnessVerifier(public_key=pub, current_session_id="session_123")
    
    # Sign lease
    token_id = "token_abc"
    cap = "vault_read"
    expires = time.time() + 10.0
    msg = f"{token_id}:{cap}:{int(expires)}:{int(ReversibilityClass.REVERSIBLE)}:nonce_1:session_123:0".encode("utf-8")
    sig = priv.sign(msg)
    
    lease = CapabilityLease(
        token_id=token_id,
        capability=cap,
        expires_at_utc=expires,
        witness_signature=sig,
        reversibility=ReversibilityClass.REVERSIBLE,
        nonce="nonce_1",
        session_id="session_123",
        witness_counter=0,
        constraints={}
    )
    
    # Define protected function
    @capability_lease(capability="vault_read", reversibility=ReversibilityClass.REVERSIBLE)
    async def get_secret(key_name: str):
        return f"value_of_{key_name}"

    # Setup context
    verifier_var.set(verifier)
    active_lease_var.set(lease)
    lockdown_var.set(lockdown_controller)
    
    res = await get_secret(key_name="test_key")
    assert res == "value_of_test_key"


@pytest.mark.asyncio
async def test_capability_lease_invalid_signature(keys, lockdown_controller):
    priv, pub = keys
    verifier = WitnessVerifier(public_key=pub, current_session_id="session_123")
    
    lease = CapabilityLease(
        token_id="t1",
        capability="vault_read",
        expires_at_utc=time.time() + 10.0,
        witness_signature=b"invalid_sig_bytes_1234567890_1234567890_123456",
        reversibility=ReversibilityClass.REVERSIBLE,
        nonce="n1",
        session_id="session_123",
        witness_counter=0,
        constraints={}
    )
    
    @capability_lease(capability="vault_read", reversibility=ReversibilityClass.REVERSIBLE)
    async def get_secret():
        return "secret"

    verifier_var.set(verifier)
    active_lease_var.set(lease)
    lockdown_var.set(lockdown_controller)
    
    with pytest.raises(PermissionError, match="Witness verification failed"):
        await get_secret()


@pytest.mark.asyncio
async def test_capability_lease_revoked_by_watermark(keys, lockdown_controller):
    priv, pub = keys
    verifier = WitnessVerifier(public_key=pub, current_session_id="session_123")
    
    # Set revocation watermark to 10
    verifier.revocation_watermark = 10
    
    # Sign lease with counter = 5 (below watermark)
    token_id = "token_old"
    cap = "vault_read"
    expires = time.time() + 10.0
    msg = f"{token_id}:{cap}:{int(expires)}:{int(ReversibilityClass.REVERSIBLE)}:nonce_1:session_123:5".encode("utf-8")
    sig = priv.sign(msg)
    
    lease = CapabilityLease(
        token_id=token_id,
        capability=cap,
        expires_at_utc=expires,
        witness_signature=sig,
        reversibility=ReversibilityClass.REVERSIBLE,
        nonce="nonce_1",
        session_id="session_123",
        witness_counter=5,
        constraints={}
    )
    
    @capability_lease(capability="vault_read", reversibility=ReversibilityClass.REVERSIBLE)
    async def get_secret():
        return "secret"

    verifier_var.set(verifier)
    active_lease_var.set(lease)
    lockdown_var.set(lockdown_controller)
    
    with pytest.raises(PermissionError, match="Witness verification failed"):
        await get_secret()


@pytest.mark.asyncio
async def test_capability_lease_constraints_check(keys, lockdown_controller):
    priv, pub = keys
    verifier = WitnessVerifier(public_key=pub, current_session_id="session_123")
    
    expires = time.time() + 10.0
    msg = f"token_tx:finance_pay:{int(expires)}:{int(ReversibilityClass.IRREVERSIBLE)}:nonce_1:session_123:0".encode("utf-8")
    sig = priv.sign(msg)
    
    lease = CapabilityLease(
        token_id="token_tx",
        capability="finance_pay",
        expires_at_utc=expires,
        witness_signature=sig,
        reversibility=ReversibilityClass.IRREVERSIBLE,
        nonce="nonce_1",
        session_id="session_123",
        witness_counter=0,
        constraints={"max_sum": 500}
    )
    
    @capability_lease(capability="finance_pay", reversibility=ReversibilityClass.IRREVERSIBLE)
    async def pay_invoice(sum: int):
        # We can fetch cosigned token from the contextvar
        cosign = cosign_token_var.get()
        assert cosign == b"witness_co_signature_for_token_tx"
        return "paid"

    verifier_var.set(verifier)
    active_lease_var.set(lease)
    lockdown_var.set(lockdown_controller)
    
    # Sum exceeds limit -> should raise ValueError
    with pytest.raises(ValueError, match="exceeds signed lease constraint"):
        await pay_invoice(sum=1000)
        
    # Within limit -> should pass
    res = await pay_invoice(sum=300)
    assert res == "paid"


@pytest.mark.asyncio
async def test_compensatable_action_rollback(keys, lockdown_controller):
    priv, pub = keys
    verifier = WitnessVerifier(public_key=pub, current_session_id="session_123")
    
    expires = time.time() + 10.0
    msg = f"t_comp:file_write:{int(expires)}:{int(ReversibilityClass.COMPENSATABLE)}:n1:session_123:0".encode("utf-8")
    sig = priv.sign(msg)
    
    lease = CapabilityLease(
        token_id="t_comp",
        capability="file_write",
        expires_at_utc=expires,
        witness_signature=sig,
        reversibility=ReversibilityClass.COMPENSATABLE,
        nonce="n1",
        session_id="session_123",
        witness_counter=0,
        constraints={}
    )
    
    mock_rollback = AsyncMock()
    
    @capability_lease(
        capability="file_write",
        reversibility=ReversibilityClass.COMPENSATABLE,
        compensation_callback=mock_rollback
    )
    async def write_data(filepath: str):
        raise RuntimeError("Write error simulation")

    verifier_var.set(verifier)
    active_lease_var.set(lease)
    lockdown_var.set(lockdown_controller)
    
    with pytest.raises(RuntimeError, match="Write error"):
        await write_data(filepath="/tmp/test.txt")
        
    # Check that rollback was invoked with correct arguments (including filepath)
    assert mock_rollback.call_count == 1
    call_args = mock_rollback.call_args[0][0]
    assert call_args["filepath"] == "/tmp/test.txt"
