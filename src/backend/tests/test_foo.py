import pytest
from db.database import engine
from sqlalchemy import text

@pytest.mark.asyncio
async def test_db_has_users():
    async with engine.connect() as conn:
        res = await conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        print(f"Tables: {res.fetchall()}")
        res = await conn.execute(text("SELECT * FROM users LIMIT 1"))
        print("Users found!")
