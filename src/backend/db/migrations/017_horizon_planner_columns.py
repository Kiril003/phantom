"""
Migration 017: Add user_id and progress to goals_persistent.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

async def apply(conn: AsyncConnection) -> None:
    # Check current columns
    res = await conn.execute(text("PRAGMA table_info(goals_persistent)"))
    columns = [row[1] for row in res.fetchall()]

    if "user_id" not in columns:
        # We need a default user_id if we want to make it non-nullable later,
        # but for now we just add it.
        res = await conn.execute(text("SELECT id FROM users LIMIT 1"))
        default_user = res.scalar() or "00000000-0000-0000-0000-000000000000"
        
        await conn.execute(text(f"ALTER TABLE goals_persistent ADD COLUMN user_id VARCHAR(36) DEFAULT '{default_user}'"))
        await conn.execute(text("CREATE INDEX ix_goals_persistent_user ON goals_persistent (user_id)"))

    if "progress" not in columns:
        await conn.execute(text("ALTER TABLE goals_persistent ADD COLUMN progress FLOAT DEFAULT 0.0"))
