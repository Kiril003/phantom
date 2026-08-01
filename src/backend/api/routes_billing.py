from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any

from db.database import get_db
from db.models import Subscription, Tenant
from api.dependencies import get_current_tenant

router = APIRouter(prefix="/billing", tags=["billing"])

@router.get("/subscription")
async def get_subscription(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    sub = result.scalar_one_or_none()
    if not sub:
        return {"tier": "Free", "tokens_used": 0, "max_tokens": 1000}
    return {
        "tier": sub.tier,
        "tokens_used": sub.tokens_used,
        "max_tokens": sub.max_tokens
    }

@router.post("/upgrade")
async def upgrade_subscription(
    tier: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    if tier not in ["Free", "Pro", "Enterprise"]:
        raise HTTPException(status_code=400, detail="Invalid tier")
        
    result = await db.execute(select(Subscription).where(Subscription.tenant_id == tenant.id))
    sub = result.scalar_one_or_none()
    
    if not sub:
        import uuid
        sub = Subscription(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            tier=tier,
            tokens_used=0,
            max_tokens=100000 if tier == "Pro" else 1000000 if tier == "Enterprise" else 1000
        )
        db.add(sub)
    else:
        sub.tier = tier
        sub.max_tokens = 100000 if tier == "Pro" else 1000000 if tier == "Enterprise" else 1000
        
    await db.commit()
    return {"status": "upgraded", "tier": tier}
