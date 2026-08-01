import hashlib
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db
from db.models import User, Tenant, ApiKey
from security.auth import _extract_token, verify_token

async def get_current_user_or_api_key(
    token_str: str | None = Depends(_extract_token),
    db: AsyncSession = Depends(get_db)
) -> User:
    if not token_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if token_str.startswith("pk_live_"):
        key_hash = hashlib.sha256(token_str.encode()).hexdigest()
        result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
        api_key = result.scalar_one_or_none()
        if not api_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
        
        return User(
            id=f"api_{api_key.id}",
            username=f"api_client_{api_key.name}",
            role="API",
            tenant_id=api_key.tenant_id
        )

    try:
        payload = verify_token(token_str)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    result = await db.execute(select(User).where(User.id == payload.user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user

async def get_current_tenant(
    user: User = Depends(get_current_user_or_api_key),
    db: AsyncSession = Depends(get_db)
) -> Tenant:
    if not user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not belong to any tenant."
        )
    result = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant not found."
        )
    return tenant
