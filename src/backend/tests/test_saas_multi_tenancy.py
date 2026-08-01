import pytest
from sqlalchemy import select
from db.database import get_session
from db.models import Tenant, User

@pytest.mark.asyncio
async def test_tenant_creation_and_user_isolation():
    """Verify that tenants can be created and users are isolated to their tenants."""
    async with get_session() as db:
        # Create tenants
        acme = Tenant(name="Acme Corp")
        globex = Tenant(name="Globex Corp")
        db.add_all([acme, globex])
        await db.commit()
        await db.refresh(acme)
        await db.refresh(globex)

        # Create users
        alice = User(username="alice@acme.com", tenant_id=acme.id)
        bob = User(username="bob@acme.com", tenant_id=acme.id)
        charlie = User(username="charlie@globex.com", tenant_id=globex.id)
        
        db.add_all([alice, bob, charlie])
        await db.commit()

        # Verify Acme users
        result_acme = await db.execute(select(User).where(User.tenant_id == acme.id))
        acme_users = result_acme.scalars().all()
        assert len(acme_users) == 2
        assert {u.username for u in acme_users} == {"alice@acme.com", "bob@acme.com"}

        # Verify Globex users
        result_globex = await db.execute(select(User).where(User.tenant_id == globex.id))
        globex_users = result_globex.scalars().all()
        assert len(globex_users) == 1
        assert globex_users[0].username == "charlie@globex.com"

@pytest.mark.asyncio
async def test_api_tenant_isolation():
    from tests.conftest import _issue_token
    from fastapi.testclient import TestClient
    from main import create_app
    import uuid

    app = create_app()

    async with get_session() as db:
        # Create Tenants
        t_alpha = Tenant(name="Alpha")
        t_beta = Tenant(name="Beta")
        db.add_all([t_alpha, t_beta])
        await db.commit()
        await db.refresh(t_alpha)
        await db.refresh(t_beta)

        # Create Users
        u_alpha = User(id=str(uuid.uuid4()), username="alpha_user", role="OPERATOR", tenant_id=t_alpha.id)
        u_beta = User(id=str(uuid.uuid4()), username="beta_user", role="OPERATOR", tenant_id=t_beta.id)
        db.add_all([u_alpha, u_beta])
        
        from db.models import ChatSession, AgentTask
        # Create Sessions
        sess_alpha = ChatSession(id=str(uuid.uuid4()), user_id=u_alpha.id, message_count=1)
        sess_beta = ChatSession(id=str(uuid.uuid4()), user_id=u_beta.id, message_count=1)
        db.add_all([sess_alpha, sess_beta])
        
        # Create Tasks
        task_alpha = AgentTask(id=str(uuid.uuid4()), user_id=u_alpha.id, goal="Alpha Goal", status="done", track="foreground")
        task_beta = AgentTask(id=str(uuid.uuid4()), user_id=u_beta.id, goal="Beta Goal", status="done", track="foreground")
        db.add_all([task_alpha, task_beta])
        
        await db.commit()

        token_alpha = _issue_token(u_alpha.id, u_alpha.username, u_alpha.role)
        token_beta = _issue_token(u_beta.id, u_beta.username, u_beta.role)

    # Test /chat/sessions
    with TestClient(app) as client:
        # Alpha User
        resp = client.get("/api/v1/chat/sessions", headers={"Authorization": f"Bearer {token_alpha}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["sessions"][0]["id"] == sess_alpha.id
        
        # Beta User
        resp = client.get("/api/v1/chat/sessions", headers={"Authorization": f"Bearer {token_beta}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["sessions"][0]["id"] == sess_beta.id

        # Cross-access check
        resp = client.get(f"/api/v1/chat/sessions/{sess_beta.id}/messages", headers={"Authorization": f"Bearer {token_alpha}"})
        assert resp.status_code == 404
        
        resp = client.delete(f"/api/v1/chat/sessions/{sess_beta.id}", headers={"Authorization": f"Bearer {token_alpha}"})
        assert resp.status_code == 404
        
    # Test /agent/tasks
    with TestClient(app) as client:
        # Alpha User
        resp = client.get("/api/v1/agent/tasks", headers={"Authorization": f"Bearer {token_alpha}"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["tasks"]) == 1
        assert data["tasks"][0]["id"] == task_alpha.id
        
        # Beta User
        resp = client.get("/api/v1/agent/tasks", headers={"Authorization": f"Bearer {token_beta}"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["tasks"]) == 1
        assert data["tasks"][0]["id"] == task_beta.id

        # Cross-access check
        resp = client.get(f"/api/v1/agent/task/{task_beta.id}", headers={"Authorization": f"Bearer {token_alpha}"})
        assert resp.status_code == 404
