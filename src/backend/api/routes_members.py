from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from db.database import get_db
from db.models import User, Tenant
from api.dependencies import get_current_tenant

router = APIRouter(prefix="/tenant/members", tags=["Members"])

class MemberOut(BaseModel):
    id: str
    username: str
    role: str
    tenant_role: str
    
    class Config:
        from_attributes = True

class InviteRequest(BaseModel):
    email: EmailStr
    tenant_role: str = "Member"

@router.get("", response_model=List[MemberOut])
async def get_members(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.tenant_id == tenant.id))
    users = result.scalars().all()
    return users

@router.post("/invite")
async def invite_member(
    req: InviteRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    # Check if user already exists (mock functionality)
    result = await db.execute(select(User).where(User.username == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already exists")

    new_user = User(
        username=req.email,
        role="GUEST",
        tenant_role=req.tenant_role,
        tenant_id=tenant.id
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return {"message": "Invite sent", "user_id": new_user.id}
