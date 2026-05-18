import sys
import os
import asyncio

sys.path.append(os.path.join(os.getcwd(), "src", "backend"))
from db.database import AsyncSessionLocal
from agent.kernel.runtime import get_runtime
from config import config

async def fix():
    pass

if __name__ == "__main__":
    pass
