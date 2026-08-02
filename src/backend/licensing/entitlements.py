"""Що саме відкриває ліцензія.

Три правила, з яких випливає весь файл.

1. БЕЗПЕКА НЕ КОШТУЄ ГРОШЕЙ. Навігація, тривоги, попередження про підміну
   GNSS і сховище лежать у `free` і не вимикаються ніколи — ні без ключа, ні
   після його кінця, ні коли сервер недосяжний. Ворота не БЛОКУЮТЬ доступ,
   вони ЗНИЖУЮТЬ рівень.

2. Безстроково — значить безстроково. `updates_until` не гасить ліцензію: він
   каже, до якої ЗБІРКИ вона застосовна. Куплена версія працює вічно; новіша
   за вікно оновлень запускається на вільному рівні.

3. Без мережі теж треба жити. Ліцензія тримається `OFFLINE_GRACE_DAYS` від
   останньої вдалої перевірки. Дзеркало на сайті: src/lib/plans.ts.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from licensing.verifier import LicenseStatus, license_status

TIER_ORDER = ("free", "personal", "crew", "unit")

# Право → найнижчий рівень, що його відкриває.
FEATURES: dict[str, str] = {
    "core.chat": "free",
    "core.map": "free",
    "core.nav": "free",
    "core.alerts": "free",
    "core.vault": "free",
    "core.voice": "free",
    "bridge.pair": "personal",
    "memory.longterm": "personal",
    "map.terrain3d": "personal",
    "voice.premium": "personal",
    "gnss.blackbox": "personal",
    "export.reports": "personal",
    "crew.sync": "crew",
    "fleet.onprem": "unit",
}

TRIAL_DAYS = int(os.environ.get("PHANTOM_TRIAL_DAYS", "14"))
OFFLINE_GRACE_DAYS = int(os.environ.get("PHANTOM_OFFLINE_GRACE_DAYS", "30"))

#: Дата збірки, що працює. Ліцензія покриває її, якщо `updates_until` не раніше.
BUILD_DATE = os.environ.get("PHANTOM_BUILD_DATE", "2026-08-03")

TRIAL_FILE = Path(
    os.environ.get("PHANTOM_TRIAL_FILE", "~/.phantom/trial.json")
).expanduser()
LAST_SEEN_FILE = Path(
    os.environ.get("PHANTOM_LICENSE_SEEN_FILE", "~/.phantom/license-seen.json")
).expanduser()


def _rank(tier: str | None) -> int:
    try:
        return TIER_ORDER.index(tier or "free")
    except ValueError:
        return 0


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def trial_started_on() -> date:
    """Перший запуск. Записуємо один раз; далі лише читаємо."""
    try:
        return date.fromisoformat(json.loads(TRIAL_FILE.read_text())["started"])
    except (OSError, KeyError, ValueError, json.JSONDecodeError):
        started = _today()
        try:
            TRIAL_FILE.parent.mkdir(parents=True, exist_ok=True)
            TRIAL_FILE.write_text(json.dumps({"started": started.isoformat()}))
            TRIAL_FILE.chmod(0o600)
        except OSError:
            pass  # тільки читання — проба просто не переживе перезапуску
        return started


def trial_days_left() -> int:
    left = TRIAL_DAYS - (_today() - trial_started_on()).days
    return max(0, left)


def mark_server_seen() -> None:
    """Сервер щойно підтвердив ліцензію — звідси рахується пільговий строк."""
    try:
        LAST_SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        LAST_SEEN_FILE.write_text(json.dumps({"seen": _today().isoformat()}))
        LAST_SEEN_FILE.chmod(0o600)
    except OSError:
        pass


def _last_seen() -> date | None:
    try:
        return date.fromisoformat(json.loads(LAST_SEEN_FILE.read_text())["seen"])
    except (OSError, KeyError, ValueError, json.JSONDecodeError):
        return None


def grace_days_left() -> int | None:
    """None — сервер не бачили жодного разу; пільгу тоді не рахуємо."""
    seen = _last_seen()
    if seen is None:
        return None
    return max(0, OFFLINE_GRACE_DAYS - (_today() - seen).days)


@dataclass
class Entitlement:
    """Рівень, що діє ЗАРАЗ, і чесна причина, чому саме він."""

    tier: str
    reason: str
    license_tier: str | None = None
    trial_days_left: int = 0
    grace_days_left: int | None = None
    updates_until: str | None = None
    build_date: str = BUILD_DATE

    @property
    def features(self) -> list[str]:
        limit = _rank(self.tier)
        return sorted(k for k, need in FEATURES.items() if _rank(need) <= limit)

    def has(self, feature: str) -> bool:
        need = FEATURES.get(feature)
        if need is None:
            return True  # незнане право не вигадуємо — воно просто не ворота
        return _rank(self.tier) >= _rank(need)

    def as_dict(self) -> dict:
        return {
            "tier": self.tier,
            "reason": self.reason,
            "license_tier": self.license_tier,
            "trial_days_left": self.trial_days_left,
            "grace_days_left": self.grace_days_left,
            "updates_until": self.updates_until,
            "build_date": self.build_date,
            "features": self.features,
        }


def resolve(status: LicenseStatus | None = None) -> Entitlement:
    st = status if status is not None else license_status()
    trial_left = trial_days_left()

    if not st.valid:
        # Проба діє лише поки її не витратили, і НЕ після того, як ключ уже був:
        # інакше кожне видалення файлу ліцензії дарувало б ще два тижні.
        if trial_left > 0 and _last_seen() is None:
            return Entitlement(
                tier="personal", reason="trial", trial_days_left=trial_left
            )
        return Entitlement(tier="free", reason=st.reason, trial_days_left=trial_left)

    grace = grace_days_left()
    if grace == 0:
        return Entitlement(
            tier="free",
            reason="offline_too_long",
            license_tier=st.tier,
            grace_days_left=0,
            updates_until=st.updates_until,
        )

    covers = _parse_date(st.updates_until)
    build = _parse_date(BUILD_DATE)
    if covers is not None and build is not None and build > covers:
        # Ліцензія жива, але ця збірка вийшла після вікна оновлень. Стара
        # версія в неї входить — саме тому це не «недійсна», а «не покриває».
        return Entitlement(
            tier="free",
            reason="updates_expired",
            license_tier=st.tier,
            grace_days_left=grace,
            updates_until=st.updates_until,
        )

    tier = st.tier if st.tier in TIER_ORDER else "personal"
    return Entitlement(
        tier=tier,
        reason="ok",
        license_tier=st.tier,
        grace_days_left=grace,
        updates_until=st.updates_until,
    )


def next_tier_for(feature: str) -> str | None:
    """Який рівень треба, щоб право відкрилось — для чесного тексту у воротах."""
    return FEATURES.get(feature)


def days_until(raw: str | None) -> int | None:
    d = _parse_date(raw)
    return None if d is None else (d - _today()).days


# Дрібний кеш: ворота смикають resolve() на кожен запит, а він читає диск.
_cache: tuple[float, Entitlement] | None = None
_CACHE_TTL_S = 10.0


def cached() -> Entitlement:
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < _CACHE_TTL_S:
        return _cache[1]
    ent = resolve()
    _cache = (now, ent)
    return ent


def invalidate() -> None:
    global _cache
    _cache = None


__all__ = [
    "BUILD_DATE",
    "Entitlement",
    "FEATURES",
    "OFFLINE_GRACE_DAYS",
    "TIER_ORDER",
    "TRIAL_DAYS",
    "cached",
    "days_until",
    "grace_days_left",
    "invalidate",
    "mark_server_seen",
    "next_tier_for",
    "resolve",
    "trial_days_left",
]
