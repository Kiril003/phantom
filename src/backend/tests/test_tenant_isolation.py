import pytest
import uuid
import httpx
from db.models import User, Tenant, ChatSession
from security.jwt_manager import create_token
from db.database import get_session
from main import app

@pytest.fixture
async def tenant_isolation_data():
    async with get_session() as db:
        tenant_a = Tenant(name="Tenant A")
        tenant_b = Tenant(name="Tenant B")
        db.add_all([tenant_a, tenant_b])
        await db.flush()
        
        user_a = User(
            id=str(uuid.uuid4()),
            tenant_id=tenant_a.id,
            username="usera_" + str(uuid.uuid4())[:8],
            role="ROOT"
        )
        user_b = User(
            id=str(uuid.uuid4()),
            tenant_id=tenant_b.id,
            username="userb_" + str(uuid.uuid4())[:8],
            role="ROOT"
        )
        db.add_all([user_a, user_b])
        await db.flush()
        
        chat_a = ChatSession(id=str(uuid.uuid4()), user_id=user_a.id, message_count=1)
        db.add(chat_a)
        await db.commit()
        
        return {
            "user_a_id": user_a.id,
            "user_a_name": user_a.username,
            "user_b_id": user_b.id,
            "user_b_name": user_b.username,
            "chat_a_id": chat_a.id
        }

@pytest.fixture
async def my_async_client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client

@pytest.mark.asyncio
async def test_tenant_isolation_chat_sessions(tenant_isolation_data, my_async_client):
    data = tenant_isolation_data
    
    token_a, _ = create_token(data["user_a_id"], data["user_a_name"], "ROOT")
    token_b, _ = create_token(data["user_b_id"], data["user_b_name"], "ROOT")
    
    # Request as User A
    my_async_client.headers.update({"Authorization": f"Bearer {token_a}"})
    resp_a = await my_async_client.get("/api/v1/chat/sessions")
    assert resp_a.status_code == 200
    json_a = resp_a.json()
    assert len(json_a["sessions"]) >= 1
    assert data["chat_a_id"] in [s["id"] for s in json_a["sessions"]]
    
    # Request as User B
    my_async_client.headers.update({"Authorization": f"Bearer {token_b}"})
    resp_b = await my_async_client.get("/api/v1/chat/sessions")
    assert resp_b.status_code == 200
    json_b = resp_b.json()
    assert data["chat_a_id"] not in [s["id"] for s in json_b["sessions"]]

@pytest.mark.asyncio
async def test_analytics_tenant_isolation(tenant_isolation_data, my_async_client):
    data = tenant_isolation_data
    
    token_a, _ = create_token(data["user_a_id"], data["user_a_name"], "ROOT")
    token_b, _ = create_token(data["user_b_id"], data["user_b_name"], "ROOT")
    
    # Request as User A
    my_async_client.headers.update({"Authorization": f"Bearer {token_a}"})
    resp_a = await my_async_client.get("/api/v1/analytics/overview")
    assert resp_a.status_code == 200
    json_a = resp_a.json()
    assert json_a["total_sessions"] >= 1
    
    # Request as User B
    my_async_client.headers.update({"Authorization": f"Bearer {token_b}"})
    resp_b = await my_async_client.get("/api/v1/analytics/overview")
    assert resp_b.status_code == 200
    json_b = resp_b.json()
    assert json_b["total_sessions"] == 0
