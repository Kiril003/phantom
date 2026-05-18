"""
Migration 018 — Agent Org-Chart tables.
Phase 30: Persistent roles and hierarchy.
"""
import asyncio
import logging
from sqlalchemy import text
from db.database import engine

logger = logging.getLogger(__name__)

async def upgrade():
    async with engine.begin() as conn:
        # 1. agent_roles table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS agent_roles (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(64) UNIQUE NOT NULL,
                description TEXT NOT NULL,
                standing_orders TEXT DEFAULT '',
                system_prompt_extension TEXT DEFAULT '',
                avatar_url VARCHAR(512),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        
        # 2. agent_relations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS agent_relations (
                id VARCHAR(36) PRIMARY KEY,
                source_role_id VARCHAR(36) NOT NULL,
                target_role_id VARCHAR(36) NOT NULL,
                relation_type VARCHAR(32) DEFAULT 'COMMANDS',
                trust_level FLOAT DEFAULT 1.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (source_role_id) REFERENCES agent_roles(id),
                FOREIGN KEY (target_role_id) REFERENCES agent_roles(id)
            )
        """))
        
        # 3. Seed default roles if empty
        roles_count = (await conn.execute(text("SELECT COUNT(*) FROM agent_roles"))).scalar()
        if roles_count == 0:
            logger.info("Seeding default agent roles...")
            default_roles = [
                {'id': 'ceo-uuid', 'name': 'CEO', 'description': 'Head Strategist and Primary Communicator.', 'so': 'Prioritize user safety and project integrity.', 'prompt': 'Always maintain a high-level view.'},
                {'id': 'dev-uuid', 'name': 'Developer', 'description': 'Code implementation and technical problem solving.', 'so': 'Write tests first. Refactor for clarity.', 'prompt': 'Focus on idiomatic and maintainable code.'},
                {'id': 'res-uuid', 'name': 'Researcher', 'description': 'Information gathering and documentation analysis.', 'so': 'Cite sources. Verify facts.', 'prompt': 'Be thorough and systematic.'},
                {'id': 'aud-uuid', 'name': 'Auditor', 'description': 'Security and quality control.', 'so': 'Reject unsafe actions. Audit every critical step.', 'prompt': 'Be skeptical and pedantic about safety.'}
            ]
            for r in default_roles:
                await conn.execute(text("""
                    INSERT INTO agent_roles (id, name, description, standing_orders, system_prompt_extension)
                    VALUES (:id, :name, :description, :so, :prompt)
                """), r)
            
            # Default relations
            await conn.execute(text("""
                INSERT INTO agent_relations (id, source_role_id, target_role_id, relation_type)
                VALUES ('rel-1', 'ceo-uuid', 'dev-uuid', 'COMMANDS'),
                       ('rel-2', 'ceo-uuid', 'res-uuid', 'COMMANDS'),
                       ('rel-3', 'aud-uuid', 'dev-uuid', 'AUDITS'),
                       ('rel-4', 'aud-uuid', 'ceo-uuid', 'ADVISES')
            """))

    logger.info("Migration 018 (Org-Chart) completed.")

if __name__ == "__main__":
    asyncio.run(upgrade())
