import asyncio
import uuid
from datetime import datetime, timezone
import sys
import os

# Add src/backend to path
sys.path.append(os.path.join(os.getcwd(), "src", "backend"))

from db.database import get_session, init_db
from db.models import PersistentGoal, User
from sqlalchemy import select, delete

async def seed_horizons():
    # Initialize DB (run migrations)
    await init_db()
    
    async with get_session() as db:
        # Get default user
        res = await db.execute(select(User).limit(1))
        user = res.scalar_one_or_none()
        if not user:
            print("No user found. Please run the server once to create default user.")
            return

        user_id = user.id
        
        # Clear existing goals
        await db.execute(delete(PersistentGoal))
        await db.commit()

        # 0: Vision
        vision = PersistentGoal(
            id=str(uuid.uuid4()),
            user_id=user_id,
            horizon_level=0,
            description="Стати найкращою автономною ОС для підтримки України.",
            status="active",
            progress=0.1,
            owner_agent="CEO"
        )
        db.add(vision)
        await db.flush() # To get ID for children
        
        # 1: Year
        year = PersistentGoal(
            id=str(uuid.uuid4()),
            user_id=user_id,
            parent_id=vision.id,
            horizon_level=1,
            description="Реалізувати повноцінну екосистему Mobile + Desktop + Embedded.",
            status="active",
            progress=0.25,
            owner_agent="CEO"
        )
        db.add(year)
        await db.flush()
        
        # 2: Quarter
        quarter = PersistentGoal(
            id=str(uuid.uuid4()),
            user_id=user_id,
            parent_id=year.id,
            horizon_level=2,
            description="Завершити фазу автономного планування та Will Engine.",
            status="running",
            progress=0.6,
            owner_agent="CEO"
        )
        db.add(quarter)
        await db.flush()
        
        # 3: Month
        month = PersistentGoal(
            id=str(uuid.uuid4()),
            user_id=user_id,
            parent_id=quarter.id,
            horizon_level=3,
            description="Впровадити 7-Horizon Planner та покращити UI Sunrise.",
            status="running",
            progress=0.8,
            owner_agent="CEO"
        )
        db.add(month)
        await db.flush()
        
        # 4: Week
        week = PersistentGoal(
            id=str(uuid.uuid4()),
            user_id=user_id,
            parent_id=month.id,
            horizon_level=4,
            description="Реалізувати архітектуру та UI віджет для 7 горизонтів.",
            status="running",
            progress=0.5,
            owner_agent="CEO"
        )
        db.add(week)
        await db.flush()
        
        # 5: Day
        day = PersistentGoal(
            id=str(uuid.uuid4()),
            user_id=user_id,
            parent_id=week.id,
            horizon_level=5,
            description="Завершити Phase 29.",
            status="running",
            progress=0.3,
            owner_agent="CEO"
        )
        db.add(day)
        await db.flush()
        
        # 6: Action
        action = PersistentGoal(
            id=str(uuid.uuid4()),
            user_id=user_id,
            parent_id=day.id,
            horizon_level=6,
            description="Написати seed скрипт для тестування UI.",
            status="running",
            progress=0.9,
            owner_agent="CEO"
        )
        db.add(action)

        await db.commit()
        print(f"Seed horizons completed for user {user.username} ({user_id})")

if __name__ == "__main__":
    asyncio.run(seed_horizons())
