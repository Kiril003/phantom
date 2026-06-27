"""Will Engine routes — drives, values, goal state."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from datetime import datetime
from agent.cognition.will import drive_system, goal_stack, identity_system
from security.auth import TokenPayload, require_auth

router = APIRouter(prefix="/agent/will", tags=["agent", "will"])


class DriveStateSchema(BaseModel):
    name: str
    current_level: float
    pressure: float


class WillStateResponse(BaseModel):
    drives: list[DriveStateSchema]
    top_goal: Optional[str] = None
    dominant_drive: str
    identity_summary: str


class CreateGoalRequest(BaseModel):
    description: str
    horizon_level: int
    parent_id: Optional[str] = None
    deadline: Optional[datetime] = None


@router.get("/state", response_model=WillStateResponse)
async def get_will_state(
    _: TokenPayload = Depends(require_auth),
) -> WillStateResponse:
    """Return the current internal state of the Will Engine."""
    # Ensure drives are up to date with latest hormones
    drive_system.tick()
    
    drives = [
        DriveStateSchema(
            name=name,
            current_level=drive.current_level,
            pressure=drive.pressure()
        )
        for name, drive in drive_system.drives.items()
    ]
    
    top_goal = await goal_stack.peek_highest()
    dominant = drive_system.dominant()
    
    return WillStateResponse(
        drives=drives,
        top_goal=top_goal.description if top_goal else None,
        dominant_drive=dominant.name,
        identity_summary=identity_system.summary(max_words=50)
    )


@router.get("/horizons")
async def get_horizons(
    token: TokenPayload = Depends(require_auth),
):
    """Return the 7-horizon goal hierarchy."""
    from agent.cognition.planner.horizons import get_horizon_tree
    tree = await get_horizon_tree(token.user_id)
    return {"tree": tree}


@router.post("/horizons")
async def create_horizon_goal(
    req: CreateGoalRequest,
    token: TokenPayload = Depends(require_auth),
):
    """Create a new goal in the hierarchy."""
    from agent.cognition.will.goal_stack import Goal, goal_stack
    new_goal = Goal(
        user_id=token.user_id,
        description=req.description,
        horizon_level=req.horizon_level,
        parent_id=req.parent_id,
        deadline=req.deadline,
        status="pending"
    )
    await goal_stack.push(new_goal)
    return {"id": new_goal.id}


@router.get("/journal")
async def get_will_journal(
    token: TokenPayload = Depends(require_auth),
    limit: int = 20,
):
    """Recent Will Engine decisions/actions (post-facto report)."""
    from db.database import get_session
    from agent.will.journal import WillJournalWriter
    async with get_session() as db:
        rows = await WillJournalWriter().recent(db, token.user_id, n=min(max(limit, 1), 100))
    return {"entries": rows}


@router.get("/engine")
async def get_will_engine_state(
    token: TokenPayload = Depends(require_auth),
):
    """Live Will Engine status — enabled flag + today's budget consumption."""
    from config import config
    from db.database import get_session
    from agent.will.budget import BudgetGovernor
    async with get_session() as db:
        budget = await BudgetGovernor().remaining(db, token.user_id)
    return {
        "enabled": config.will_enabled,
        "tick_interval_s": config.will_tick_interval_s,
        "budget": {
            "calls_used": budget.calls_used,
            "calls_cap": budget.calls_cap,
            "tokens_used": budget.tokens_used,
            "tokens_cap": budget.tokens_cap,
            "exhausted": not budget.ok,
        },
    }

