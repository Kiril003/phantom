"""Context routes — current snapshot, history, state."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.context_engine import context_engine
from core.state_machine import state_machine

router = APIRouter(prefix="/context", tags=["context"])

# Phase 01 — full JWT verification enforced in Phase 02
_bearer = HTTPBearer(auto_error=False)


async def _auth_gate(
    creds: Optional[HTTPAuthorizationCredentials] = Security(_bearer),
) -> Optional[str]:
    return creds.credentials if creds else None


@router.get("/current", dependencies=[Depends(_auth_gate)])
async def get_current_context() -> dict:
    """Return the most recent ContextSnapshot."""
    return context_engine.get_snapshot()


@router.get("/history", dependencies=[Depends(_auth_gate)])
async def get_context_history(minutes: int = 60) -> dict:
    """Return snapshots for the last N minutes."""
    snapshots = context_engine.get_history(minutes)
    return {
        "snapshots": snapshots,
        "interval_ms": 500,
    }


@router.get("/state", dependencies=[Depends(_auth_gate)])
async def get_state() -> dict:
    """Return current SystemState with metadata."""
    import time
    last = state_machine.last_transition
    since_iso = ""
    if last:
        since_iso = str(last.timestamp)
    else:
        since_iso = str(int(time.time() * 1000))

    return {
        "state": state_machine.current_state,
        "since": since_iso,
        "previous": state_machine.previous_state,
    }
