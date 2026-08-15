"""Команди між тілами симбіота.

Досі керування було однобічним і безіменним: телефон міг штовхати клавіші
в ПК через `/drive`, а ПК телефону — нічого. Симбіот потребує рівності:
будь-яке тіло просить інше зробити те, на що має дозвіл, і чує відповідь.

Команда — не виклик функції, а лист із адресою, дозволом і терміном.
Тіло-виконавець може бути офлайн; тоді лист чекає, а не зникає.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

#: Скільки лист чекає на виконавця, поки не протухне.
COMMAND_TTL_S = 120.0


@dataclass
class SymbioteCommand:
    verb: str
    args: dict[str, Any] = field(default_factory=dict)
    target_body: str = ""          # порожньо — будь-яке придатне тіло
    issued_by: str = ""            # body_id того, хто просить
    requires: str = ""             # потрібний дозвіл на боці виконавця
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: float = field(default_factory=time.time)

    def expired(self, now: Optional[float] = None) -> bool:
        return ((now or time.time()) - self.created_at) > COMMAND_TTL_S

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "verb": self.verb,
            "args": self.args,
            "issued_by": self.issued_by,
            "requires": self.requires,
        }


@dataclass
class CommandResult:
    command_id: str
    ok: bool
    detail: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


class CommandRegistry:
    """Що вміє кожен вид тіла — і чого просити марно."""

    def __init__(self) -> None:
        self._verbs: dict[str, dict[str, str]] = {}

    def register(self, verb: str, *, body_kind: str, requires: str, title: str) -> None:
        self._verbs[verb] = {
            "body_kind": body_kind,
            "requires": requires,
            "title": title,
        }

    def known(self, verb: str) -> bool:
        return verb in self._verbs

    def spec(self, verb: str) -> Optional[dict[str, str]]:
        return self._verbs.get(verb)

    def for_body_kind(self, kind: str) -> list[dict[str, str]]:
        return [
            {"verb": v, **spec}
            for v, spec in self._verbs.items()
            if spec["body_kind"] == kind
        ]

    def all(self) -> list[dict[str, str]]:
        return [{"verb": v, **spec} for v, spec in self._verbs.items()]


command_registry = CommandRegistry()

# Те, що ПК просить у телефона. Кожне — з дозволом, який оператор дає явно.
command_registry.register(
    "phone.locate", body_kind="phone", requires="sensors",
    title="Віддай своє місце зараз",
)
command_registry.register(
    "phone.ring", body_kind="phone", requires="approvals",
    title="Подай звук — я тебе загубив",
)
command_registry.register(
    "phone.notify", body_kind="phone", requires="approvals",
    title="Покажи сповіщення",
)
command_registry.register(
    "phone.speak", body_kind="phone", requires="approvals",
    title="Скажи це вголос",
)
command_registry.register(
    "phone.wifi_scan", body_kind="phone", requires="sensors",
    title="Що бачить твоє радіо",
)

command_registry.register(
    "pc.type", body_kind="desktop", requires="control",
    title="Набери текст",
)
command_registry.register(
    "pc.clipboard", body_kind="desktop", requires="control",
    title="Поклади в буфер",
)
command_registry.register(
    "pc.open", body_kind="desktop", requires="control",
    title="Відкрий це",
)
command_registry.register(
    "pc.lock", body_kind="desktop", requires="control",
    title="Замкни екран",
)
command_registry.register(
    "pc.notify", body_kind="desktop", requires="approvals",
    title="Покажи сповіщення",
)


class CommandBus:
    """Черга листів на кожне тіло + очікування відповіді."""

    def __init__(self) -> None:
        self._pending: dict[str, list[SymbioteCommand]] = {}
        self._waiters: dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    async def enqueue(self, body_id: str, command: SymbioteCommand) -> None:
        async with self._lock:
            queue = self._pending.setdefault(body_id, [])
            queue[:] = [c for c in queue if not c.expired()]
            queue.append(command)

    async def drain(self, body_id: str) -> list[SymbioteCommand]:
        async with self._lock:
            queue = self._pending.pop(body_id, [])
        return [c for c in queue if not c.expired()]

    async def expect(self, command_id: str) -> asyncio.Future:
        """Поставити вухо ДО відправки: відповідь буває швидша за очікувача."""
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        async with self._lock:
            self._waiters[command_id] = future
        return future

    async def wait_for(
        self,
        command_id: str,
        timeout_s: float,
        future: Optional[asyncio.Future] = None,
    ) -> Optional[CommandResult]:
        waiter = future if future is not None else await self.expect(command_id)
        try:
            return await asyncio.wait_for(waiter, timeout=timeout_s)
        except asyncio.TimeoutError:
            return None
        finally:
            async with self._lock:
                self._waiters.pop(command_id, None)

    async def settle(self, result: CommandResult) -> None:
        async with self._lock:
            future = self._waiters.pop(result.command_id, None)
        if future is not None and not future.done():
            future.set_result(result)


command_bus = CommandBus()


async def dispatch_command(
    *,
    user_id: str,
    command: SymbioteCommand,
    wait_s: float = 0.0,
) -> tuple[bool, str, Optional[CommandResult]]:
    """Відправити лист тілу. Повертає (прийнято, чому ні, відповідь)."""
    from api.websocket_hub import hub
    from symbiote.presence import presence_store

    spec = command_registry.spec(command.verb)
    if spec is None:
        return False, f"невідома команда: {command.verb}", None
    command.requires = command.requires or spec["requires"]

    if spec["body_kind"] == "desktop":
        from symbiote import desktop_hands

        ok, detail, payload = await desktop_hands.execute(command.verb, command.args)
        logger.info("symbiote: %s на ПК → %s (%s)", command.verb, ok, detail)
        return True, "", CommandResult(
            command_id=command.id, ok=ok, detail=detail, payload=payload,
        )

    target = command.target_body
    if not target:
        for body in presence_store.bodies(user_id):
            if body.kind == spec["body_kind"] and body.online:
                target = body.body_id
                break
    if not target:
        return False, f"немає тіла виду «{spec['body_kind']}» на зв'язку", None

    waiter = await command_bus.expect(command.id) if wait_s > 0 else None
    await command_bus.enqueue(target, command)
    await hub.broadcast(
        "symbiote", "command",
        {"target_body": target, **command.to_wire()},
        user_id=user_id,
    )
    logger.info(
        "symbiote: %s → %s (%s)", command.verb, target, command.id[:8],
    )
    if waiter is None:
        return True, "", None
    result = await command_bus.wait_for(command.id, wait_s, future=waiter)
    return True, "" if result else "тіло не відповіло вчасно", result


__all__ = [
    "SymbioteCommand",
    "CommandResult",
    "CommandRegistry",
    "command_registry",
    "command_bus",
    "dispatch_command",
    "COMMAND_TTL_S",
]
