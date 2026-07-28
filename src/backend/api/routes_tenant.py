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
from db.models import TenantOrg, User
from security.auth import require_auth
from security.permissions import require_root

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenant", tags=["tenant"])


class CreateTenantOrgRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=128)
    slug: str = Field(..., min_length=2, max_length=64, pattern="^[a-z0-9-]+$")
    plan_tier: str = Field("FREE", pattern="^(FREE|PRO|ENTERPRISE)$")
    max_users: int = Field(5, ge=1, le=1000)
    max_ai_tokens_monthly: int = Field(100000, ge=1000)


class TenantOrgResponse(BaseModel):
    id: str
    name: str
    slug: str
    plan_tier: str
    max_users: int
    max_ai_tokens_monthly: int
    created_at: str


def _tenant_to_dict(org: TenantOrg) -> dict[str, Any]:
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "plan_tier": org.plan_tier,
        "max_users": org.max_users,
        "max_ai_tokens_monthly": org.max_ai_tokens_monthly,
        "created_at": org.created_at.isoformat(),
    }


@router.post("/orgs", response_model=TenantOrgResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant_org(
    req: CreateTenantOrgRequest,
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new SaaS organization (ROOT tier only)."""
    existing = await db.execute(select(TenantOrg).where(TenantOrg.slug == req.slug))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Organization slug '{req.slug}' already exists",
        )

    org = TenantOrg(
        id=str(uuid.uuid4()),
        name=req.name,
        slug=req.slug,
        plan_tier=req.plan_tier,
        max_users=req.max_users,
        max_ai_tokens_monthly=req.max_ai_tokens_monthly,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return _tenant_to_dict(org)


@router.get("/orgs", response_model=list[TenantOrgResponse])
async def list_tenant_orgs(
    current_user: User = Depends(require_root),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List all registered SaaS organizations (ROOT tier only)."""
    res = await db.execute(select(TenantOrg).order_by(TenantOrg.created_at.desc()))
    orgs = res.scalars().all()
    return [_tenant_to_dict(o) for o in orgs]


@router.get("/current", response_model=dict)
async def get_current_tenant(current_user: User = Depends(require_auth)) -> dict:
    """Return the active tenant context for the current request."""
    return {
        "tenant_id": get_current_tenant_id(),
        "user_id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
    }
