"""Огляд системи — лише те, що ядро справді порахувало.

Тут стояв рядок `usage = int(tokens_used * (0.1 + (i % 3) * 0.05))` з
коментарем «mocking some usage curve»: графік малював вигадану криву з числа,
яке ніколи й ніде не збільшувалось. Токени прибрано зовсім — висновок іде на
пристрої, ми його не рахуємо і не вдаватимемо, що рахуємо. Замість них —
справжня активність: повідомлення по днях із їхніх власних міток часу.

`operators` фронтенд читав завжди, а бекенд не віддавав ніколи — тому «хто
працює» був вічно порожній. Тепер там реальні люди простору.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_tenant
from db.database import get_db
from db.models import AgentTask, ChatMessage, ChatSession, Tenant, User

router = APIRouter(prefix="/analytics", tags=["analytics"])

WINDOW_DAYS = 7

# `users.tenant_role` тримає КОД ролі («Owner»/«Admin»/«Member»), а не текст
# для людини — на ньому тримається логіка й /tenant/members, тож у базі він
# лишається як є. Але це поле фронтенд друкує дослівно, тому підпис береться
# тут, на межі. Раніше код ішов у вікно як є, і українець читав «Member».
ROLE_LABELS: Dict[str, str] = {
    "Owner": "власник",
    "Admin": "адміністратор",
    "Member": "учасник",
    "Guest": "гість",
}

DEFAULT_ROLE = "Member"

# Фільтр стояв ["RUNNING","SCHEDULED","PENDING"]: усі письменники пишуть
# малими, колонка без COLLATE NOCASE, а SCHEDULED/PENDING у словнику
# TaskStatus не існує взагалі — плитка показувала нуль завжди.
# `paused` не рахуємо: це єдиний статус, що означає «людина спинила» —
# і його ж масово ставить mark_orphans_paused після кожного рестарту.
ACTIVE_AGENT_STATUSES = ("planning", "running", "awaiting_user", "blocked_quota")


def role_label(code: str | None) -> str:
    return ROLE_LABELS.get(code or DEFAULT_ROLE, code or DEFAULT_ROLE)


@router.get("/overview", response_model=Dict[str, Any])
async def get_analytics_overview(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    active_agents = (
        await db.execute(
            select(func.count(AgentTask.id))
            .join(User, AgentTask.user_id == User.id)
            .where(
                User.tenant_id == tenant.id,
                AgentTask.status.in_(ACTIVE_AGENT_STATUSES),
            )
        )
    ).scalar() or 0

    total_sessions = (
        await db.execute(
            select(func.count(ChatSession.id))
            .join(User, ChatSession.user_id == User.id)
            .where(User.tenant_id == tenant.id)
        )
    ).scalar() or 0

    today = datetime.now(timezone.utc).date()
    since = datetime.combine(today - timedelta(days=WINDOW_DAYS - 1), datetime.min.time())

    rows = (
        await db.execute(
            select(func.date(ChatMessage.created_at), func.count(ChatMessage.id))
            .join(User, ChatMessage.user_id == User.id)
            .where(User.tenant_id == tenant.id, ChatMessage.created_at >= since)
            .group_by(func.date(ChatMessage.created_at))
        )
    ).all()
    by_day = {str(day): int(count) for day, count in rows}

    daily_activity = []
    for i in range(WINDOW_DAYS - 1, -1, -1):
        day = today - timedelta(days=i)
        daily_activity.append(
            {"date": day.isoformat(), "messages": by_day.get(day.isoformat(), 0)}
        )

    operator_rows = (
        await db.execute(
            select(User.username, User.tenant_role, func.count(ChatMessage.id))
            .outerjoin(ChatMessage, ChatMessage.user_id == User.id)
            .where(User.tenant_id == tenant.id)
            .group_by(User.id)
            .order_by(func.count(ChatMessage.id).desc())
            .limit(8)
        )
    ).all()

    return {
        "active_agents": active_agents,
        "total_sessions": total_sessions,
        "messages_this_week": sum(d["messages"] for d in daily_activity),
        "daily_activity": daily_activity,
        "operators": [
            {"name": name, "role": role_label(role), "ops": int(ops)}
            for name, role, ops in operator_rows
        ],
    }
