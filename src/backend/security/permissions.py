"""
RBAC permissions — role-based access control.
Role hierarchy: ROOT > OPERATOR > GUEST
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Path, status

from db.models import User
from security.auth import get_current_user

_ROLE_LEVEL = {"GUEST": 0, "OPERATOR": 1, "ROOT": 2}


class RoleChecker:
    """
    FastAPI dependency factory.
    Usage: router.get("/secret", dependencies=[Depends(require_root)])
    """

    def __init__(self, minimum_role: str) -> None:
        self._minimum_level = _ROLE_LEVEL.get(minimum_role, 0)
        self._minimum_role = minimum_role

    async def __call__(self, current_user: User = Depends(get_current_user)) -> User:
        user_level = _ROLE_LEVEL.get(current_user.role, 0)
        if user_level < self._minimum_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {self._minimum_role} role. Your role: {current_user.role}",
            )
        return current_user


# ── Convenience dependencies ───────────────────────────────────────────────────

require_guest = RoleChecker("GUEST")
require_operator = RoleChecker("OPERATOR")
require_root = RoleChecker("ROOT")


# ── Day-4 Wave-2 FACTS-1 (ADR-FCT-004) ────────────────────────────────────────


async def require_self_or_root(
    user_id: str = Path(..., description="Path-param user id"),
    current_user: User = Depends(get_current_user),
) -> User:
    """Allow the request when the caller is ROOT OR the user_id in
    the path matches the caller's own id.

    This is a FUNCTION (not a class instance like RoleChecker) because
    FastAPI's dependency resolver only injects ``Path``/``Query``/
    ``Header`` parameters into plain async functions, not class
    ``__call__`` methods.

    Returns the resolved User so the route handler doesn't re-resolve
    via another `get_current_user` Depends.

    Closes audit U6-ID-G1 — guests can read their own profile facts
    but cannot pivot to another user's.
    """
    if current_user.role == "ROOT" or current_user.id == user_id:
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Requires ROOT role or matching user id",
        headers={"X-Error-Code": "RBAC_NOT_SELF_OR_ROOT"},
    )
