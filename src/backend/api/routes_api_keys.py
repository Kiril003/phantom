import hashlib
import uuid
import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any

from db.database import get_db
from db.models import ApiKey, Tenant
from api.dependencies import get_current_tenant

router = APIRouter(prefix="/api-keys", tags=["api_keys"])

@router.post("/generate")
async def generate_api_key(
    name: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    raw_key = f"pk_live_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    
    new_key = ApiKey(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        key_hash=key_hash,
        name=name
    )
    db.add(new_key)
    await db.commit()
    
    return {"id": new_key.id, "name": new_key.name, "key": raw_key}

@router.get("/")
async def list_api_keys(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(ApiKey).where(ApiKey.tenant_id == tenant.id))
    keys = result.scalars().all()
    return {"api_keys": [{"id": k.id, "name": k.name, "created_at": k.created_at} for k in keys]}

@router.delete("/{key_id}")
async def revoke_api_key(
    key_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        delete(ApiKey).where(ApiKey.id == key_id, ApiKey.tenant_id == tenant.id)
    )
    await db.commit()
    return {"status": "revoked"}
