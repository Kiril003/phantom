import os
import tempfile
import asyncio
import logging

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("alembic").setLevel(logging.DEBUG)

# Simulate conftest.py
fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{path}"

from db.database import init_db
from db.models import User
from db.database import get_session
from sqlalchemy import select

async def main():
    print(f"Test DB path: {path}")
    print(f"DATABASE_URL: {os.environ['DATABASE_URL']}")
    
    await init_db()
    
    async with get_session() as db:
        try:
            res = await db.execute(select(User).limit(1))
            print("Query successful!")
        except Exception as e:
            print(f"Query failed: {e}")

asyncio.run(main())
