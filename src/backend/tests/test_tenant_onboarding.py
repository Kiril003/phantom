import pytest
from sqlalchemy import select
from db.database import get_session
from db.models import Tenant, User

@pytest.mark.asyncio
async def test_tenant_create_endpoint():
    from tests.conftest import _issue_token
    from fastapi.testclient import TestClient
    from main import create_app
    import uuid

    app = create_app()

    async with get_session() as db:
        user_id = str(uuid.uuid4())
        u = User(id=user_id, username="test_owner", role="OPERATOR")
        db.add(u)
        await db.commit()

        token = _issue_token(u.id, u.username, u.role)

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/tenant/create",
            json={"name": "New Tenant", "slug": "new-tenant"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "New Tenant"
        assert data["slug"] == "new-tenant"
        tenant_id = data["id"]

    async with get_session() as db:
        u_fresh = await db.get(User, user_id)
        assert u_fresh.tenant_id == tenant_id
        assert u_fresh.tenant_role == "Owner"
