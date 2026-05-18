"""
Org-Chart — Team structure and role-based cognition.
Phase 30: Hierarchy, delegation, and role-specific constraints.
"""
import logging
from typing import List, Optional
from pydantic import BaseModel
from sqlalchemy import select
from db.database import AsyncSessionLocal
from db.models import AgentRole, AgentRelation

logger = logging.getLogger(__name__)

class RoleSchema(BaseModel):
    id: str
    name: str
    description: str
    standing_orders: str
    system_prompt_extension: str
    avatar_url: Optional[str] = None

class RelationSchema(BaseModel):
    id: str
    source_role_id: str
    target_role_id: str
    relation_type: str # COMMANDS, AUDITS, ADVISES
    trust_level: float

class OrgChartSchema(BaseModel):
    roles: List[RoleSchema]
    relations: List[RelationSchema]

async def get_org_chart() -> OrgChartSchema:
    """Retrieves the complete persistent org-chart."""
    async with AsyncSessionLocal() as session:
        roles_res = await session.execute(select(AgentRole))
        relations_res = await session.execute(select(AgentRelation))
        
        roles = [
            RoleSchema(
                id=r.id, name=r.name, description=r.description,
                standing_orders=r.standing_orders,
                system_prompt_extension=r.system_prompt_extension,
                avatar_url=r.avatar_url
            ) for r in roles_res.scalars()
        ]
        relations = [
            RelationSchema(
                id=rel.id, source_role_id=rel.source_role_id,
                target_role_id=rel.target_role_id,
                relation_type=rel.relation_type,
                trust_level=rel.trust_level
            ) for rel in relations_res.scalars()
        ]
        
        return OrgChartSchema(roles=roles, relations=relations)

async def get_role_by_name(name: str) -> Optional[RoleSchema]:
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(AgentRole).where(AgentRole.name == name))
        r = res.scalar_one_or_none()
        if not r:
            return None
        return RoleSchema(
            id=r.id, name=r.name, description=r.description,
            standing_orders=r.standing_orders,
            system_prompt_extension=r.system_prompt_extension,
            avatar_url=r.avatar_url
        )

async def update_role_orders(role_id: str, orders: str):
    async with AsyncSessionLocal() as session:
        async with session.begin():
            res = await session.execute(select(AgentRole).where(AgentRole.id == role_id))
            r = res.scalar_one_or_none()
            if r:
                r.standing_orders = orders
                logger.info("Updated standing orders for role %s", r.name)
