"""
Migration 020 — Create team_chat_messages table.
"""
import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)

async def apply(conn) -> None:
    logger.info("Migration 020: Creating team_chat_messages table if not exists...")
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS team_chat_messages (
            id VARCHAR(36) PRIMARY KEY,
            task_id VARCHAR(36) NOT NULL,
            parent_task_id VARCHAR(36),
            sender VARCHAR(64) NOT NULL,
            receiver VARCHAR(64) NOT NULL,
            message TEXT NOT NULL,
            message_type VARCHAR(32) DEFAULT 'text',
            media_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """))
    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_team_chat_task_id ON team_chat_messages(task_id)
    """))
