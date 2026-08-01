from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta
from typing import Dict, Any, List

from db.database import get_db
from db.models import Tenant, ChatSession, AgentTask, Subscription
from api.dependencies import get_current_tenant

router = APIRouter(prefix="/analytics", tags=["analytics"])

@router.get("/overview", response_model=Dict[str, Any])
async def get_analytics_overview(
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db)
):
    from db.models import User
    
    # Get active agents (tasks that are running or scheduled)
    active_tasks_result = await db.execute(
        select(func.count(AgentTask.id))
        .join(User, AgentTask.user_id == User.id)
        .where(
            User.tenant_id == tenant.id,
            AgentTask.status.in_(["RUNNING", "SCHEDULED", "PENDING"])
        )
    )
    active_agents = active_tasks_result.scalar() or 0

    # Get total sessions
    sessions_result = await db.execute(
        select(func.count(ChatSession.id))
        .join(User, ChatSession.user_id == User.id)
        .where(
            User.tenant_id == tenant.id
        )
    )
    total_sessions = sessions_result.scalar() or 0

    # Get tokens used this month from Subscription (if exists)
    sub_result = await db.execute(
        select(Subscription).where(Subscription.tenant_id == tenant.id)
    )
    subscription = sub_result.scalar_one_or_none()
    tokens_used = subscription.tokens_used if subscription else 0
    max_tokens = subscription.max_tokens if subscription else 1000

    # Generate some mock daily usage for charts (last 7 days)
    # In a real app, this would be grouped by date from an API usage table
    today = datetime.utcnow().date()
    daily_usage = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        # Mocking some usage curve based on the total tokens
        usage = int(tokens_used * (0.1 + (i % 3) * 0.05)) if tokens_used > 0 else 0
        daily_usage.append({
            "date": day.isoformat(),
            "tokens": usage
        })

    return {
        "tokens_used_this_month": tokens_used,
        "max_tokens": max_tokens,
        "active_agents": active_agents,
        "total_sessions": total_sessions,
        "daily_usage": daily_usage,
        "subscription_tier": subscription.tier if subscription else "Free"
    }
