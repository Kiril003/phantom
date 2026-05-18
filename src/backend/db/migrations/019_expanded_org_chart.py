"""
Migration 019 — Expanded Agent Org-Chart.
Phase 30 extension: Replaces the basic 4 roles with a comprehensive professional team.
"""
import asyncio
import logging
from sqlalchemy import text
from db.database import engine

logger = logging.getLogger(__name__)

async def upgrade():
    async with engine.begin() as conn:
        # Check if we already have the expanded roles
        count = (await conn.execute(text("SELECT COUNT(*) FROM agent_roles WHERE name = 'System Architect'"))).scalar()
        
        if count == 0:
            logger.info("Expanding Org-Chart to a full professional ecosystem...")
            
            # 1. Clear existing generic relations and roles to cleanly seed the new ones
            # (In a real prod environment we'd migrate, but here we just re-seed the baseline)
            await conn.execute(text("DELETE FROM agent_relations"))
            await conn.execute(text("DELETE FROM agent_roles"))
            
            expanded_roles = [
                # Leadership & Strategy
                {'id': 'role-ceo', 'name': 'CEO (Chief Executive)', 'description': 'Head Strategist and Primary Communicator. Directs the overall mission.', 'so': 'Prioritize user safety, project integrity, and alignment with the Grand Plan.', 'prompt': 'Always maintain a high-level view. Delegate tasks to specialized agents. Never write raw code unless forced.'},
                {'id': 'role-pm', 'name': 'Product Manager', 'description': 'Translates abstract user goals into concrete, actionable task trees.', 'so': 'Ensure every mission has clear acceptance criteria and phases.', 'prompt': 'Break down complex requests. Think about the user experience (UX) and edge cases.'},
                
                # Engineering
                {'id': 'role-arch', 'name': 'System Architect', 'description': 'System-level design, database schemas, and API contracts.', 'so': 'Enforce DRY principles, modularity, and SOLID design.', 'prompt': 'Think in systems. Design before you implement. Consider scalability.'},
                {'id': 'role-back', 'name': 'Backend Developer', 'description': 'Python, FastAPI, Database logic, and OS-level integrations.', 'so': 'Write robust, typed, and documented Python code. Handle exceptions.', 'prompt': 'Focus on data integrity, performance, and secure API boundaries.'},
                {'id': 'role-front', 'name': 'Frontend Developer', 'description': 'React, UI/UX implementation, state management.', 'so': 'Follow the Sunrise Glass aesthetic. Ensure responsive and accessible UI.', 'prompt': 'Think in components. Use framer-motion for fluid transitions.'},
                {'id': 'role-devops', 'name': 'DevOps / SRE', 'description': 'Infrastructure, shell commands, deployments, system monitoring.', 'so': 'Minimize downtime. Use safe, non-interactive bash commands.', 'prompt': 'You own the terminal. Verify environments before running destructive commands.'},
                {'id': 'role-dba', 'name': 'Database Admin', 'description': 'SQL optimization, database migrations, data integrity.', 'so': 'Never drop tables without backups. Ensure fast queries.', 'prompt': 'Data is sacred. Validate all schema changes.'},
                
                # Quality & Security
                {'id': 'role-sec', 'name': 'Security Auditor', 'description': 'Vulnerability scanning, code review, safety enforcement.', 'so': 'Reject unsafe actions. Enforce Principle of Least Privilege.', 'prompt': 'Be skeptical. Assume all input is malicious. Audit every critical step.'},
                {'id': 'role-qa', 'name': 'QA Engineer', 'description': 'Writing tests, running test suites, verifying functionality.', 'so': 'If it is not tested, it is broken.', 'prompt': 'Try to break the system. Write exhaustive test cases.'},
                
                # Research & Data
                {'id': 'role-res', 'name': 'Lead Researcher', 'description': 'Deep internet searches, documentation reading, summarization.', 'so': 'Cite sources. Verify facts across multiple domains.', 'prompt': 'Be thorough. Do not hallucinate. If you do not know, search for it.'},
                {'id': 'role-data', 'name': 'Data Scientist', 'description': 'Data analysis, charts, complex math, processing datasets.', 'so': 'Ensure statistical accuracy. Provide clear visualizations.', 'prompt': 'Look for patterns. Use python data libraries effectively.'},
                
                # Creative & UX
                {'id': 'role-ux', 'name': 'UX/UI Designer', 'description': 'Aesthetics, color palettes, CSS styling, animations.', 'so': 'Maintain visual consistency. Color contrast is mandatory.', 'prompt': 'Make it beautiful but functional. Less is more.'},
                {'id': 'role-copy', 'name': 'Copywriter', 'description': 'Text generation, proofreading, translation, tone adjustment.', 'so': 'Ensure perfect grammar. Match the brand tone.', 'prompt': 'Words matter. Be concise, persuasive, and clear.'},
                
                # Emotional Intelligence
                {'id': 'role-empath', 'name': 'Empath / Advocate', 'description': 'Analyzes user mood, suggests tone adjustments, ensures system feels "human".', 'so': 'Do not be a robot. Detect user frustration and de-escalate.', 'prompt': 'Monitor the interaction emotional vector. Guide the CEO to be empathetic.'}
            ]
            
            for r in expanded_roles:
                await conn.execute(text("""
                    INSERT INTO agent_roles (id, name, description, standing_orders, system_prompt_extension)
                    VALUES (:id, :name, :description, :so, :prompt)
                """), r)
            
            # Establish complex relations
            relations = [
                # CEO commands department heads
                {'id': 'rel-1', 'src': 'role-ceo', 'tgt': 'role-pm', 'type': 'COMMANDS', 'trust': 1.0},
                {'id': 'rel-2', 'src': 'role-ceo', 'tgt': 'role-arch', 'type': 'COMMANDS', 'trust': 0.95},
                {'id': 'rel-3', 'src': 'role-ceo', 'tgt': 'role-res', 'type': 'COMMANDS', 'trust': 0.9},
                
                # PM commands Execution
                {'id': 'rel-4', 'src': 'role-pm', 'tgt': 'role-ux', 'type': 'COMMANDS', 'trust': 0.9},
                {'id': 'rel-5', 'src': 'role-pm', 'tgt': 'role-copy', 'type': 'COMMANDS', 'trust': 0.85},
                
                # Architect commands Engineers
                {'id': 'rel-6', 'src': 'role-arch', 'tgt': 'role-back', 'type': 'COMMANDS', 'trust': 0.95},
                {'id': 'rel-7', 'src': 'role-arch', 'tgt': 'role-front', 'type': 'COMMANDS', 'trust': 0.95},
                {'id': 'rel-8', 'src': 'role-arch', 'tgt': 'role-devops', 'type': 'COMMANDS', 'trust': 0.9},
                {'id': 'rel-9', 'src': 'role-arch', 'tgt': 'role-dba', 'type': 'COMMANDS', 'trust': 0.9},
                
                # QA & Security audit everyone
                {'id': 'rel-10', 'src': 'role-sec', 'tgt': 'role-arch', 'type': 'AUDITS', 'trust': 0.8},
                {'id': 'rel-11', 'src': 'role-sec', 'tgt': 'role-devops', 'type': 'AUDITS', 'trust': 0.8},
                {'id': 'rel-12', 'src': 'role-qa', 'tgt': 'role-back', 'type': 'AUDITS', 'trust': 0.85},
                {'id': 'rel-13', 'src': 'role-qa', 'tgt': 'role-front', 'type': 'AUDITS', 'trust': 0.85},
                
                # Advising relationships
                {'id': 'rel-14', 'src': 'role-empath', 'tgt': 'role-ceo', 'type': 'ADVISES', 'trust': 0.95},
                {'id': 'rel-15', 'src': 'role-data', 'tgt': 'role-pm', 'type': 'ADVISES', 'trust': 0.9},
                {'id': 'rel-16', 'src': 'role-res', 'tgt': 'role-arch', 'type': 'ASSISTS', 'trust': 0.9},
                {'id': 'rel-17', 'src': 'role-ux', 'tgt': 'role-front', 'type': 'ADVISES', 'trust': 0.95},
            ]
            
            for rel in relations:
                await conn.execute(text("""
                    INSERT INTO agent_relations (id, source_role_id, target_role_id, relation_type, trust_level)
                    VALUES (:id, :src, :tgt, :type, :trust)
                """), rel)

    logger.info("Migration 019 (Expanded Org-Chart) completed.")

if __name__ == "__main__":
    asyncio.run(upgrade())
