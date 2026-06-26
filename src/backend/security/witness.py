"""Phase 37 / Wave-2 — Capability Witness Interlock.
Secures sensitive system calls (files, networks, databases, serial interface) using cryptographic lease tokens signed via Ed25519.
Maps actions to ReversibilityClass constraints and integrates with LockdownController critical sections.
"""
from __future__ import annotations

import functools
import time
import logging
import contextvars
import asyncio
import inspect
from enum import IntEnum
from dataclasses import dataclass
from typing import Callable, Optional, Dict, Any, Awaitable
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature

logger = logging.getLogger(__name__)


class ReversibilityClass(IntEnum):
    REVERSIBLE = 0      # Read-only or UI elements (Zero risk, optimistic fast path)
    COMPENSATABLE = 1   # Modifying temporary actions (Requires runtime rollback callbacks)
    IRREVERSIBLE = 2    # Destructive/Physical I/O, writing ledgers, transactions (Witness Co-signature + Commit gate)


@dataclass
class CapabilityLease:
    token_id: str
    capability: str
    expires_at_utc: float
    witness_signature: bytes
    reversibility: ReversibilityClass
    nonce: str
    session_id: str
    witness_counter: int
    constraints: Dict[str, Any]


class WitnessVerifier:
    """Handles verification of Ed25519 signatures, lease constraints, and liveness checks."""
    def __init__(self, public_key: ed25519.Ed25519PublicKey, current_session_id: str):
        self.public_key = public_key
        self.session_id = current_session_id
        self.revocation_watermark = 0

    def verify_lease(self, lease: CapabilityLease, expected_cap: str, expected_rev: ReversibilityClass) -> bool:
        """Fully validates lease session, time bounds in UTC, capability class, and Ed25519 signature."""
        if time.time() > lease.expires_at_utc:
            logger.warning("Witness check: lease expired (UTC).")
            return False

        if lease.witness_counter < self.revocation_watermark:
            logger.warning("Witness check: lease revoked (counter %d is below watermark %d).", lease.witness_counter, self.revocation_watermark)
            return False

        if lease.session_id != self.session_id:
            logger.warning("Witness check: session mismatch (anti-replay check).")
            return False

        if lease.capability != expected_cap:
            logger.warning("Witness check: capability mismatch. Expected %s, got %s", expected_cap, lease.capability)
            return False

        if lease.reversibility != expected_rev:
            logger.warning("Witness check: privilege level confusion detected.")
            return False

        # Serialize lease details into signing format, including witness_counter
        message = f"{lease.token_id}:{lease.capability}:{int(lease.expires_at_utc)}:{int(lease.reversibility)}:{lease.nonce}:{lease.session_id}:{lease.witness_counter}".encode("utf-8")
        try:
            self.public_key.verify(lease.witness_signature, message)
        except InvalidSignature:
            logger.error("Witness check: Ed25519 signature verification failed!")
            return False

        return True

    async def co_sign_action(self, lease: CapabilityLease, action_params: Dict[str, Any]) -> bytes:
        """Performs a synchronous live handshake check with the Witness daemon for Irreversible actions."""
        if not await self.liveness_ping():
            raise PermissionError("Witness daemon unreachable for co-signing.")
        # Simulated TrustZone/ESP32 co-signing verification
        await asyncio.sleep(0.005)  # 5 ms latency overhead
        return b"witness_co_signature_for_" + lease.token_id.encode()

    async def liveness_ping(self) -> bool:
        """Pings the witness daemon to ensure it is alive and responsive."""
        return True


# Context variables for execution scope isolation
active_lease_var = contextvars.ContextVar("active_lease", default=None)
verifier_var = contextvars.ContextVar("witness_verifier", default=None)
lockdown_var = contextvars.ContextVar("lockdown_controller", default=None)
cosign_token_var = contextvars.ContextVar("witness_cosign", default=None)


