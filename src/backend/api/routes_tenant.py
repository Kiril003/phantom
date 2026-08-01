"""
Tenant Management API — SaaS Organization provisioning, quota monitoring, and tenant context switching.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.tenant import get_current_tenant_id, set_current_tenant_id
from db.database import get_db
from db.models import Tenant, User
from security.auth import require_auth
from security.permissions import require_root

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenant", tags=["tenant"])


class CreateTenantRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=128)
    slug: str = Field(..., min_length=2, max_length=64, pattern="^[a-z0-9-]+$")


class TenantResponse(BaseModel):
    id: str
    name: str
    slug: Optional[str]
    created_at: str
    is_active: bool


def _tenant_to_dict(org: Tenant) -> dict[str, Any]:
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "created_at": org.created_at.isoformat(),
        "is_active": org.is_active,
    }


@router.post("/create", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    req: CreateTenantRequest,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new SaaS organization and set caller as Owner."""
    existing = await db.execute(select(Tenant).where(Tenant.slug == req.slug))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Organization slug '{req.slug}' already exists",
        )

    org = Tenant(
        id=str(uuid.uuid4()),
        name=req.name,
        slug=req.slug,
    )
    db.add(org)
    
    current_user.tenant_id = org.id
    current_user.tenant_role = "Owner"
    db.add(current_user)

    await db.commit()
    await db.refresh(org)
    return _tenant_to_dict(org)


@router.get("/current", response_model=dict)
async def get_current_tenant(
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the active tenant context for the current request."""
    # require_auth віддає TokenPayload, а не User — анотація нижче бреше,
    # і .id валив цей роут п'ятисоткою на кожному відкритті штабу.
    uid = getattr(current_user, "user_id", None) or getattr(current_user, "id", None)
    name = None
    tid = get_current_tenant_id()
    row = await db.execute(select(User).where(User.id == uid))
    user_row = row.scalar_one_or_none()
    if user_row is not None and user_row.tenant_id:
        tid = user_row.tenant_id
        t = await db.execute(select(Tenant).where(Tenant.id == tid))
        tenant = t.scalar_one_or_none()
        if tenant is not None:
            name = tenant.name
    return {
        "tenant_id": tid,
        "tenant_name": name,
        "user_id": uid,
        "username": current_user.username,
        "role": current_user.role,
        "tenant_role": getattr(current_user, "tenant_role", "Member"),
    }

class OnboardingRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=128)
    slug: str = Field(..., min_length=2, max_length=64, pattern="^[a-z0-9-]+$")

@router.post("/create")
async def onboarding_create_workspace(
    req: OnboardingRequest,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create a workspace during onboarding."""
    # Check if slug exists
    existing = await db.execute(select(TenantOrg).where(TenantOrg.slug == req.slug))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Workspace slug '{req.slug}' is already taken",
        )

    # Create new workspace
    new_org_id = str(uuid.uuid4())
    org = TenantOrg(
        id=new_org_id,
        name=req.name,
        slug=req.slug,
        plan_tier="FREE",
        max_users=5,
        max_ai_tokens_monthly=100000,
    )
    db.add(org)

    # Assign current user to this workspace as Owner
    current_user.tenant_id = new_org_id
    current_user.tenant_role = "Owner"
    db.add(current_user)

    await db.commit()
    
    # Update current execution context
    set_current_tenant_id(new_org_id)
    
    return {"status": "success", "workspace": _tenant_to_dict(org)}
