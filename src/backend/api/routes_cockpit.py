"""Кокпіт оператора (Ф4) — тонкі читальні маршрути.

Доктрина Ф4: жодного числа без джерела. Цей файл НЕ вигадує даних —
він лише відкриває HTTP-вікна у вже наявні чесні внутрішні джерела:

* GET /cockpit/machine — системні метрики машини. CPU береться з
  ``system_metrics_sampler`` (1 Гц фоновий сампер, єдиний чесний
  «CPU зараз» цього дерева — ``/linux/resources`` досі читає
  ``cpu_percent(interval=None)`` напряму, що на першому виклику
  завжди 0.0). RAM/диск/аптайм — psutil на місці виклику. Слухачі
  вузла — конфіг (HTTP-порт), ``app.state.tls_listener`` (справжній
  стан TLS-слухача, не конфіг-побажання) і стан mDNS-оголошення.
* GET /cockpit/audit — журнал аудиту виконавця (таблиця
  ``agent_audit`` — у неї пише і когнітивний рантайм, і
  ``record_tool_invocation`` на кожному шляху chat-tool) з курсорною
  пагінацією за id.

Обидва — operator-grade: кокпіт бачить машину і журнал, але не керує.
"""
from __future__ import annotations

import os
import time
from datetime import timezone
from typing import Any, Optional

import psutil
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import system_metrics_sampler
from api.websocket_hub import hub
from config import config
from db.database import get_db
from db.models import AgentAuditEntry, User
from security.permissions import require_operator

# Спільна конвенція статусу рядка аудиту (ok/retry/fail) живе в
# tools.audit_service._status_for — імпортуємо саме її, щоб кокпіт і
# сцени чату ніколи не розійшлись у трактуванні одного й того ж рядка.
from tools.audit_service import _status_for

router = APIRouter(prefix="/cockpit", tags=["cockpit"])


def _mdns_state() -> str:
    """Стан mDNS-оголошення цього вузла, словом.

    ``discovery.mdns_publisher`` тримає єдиний глобальний publisher у
    модульній змінній ``_publisher`` і не має публічного акцесора;
    читаємо її через getattr (лише читання, без побічних ефектів).
    """
    if os.environ.get("PHANTOM_SKIP_MDNS") == "1":
        return "вимкнено (PHANTOM_SKIP_MDNS)"
    from discovery import mdns_publisher

    return (
        "оголошено"
        if getattr(mdns_publisher, "_publisher", None) is not None
        else "не оголошено"
    )


@router.get("/machine")
async def get_machine(
    request: Request,
    _user: User = Depends(require_operator),
) -> dict[str, Any]:
    now_ms = int(time.time() * 1000)

    # CPU: лише зі сампера. Якщо сампер не запущений (lifespan ще не
    # дійшов або тест без warmup) — чесний null, не нуль.
    cpu_pct: Optional[float] = (
        round(float(system_metrics_sampler.get_cpu_percent()), 1)
        if system_metrics_sampler.is_running()
        else None
    )

    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    host_uptime_s = max(0, int(time.time() - psutil.boot_time()))
    backend_uptime_s = max(
        0, int(time.time() - psutil.Process(os.getpid()).create_time())
    )

    tls_listener = getattr(request.app.state, "tls_listener", None)
    if tls_listener is not None:
        tls: dict[str, Any] = {
            "state": "слухає",
            "port": int(tls_listener.port),
            "bound": list(tls_listener.bound),
        }
    else:
        tls = {"state": "не піднявся", "port": int(config.pair_tls_port), "bound": []}

    return {
        "sampled_at_ms": now_ms,
        "cpu": {
            "pct": cpu_pct,
            "source": "system_metrics_sampler (1 Гц)",
        },
        "ram": {
            "total": int(vm.total),
            "used": int(vm.used),
            "pct": round(float(vm.percent), 1),
        },
        "disk": {
            "total": int(disk.total),
            "used": int(disk.used),
            "pct": round(float(disk.percent), 1),
        },
        "uptime": {"host_s": host_uptime_s, "backend_s": backend_uptime_s},
        "listeners": {
            "http": {"host": config.host, "port": int(config.port)},
            "tls": tls,
            "mdns": {"state": _mdns_state()},
            "ws_clients": hub.client_count,
        },
    }


@router.get("/audit")
async def get_audit(
    limit: int = Query(default=20, ge=1, le=100),
    before_id: Optional[int] = Query(default=None, ge=1),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_operator),
) -> dict[str, Any]:
    """Сторінка журналу аудиту, новіші згори.

    Курсор — ``before_id``: віддаємо рядки з id строго меншим за нього.
    ``next_before_id`` == null означає «журнал вичерпано».
    """
    total = int(
        (await db.execute(select(func.count(AgentAuditEntry.id)))).scalar() or 0
    )

    stmt = select(AgentAuditEntry).order_by(AgentAuditEntry.id.desc()).limit(limit)
    if before_id is not None:
        stmt = stmt.where(AgentAuditEntry.id < before_id)
    rows = list((await db.execute(stmt)).scalars().all())

    entries: list[dict[str, Any]] = []
    for row in rows:
        ts = row.timestamp
        # db.models._now пише tz-aware UTC, але SQLite віддає naive —
        # naive тут ЗАВЖДИ означає UTC (та сама конвенція, що в
        # tools.audit_service._ms). Без цього .timestamp() трактував би
        # час як локальний і журнал брехав би на зсув пояса.
        if ts is not None and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        entries.append(
            {
                "id": int(row.id),
                "ts_ms": int(ts.timestamp() * 1000) if ts is not None else None,
                "action_name": row.action_name,
                "intent": (row.intent or None),
                "status": _status_for(row),
                "elapsed_ms": int(row.elapsed_ms or 0),
                "task_id": row.task_id,
            }
        )

    next_before_id = int(rows[-1].id) if len(rows) == limit else None
    return {"total": total, "entries": entries, "next_before_id": next_before_id}
