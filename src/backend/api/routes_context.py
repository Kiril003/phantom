"""Context routes — current snapshot, history, state."""
from __future__ import annotations

import time
from fastapi import APIRouter, Depends

from core.context_engine import context_engine
from core.state_machine import SystemState, state_machine
from security.auth import TokenPayload, require_auth

router = APIRouter(prefix="/context", tags=["context"])


@router.get("/current")
async def get_current_context(
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Return the most recent ContextSnapshot."""
    return context_engine.get_snapshot()


@router.get("/history")
async def get_context_history(
    minutes: int = 60,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Return snapshots for the last N minutes."""
    snapshots = context_engine.get_history(minutes)
    return {
        "snapshots": snapshots,
        "interval_ms": 500,
    }


@router.get("/state")
async def get_state(
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Return current SystemState with metadata."""
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


from pydantic import BaseModel

class StateTransitionRequest(BaseModel):
    state: str
    trigger: str = "manual"

@router.post("/state")
async def set_state(
    req: StateTransitionRequest,
    _: TokenPayload = Depends(require_auth),
) -> dict:
    """Force a manual state transition."""
    if req.state not in SystemState.ALL:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Invalid state: {req.state}")
    
    if req.state == SystemState.OPERATOR:
        t = state_machine.enter_operator(req.trigger)
    else:
        t = state_machine.force_transition(req.state, req.trigger)
    
    return {
        "from": t.from_state,
        "to": t.to_state,
        "trigger": t.trigger,
        "timestamp": t.timestamp,
    }