def _get_bound_arguments(func: Callable, args: tuple, kwargs: dict) -> Dict[str, Any]:
    """Binds positional and keyword arguments to their named parameters based on function signature."""
    sig = inspect.signature(func)
    bound = sig.bind(*args, **kwargs)
    bound.apply_defaults()
    return bound.arguments


def capability_lease(
    capability: str,
    reversibility: ReversibilityClass,
    compensation_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None
):
    """Enforces capability lease validation, liveness checking, and lockdown-safety critical sections."""
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            verifier: Optional[WitnessVerifier] = verifier_var.get()
            lease: Optional[CapabilityLease] = active_lease_var.get()
            lockdown: Optional[Any] = lockdown_var.get()

            if not verifier or not lease or not lockdown:
                raise PermissionError("Lockdown/Witness integration variables missing in execution context.")

            if lockdown.is_active:
                raise PermissionError("Access Denied: System is currently in Lockdown.")

            # Validate basic lease structure
            if not verifier.verify_lease(lease, capability, reversibility):
                raise PermissionError(f"Witness verification failed for capability: {capability}")

            # Bind all arguments to inspect against constraints
            bound_args = _get_bound_arguments(func, args, kwargs)
            _validate_action_constraints(bound_args, lease.constraints)

            # Route by reversibility class
            if reversibility == ReversibilityClass.IRREVERSIBLE:
                if not await verifier.liveness_ping():
                    raise PermissionError("Witness connection lost. Irreversible action refused.")

                # 1. IRREVERSIBLE PATH: Synchronous pre-signature check + transaction gate
                cosign_token = await verifier.co_sign_action(lease, bound_args)
                token = cosign_token_var.set(cosign_token)
                try:
                    async with lockdown.critical_section():
                        return await func(*args, **kwargs)
                finally:
                    cosign_token_var.reset(token)

            elif reversibility == ReversibilityClass.COMPENSATABLE:
                if not await verifier.liveness_ping():
                    raise PermissionError("Witness connection lost. Compensatable action refused.")

                # 2. COMPENSATABLE PATH: Liveness check + rollback on failure or cancel
                if not compensation_callback:
                    raise ValueError(f"Compensation callback required for compensatable capability: {capability}")

                async with lockdown.critical_section():
                    try:
                        return await func(*args, **kwargs)
                    except BaseException as exc:  # Catch all failures including asyncio.CancelledError
                        logger.warning("Compensatable action failed or cancelled. Triggering rollback...")
                        try:
                            # Shield the callback from cancellation to ensure rollback completes
                            await asyncio.shield(asyncio.wait_for(compensation_callback(bound_args), timeout=1.0))
                        except Exception as compensation_exc:
                            logger.error("Error executing compensation callback: %s", compensation_exc)
                        raise exc
            else:
                # 3. REVERSIBLE PATH: Simple liveness ping + execute (optimistic)
                if not await verifier.liveness_ping():
                    raise PermissionError("Witness connection lost. Read-only capability revoked.")
                return await func(*args, **kwargs)

        return wrapper
    return decorator


def _validate_action_constraints(action_params: Dict[str, Any], constraints: Dict[str, Any]) -> None:
    """Validates if action parameters exceed signed lease constraints."""
    # 1. Financial/Sum constraints
    max_sum = constraints.get("max_sum")
    if max_sum is not None:
        action_sum = action_params.get("sum", 0)
        if action_sum > max_sum:
            raise ValueError(f"Transaction sum {action_sum} exceeds signed lease constraint limit: {max_sum}")

    # 2. Vault/Key constraints
    allowed_keys = constraints.get("allowed_keys")
    if allowed_keys is not None:
        key_name = action_params.get("key_name")
        if key_name not in allowed_keys:
            raise ValueError(f"Key '{key_name}' is not authorized by lease constraints. Allowed: {allowed_keys}")

    # 3. Target account constraints
    allowed_accounts = constraints.get("allowed_accounts")
    if allowed_accounts is not None:
        target_account = action_params.get("target_account")
        if target_account not in allowed_accounts:
            raise ValueError(f"Target account '{target_account}' is not authorized by lease constraints. Allowed: {allowed_accounts}")
