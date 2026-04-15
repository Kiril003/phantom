"""
RBAC permissions — role-based access control.
Role hierarchy: ROOT > OPERATOR > GUEST
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

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
