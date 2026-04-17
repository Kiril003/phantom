"""Linux execution & resource monitoring routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

router = APIRouter(prefix="/linux", tags=["linux"])


class ExecuteRequest(BaseModel):
    command: str
    timeout_s: int = 30
    confirmed: bool = False


# TODO(phase-09): when the sandboxed executor lands, consult
#   config.security_dangerous_cmd_confirm — if true, abort on a dangerous
#   command pattern unless req.confirmed is also true. Settings UI already
#   exposes the toggle as [soon] via routes_settings.UNIMPLEMENTED_KEYS.


@router.post("/execute")
async def execute_command(req: ExecuteRequest) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 09",
    )


@router.get("/resources")
async def get_resources() -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 09",
    )
