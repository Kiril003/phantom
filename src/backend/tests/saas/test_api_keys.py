import pytest
from httpx import AsyncClient
import hashlib

from db.models import Tenant, ApiKey, User
from db.database import get_session

from fastapi.testclient import TestClient

@pytest.mark.asyncio
async def test_api_key_auth(auth_root_client: TestClient, auth_root_token: str, auth_root_user: User):
    # Create tenant and api key directly
    async with get_session() as db:
        # get the first tenant (from test fixtures)
        from sqlalchemy import select
        res = await db.execute(select(Tenant))
        tenant = res.scalar()
        if not tenant:
            import uuid
            tenant = Tenant(id=str(uuid.uuid4()), name="Test Tenant", is_active=True)
            db.add(tenant)
            await db.commit()
            await db.refresh(tenant)
            
        auth_root_user.tenant_id = tenant.id
        db.add(auth_root_user)
            
        import secrets
        raw_key = f"pk_live_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        import uuid
        api_key = ApiKey(id=str(uuid.uuid4()), name="test key", key_hash=key_hash, tenant_id=tenant.id)
        db.add(api_key)
        await db.commit()
        
    # Use the API key to authenticate against an endpoint that requires tenant auth
    # For example, let's use the GET /api/v1/sessions endpoint from chat
    headers = {"Authorization": f"Bearer {raw_key}"}
    response = auth_root_client.get("/api/v1/chat/sessions", headers=headers)
    assert response.status_code == 200
    assert "sessions" in response.json()
    
    # Test invalid API key
    headers_invalid = {"Authorization": "Bearer pk_live_invalidkey"}
    response_invalid = auth_root_client.get("/api/v1/chat/sessions", headers=headers_invalid)
    assert response_invalid.status_code == 401
    
    # Test fallback to JWT (should use regular auth_root_token which doesn't start with pk_live)
    headers_jwt = {"Authorization": f"Bearer {auth_root_token}"}
    response_jwt = auth_root_client.get("/api/v1/chat/sessions", headers=headers_jwt)
    assert response_jwt.status_code == 200

@pytest.mark.asyncio
async def test_api_key_crud(auth_root_client: TestClient, auth_root_token: str, auth_root_user: User):
    headers = {"Authorization": f"Bearer {auth_root_token}"}
    
    async with get_session() as db:
        from sqlalchemy import select
        res = await db.execute(select(Tenant))
        tenant = res.scalar()
        if not tenant:
            import uuid
            tenant = Tenant(id=str(uuid.uuid4()), name="Test Tenant", is_active=True)
            db.add(tenant)
            await db.commit()
            await db.refresh(tenant)
        auth_root_user.tenant_id = tenant.id
        db.add(auth_root_user)
        await db.commit()
    
    # Generate API key
    res = auth_root_client.post("/api/v1/api-keys/generate?name=test_crud", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "key" in data
    assert data["key"].startswith("pk_live_")
    key_id = data["id"]
    
    # List API keys
    res = auth_root_client.get("/api/v1/api-keys/", headers=headers)
    assert res.status_code == 200
    keys = res.json().get("api_keys", [])
    assert len(keys) > 0
    assert any(k["id"] == key_id for k in keys)
    
    # Revoke API key
    res = auth_root_client.delete(f"/api/v1/api-keys/{key_id}", headers=headers)
    assert res.status_code == 200
    
    # List API keys again
    res = auth_root_client.get("/api/v1/api-keys/", headers=headers)
    assert res.status_code == 200
    keys = res.json().get("api_keys", [])
    assert not any(k["id"] == key_id for k in keys)
