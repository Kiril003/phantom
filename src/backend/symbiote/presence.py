"""Присутність тіл симбіота.

Досі про телефон було відомо одне: колись спарився, колись його бачили.
Для одного організму цього замало — тіло має відчувати друге тіло
безперервно: живе воно чи спить, скільки в ньому заряду, на чому воно
зараз, де воно і чи рухається.

Тримаємо в пам'яті: це стан «просто зараз», а не історія. Історію пише
`LocationHistory` і сенсорні пакети; тут — пульс.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict
from threading import Lock
from typing import Any, Optional

#: Скільки секунд без сигналу вважати тіло притомним. Телефон шле пульс
#: рідко (радіо коштує батареї), тож вікно щедре.
STALE_AFTER_S = 90.0


@dataclass
class BodyPresence:
    """Що одне тіло знає про себе просто зараз."""

    body_id: str
    kind: str  # "desktop" | "phone"
    name: str = ""
    online: bool = False
    battery_pct: Optional[int] = None
    charging: Optional[bool] = None
    network: str = ""  # wifi | mobile | ethernet | offline
    foreground: str = ""  # що зараз на екрані
    lat: Optional[float] = None
    lon: Optional[float] = None
    accuracy_m: Optional[float] = None
    motion: str = ""  # still | walking | driving …
    capabilities: list[str] = field(default_factory=list)
    updated_at: float = field(default_factory=time.time)

    @property
    def fresh(self) -> bool:
        return (time.time() - self.updated_at) < STALE_AFTER_S

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["age_s"] = round(time.time() - self.updated_at, 1)
        data["fresh"] = self.fresh
        return data


class PresenceStore:
    """Реєстр тіл одного оператора."""

    def __init__(self) -> None:
        self._bodies: dict[str, dict[str, BodyPresence]] = {}
        self._lock = Lock()

    def update(self, user_id: str, body_id: str, **fields: Any) -> BodyPresence:
        with self._lock:
            bodies = self._bodies.setdefault(user_id, {})
            body = bodies.get(body_id)
            if body is None:
                body = BodyPresence(
                    body_id=body_id,
                    kind=str(fields.pop("kind", "phone")),
                )
                bodies[body_id] = body
            for key, value in fields.items():
                if value is None or not hasattr(body, key):
                    continue
                setattr(body, key, value)
            body.updated_at = time.time()
            return body

    def mark_offline(self, user_id: str, body_id: str) -> None:
        with self._lock:
            body = self._bodies.get(user_id, {}).get(body_id)
            if body is not None:
                body.online = False
                body.updated_at = time.time()

    def bodies(self, user_id: str) -> list[BodyPresence]:
        with self._lock:
            return list(self._bodies.get(user_id, {}).values())

    def get(self, user_id: str, body_id: str) -> Optional[BodyPresence]:
        with self._lock:
            return self._bodies.get(user_id, {}).get(body_id)

    def snapshot(self, user_id: str) -> dict[str, Any]:
        """Стан організму цілком — те, що показує панель симбіота."""
        bodies = [b.to_dict() for b in self.bodies(user_id)]
        alive = [b for b in bodies if b["online"] and b["fresh"]]
        return {
            "bodies": bodies,
            "alive": len(alive),
            "total": len(bodies),
            # Одне місце на весь організм: беремо найточніше свіже.
            "position": _best_position(alive),
        }


def _best_position(bodies: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    located = [
        b for b in bodies
        if b.get("lat") is not None and b.get("lon") is not None
    ]
    if not located:
        return None
    best = min(located, key=lambda b: b.get("accuracy_m") or 1e9)
    return {
        "lat": best["lat"],
        "lon": best["lon"],
        "accuracy_m": best.get("accuracy_m"),
        "from_body": best["body_id"],
        "from_name": best.get("name") or best.get("kind"),
        "motion": best.get("motion") or "",
    }


presence_store = PresenceStore()

__all__ = ["BodyPresence", "PresenceStore", "presence_store", "STALE_AFTER_S"]
