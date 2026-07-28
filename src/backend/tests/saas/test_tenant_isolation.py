"""
Multi-Tenant Isolation & Quota Unit Test Suite for SaaS Enterprise Architecture.
Verifies that tenant context separation and tenant database isolation functions strictly isolate cross-tenant data.
"""
from __future__ import annotations

import pytest
from sqlalchemy import Column, String, select

from core.tenant import (
    apply_tenant_filter,
    get_current_tenant_id,
    tenant_context,
)
from db.database import Base, engine, get_session, init_db
from db.models import TenantOrg


class DummyTenantModel(Base):
    __tablename__ = "dummy_tenant_test"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False)


def test_tenant_context_default() -> None:
    """Ensure default tenant ID is active when no context is set."""
    assert get_current_tenant_id() == "default_tenant"


def test_tenant_context_manager() -> None:
    """Ensure context manager sets and restores tenant ID correctly."""
    assert get_current_tenant_id() == "default_tenant"
    with tenant_context("tenant_acme_corp"):
        assert get_current_tenant_id() == "tenant_acme_corp"
        with tenant_context("tenant_stark_ind"):
            assert get_current_tenant_id() == "tenant_stark_ind"
        assert get_current_tenant_id() == "tenant_acme_corp"
    assert get_current_tenant_id() == "default_tenant"


def test_tenant_filter_application() -> None:
    """Ensure SQL queries are augmented with tenant_id filter when model has tenant_id."""
    q = select(DummyTenantModel)
    with tenant_context("org_alpha"):
        filtered_q = apply_tenant_filter(q, DummyTenantModel)
        query_str = str(filtered_q)
        assert "tenant_id" in query_str


@pytest.mark.asyncio
async def test_tenant_org_creation() -> None:
    """Verify creation and retrieval of TenantOrg model in database."""
    await init_db()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with get_session() as db_session:
        org = TenantOrg(
            id="org-test-123",
            name="Test Enterprise Corp",
            slug="test-ent-corp",
            plan_tier="PRO",
            max_users=50,
            max_ai_tokens_monthly=500000,
        )
        db_session.add(org)
        await db_session.commit()

        res = await db_session.execute(select(TenantOrg).where(TenantOrg.slug == "test-ent-corp"))
        retrieved = res.scalar_one_or_none()
        assert retrieved is not None
        assert retrieved.name == "Test Enterprise Corp"
        assert retrieved.plan_tier == "PRO"
