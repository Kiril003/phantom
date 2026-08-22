"""Симбіот — стан організму й обмін командами між тілами.

  GET  /api/v1/symbiote/state         хто живий, де він, що вміє
  POST /api/v1/symbiote/presence      тіло повідомляє про себе (пристрій)
  POST /api/v1/symbiote/command       попросити інше тіло щось зробити
  POST /api/v1/symbiote/result        відповідь виконавця
  GET  /api/v1/symbiote/inbox         черга листів для цього тіла

Дозволи перевіряються на боці ВИКОНАВЦЯ: телефон із самими сенсорами не
набере тексту на ПК, навіть якщо попросить дуже ввічливо.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import PairedDevice, User
from security.auth import get_current_user
from security.device_auth import (
    caller_device,
    device_capabilities,
    get_current_device,
    get_user_or_device_user,
)
from symbiote.commands import (
    CommandResult,
    SymbioteCommand,
    command_bus,
    command_registry,
    dispatch_command,
)
from symbiote.presence import presence_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/symbiote", tags=["symbiote"])

DESKTOP_BODY_ID = "desktop"


class PresenceIn(BaseModel):
    battery_pct: Optional[int] = Field(default=None, ge=0, le=100)
    charging: Optional[bool] = None
    network: Optional[str] = Field(default=None, max_length=16)
    foreground: Optional[str] = Field(default=None, max_length=64)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)
    accuracy_m: Optional[float] = Field(default=None, ge=0)
    motion: Optional[str] = Field(default=None, max_length=24)


class CommandIn(BaseModel):
    verb: str = Field(..., max_length=48)
    args: dict[str, Any] = Field(default_factory=dict)
    target_body: str = Field(default="", max_length=64)
    wait_s: float = Field(default=0.0, ge=0, le=30)


class ResultIn(BaseModel):
    command_id: str = Field(..., max_length=64)
    ok: bool
    detail: str = Field(default="", max_length=512)
    payload: dict[str, Any] = Field(default_factory=dict)


def _desktop_body(user: User) -> None:
    """ПК — теж тіло, і воно теж мусить відчувати себе."""
    from symbiote.desktop_body import pulse

    presence_store.update(
        user.id,
        DESKTOP_BODY_ID,
        kind="desktop",
        name="Цей комп'ютер",
        online=True,
        capabilities=["control", "vault", "files", "compute"],
        **pulse(),
    )


@router.get("/state")
async def symbiote_state(
    user: User = Depends(get_user_or_device_user),
) -> dict[str, Any]:
    _desktop_body(user)
    snap = presence_store.snapshot(user.id)
    snap["verbs"] = command_registry.all()
    return snap


@router.post("/presence")
async def report_presence(
    body: PresenceIn,
    bundle: tuple[PairedDevice, Any] = Depends(get_current_device),
) -> dict[str, Any]:
    device, _payload = bundle
    presence = presence_store.update(
        device.user_id,
        device.id,
        kind="phone",
        name=device.device_name or device.device_model or "Телефон",
        online=True,
        capabilities=sorted(device_capabilities(device)),
        **body.model_dump(exclude_none=True),
    )
    try:
        from api.websocket_hub import hub

        await hub.broadcast(
            "symbiote", "presence", presence.to_dict(), user_id=device.user_id,
        )
    except Exception as exc:  # noqa: BLE001 — пульс не має валити запит
        logger.debug("symbiote presence broadcast failed: %s", exc)
    return presence.to_dict()


@router.post("/command")
async def send_command(
    body: CommandIn,
    user: User = Depends(get_user_or_device_user),
    caller: Optional[PairedDevice] = Depends(caller_device),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    spec = command_registry.spec(body.verb)
    if spec is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "unknown_verb", "verb": body.verb},
        )
    if spec["body_kind"] == "desktop" and caller is not None:
        if spec["requires"] not in device_capabilities(caller):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "capability_denied",
                    "capability": spec["requires"],
                    "message": (
                        f"Пристрою не надано дозвіл «{spec['requires']}» — "
                        "увімкни його на ПК: Налаштування → Мобільний."
                    ),
                },
            )
    if spec["body_kind"] == "phone":
        target_id = body.target_body
        if not target_id:
            for candidate in presence_store.bodies(user.id):
                if candidate.kind == "phone" and candidate.online:
                    target_id = candidate.body_id
                    break
        device = await db.get(PairedDevice, target_id) if target_id else None
        if device is None or device.revoked_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "no_body", "message": "Телефон не на зв'язку"},
            )
        if spec["requires"] not in device_capabilities(device):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "capability_denied",
                    "capability": spec["requires"],
                    "message": (
                        f"Телефону не надано дозвіл «{spec['requires']}» — "
                        "увімкни його в Налаштування → Мобільний."
                    ),
                },
            )

    command = SymbioteCommand(
        verb=body.verb,
        args=body.args,
        target_body=body.target_body,
        issued_by=DESKTOP_BODY_ID,
        requires=spec["requires"],
    )
    accepted, why, result = await dispatch_command(
        user_id=user.id, command=command, wait_s=body.wait_s,
    )
    if not accepted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "not_delivered", "message": why},
        )
    return {
        "command_id": command.id,
        "delivered": True,
        "result": None if result is None else {
            "ok": result.ok,
            "detail": result.detail,
            "payload": result.payload,
        },
        "note": why,
    }


async def _learn_from_phone_radio(
    db: AsyncSession, device: PairedDevice, packed: str,
) -> None:
    try:
        from geo.wifi_scan import learn, parse_packed
    except ImportError:
        # Ф0: geo/wifi_scan.py живе на rescue-гілці і сюди ще не приїхав.
        # Це фонове донавчання радіо, а не обіцяний маршрут — телефонний
        # виклик не має 500-ити через відсутній файл; втрату чесно видно
        # в debug-лозі, а не приховано порожнім успіхом.
        logger.debug(
            "symbiote: geo.wifi_scan відсутній на цій гілці — пакет радіо не вивчено"
        )
        return

    body = presence_store.get(device.user_id, device.id)
    if body is None or body.lat is None or body.lon is None:
        return
    try:
        await learn(
            db, body.lat, body.lon, body.accuracy_m or 999.0, parse_packed(packed),
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("symbiote: точки з телефона не лягли: %s", exc)


@router.get("/inbox")
async def inbox(
    bundle: tuple[PairedDevice, Any] = Depends(get_current_device),
) -> dict[str, Any]:
    device, _payload = bundle
    commands = await command_bus.drain(device.id)
    return {"commands": [c.to_wire() for c in commands]}


@router.post("/result")
async def report_result(
    body: ResultIn,
    bundle: tuple[PairedDevice, Any] = Depends(get_current_device),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    device, _payload = bundle
    # Відповідь із координатами — це не просто «зроблено», це нове місце
    # організму. Інакше ПК спитав би «де ти», почув відповідь і забув її.
    if body.ok and {"lat", "lon"} <= set(body.payload):
        try:
            presence_store.update(
                device.user_id,
                device.id,
                kind="phone",
                lat=float(body.payload["lat"]),
                lon=float(body.payload["lon"]),
                accuracy_m=float(body.payload.get("accuracy_m") or 0) or None,
            )
        except (TypeError, ValueError):
            logger.debug("symbiote: у відповіді криві координати")
    if body.ok and body.payload.get("aps"):
        await _learn_from_phone_radio(db, device, str(body.payload["aps"]))
    await command_bus.settle(
        CommandResult(
            command_id=body.command_id,
            ok=body.ok,
            detail=body.detail,
            payload=body.payload,
        )
    )
    return {"ok": True}
