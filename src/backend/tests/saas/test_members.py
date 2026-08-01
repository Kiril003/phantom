import pytest
from sqlalchemy import select
from db.database import get_session
from db.models import Tenant, User
import uuid
from tests.conftest import _issue_token

@pytest.mark.asyncio
async def test_tenant_members_api():
    # Import here to avoid circular imports during pytest collection if any
    from fastapi.testclient import TestClient
    from main import app

    async with get_session() as db:
        # Create a tenant
        tenant = Tenant(name="Test Tenant API")
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

        # Create an admin user for the tenant
        admin_user = User(
            id=str(uuid.uuid4()),
            username="admin@test.com",
            role="OPERATOR",
            tenant_role="Admin",
            tenant_id=tenant.id
        )
        db.add(admin_user)
        await db.commit()
        
        token = _issue_token(admin_user.id, admin_user.username, admin_user.role)

    with TestClient(app) as client:
        # GET members
        resp = client.get("/api/v1/tenant/members", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["username"] == "admin@test.com"
        assert data[0]["tenant_role"] == "Admin"

        # POST invite member
        invite_data = {"email": "new_member@test.com", "tenant_role": "Member"}
        resp = client.post("/api/v1/tenant/members/invite", json=invite_data, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        invite_resp = resp.json()
        assert "user_id" in invite_resp

        # GET members again
        resp = client.get("/api/v1/tenant/members", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        usernames = {u["username"] for u in data}
        assert "new_member@test.com" in usernames
