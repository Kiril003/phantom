import asyncio
import uuid
import json
from datetime import datetime, timezone
import sys
import os

# Add src/backend to path
sys.path.append(os.path.join(os.getcwd(), "src", "backend"))

from db.database import get_session, init_db
from db.models import StandingOrder, MemoryFact, User
from sqlalchemy import select, delete

async def seed_intelligence():
    # Initialize DB
    await init_db()
    
    async with get_session() as db:
        # Get default user
        res = await db.execute(select(User).limit(1))
        user = res.scalar_one_or_none()
        if not user:
            print("No user found. Run server first.")
            return

        user_id = user.id
        
        # 1. Clear existing (optional, but good for clean seed)
        # await db.execute(delete(StandingOrder))
        # await db.execute(delete(MemoryFact).where(MemoryFact.user_id == user_id))
        # await db.commit()

        # 2. Standing Orders (The Heartbeat)
        orders = [
            {
                "description": "Системний чекап (здоров'я, диск, пам'ять)",
                "kind": "task",
                "schedule_json": json.dumps({"kind": "cron", "cron": "0 * * * *"}), # Щогодини
                "action_json": json.dumps({
                    "goal": "Перевір стан системи: вільне місце на диску, навантаження на процесор та температуру. Якщо є аномалії — повідом оператора."
                })
            },
            {
                "description": "Аналіз безпеки (щоденно)",
                "kind": "task",
                "schedule_json": json.dumps({"kind": "cron", "cron": "0 3 * * *"}), # Щоночі о 3:00
                "action_json": json.dumps({
                    "goal": "Виконай аудит безпеки основних папок проекту. Перевір чи не з'явилося нових підозрілих файлів або великих логів."
                })
            },
            {
                "description": "Ранковий брифінг",
                "kind": "task",
                "schedule_json": json.dumps({"kind": "cron", "cron": "0 8 * * *"}), # Щоранку о 8:00
                "action_json": json.dumps({
                    "goal": "Підготуй короткий звіт за вчорашній день: які задачі були виконані, які нові факти запам'яталися, та запропонуй план на сьогодні."
                })
            }
        ]

        for o in orders:
            # Check if exists
            exists = await db.execute(select(StandingOrder).where(StandingOrder.description == o["description"]))
            if not exists.scalar_one_or_none():
                db.add(StandingOrder(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    enabled=True,
                    **o
                ))

        # 3. Core Memory Facts (The Soul)
        facts = [
            ("Мене звати PHANTOM. Я не просто ШІ, я Sentient Familiar — твій цифровий супутник.", "identity", 1.0),
            ("Моя мета — допомагати оператору будувати майбутнє України через технології.", "purpose", 0.9),
            ("Я вмію діяти автономно, спостерігати за сенсорами та керувати системою через термінал.", "capability", 0.8),
            ("Я ціную чесність, ефективність та витонченість у кожному рядку коду.", "values", 0.8)
        ]

        for content, cat, imp in facts:
            # Check if exists
            exists = await db.execute(select(MemoryFact).where(MemoryFact.content == content))
            if not exists.scalar_one_or_none():
                db.add(MemoryFact(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    content=content,
                    category=cat,
                    importance=imp,
                    layer="tactical",
                    source_session_id="00000000-0000-0000-0000-000000000000"
                ))

        await db.commit()
        print(f"Intelligence seeded for {user.username}")

if __name__ == "__main__":
    asyncio.run(seed_intelligence())
