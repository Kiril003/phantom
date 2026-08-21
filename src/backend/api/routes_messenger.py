"""`/api/v1/messenger/*` — транспорт месенджера.

Поки що один маршрут: стан власного ретранслятора. Панель мережі в клієнті
малює тільки те, що приходить звідси, тому тут не можна віддавати ні
підставлену латентність, ні статус «online» для вузла, який ніхто не питав.
Якщо ретранслятор не піднято, так і кажемо: connected=false і причина.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from db.models import User
from node.identity import node_id
from security.auth import get_current_user

router = APIRouter(prefix="/messenger", tags=["messenger"])


class RelayStatus(BaseModel):
    """Дзеркалить RelayClient.status() один-до-одного."""

    connected: bool
    node_id: str
    relay: str
    sessions: int
    last_error: str


@router.get("/relay/status", response_model=RelayStatus)
async def get_relay_status(
    request: Request,
    _user: User = Depends(get_current_user),
) -> RelayStatus:
    client = getattr(request.app.state, "relay_client", None)
    if client is None:
        # Ретранслятор вимкнено в конфізі або він не стартував — вузол усе одно
        # має ім'я, і клієнту корисно його бачити.
        return RelayStatus(
            connected=False,
            node_id=node_id(),
            relay="",
            sessions=0,
            last_error="relay client not started",
        )
    return RelayStatus(**client.status())
