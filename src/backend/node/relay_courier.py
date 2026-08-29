"""Дорога до сховка PH5: покласти, забрати, спалити.

Протокол — у `peer_relay.py`, і він нічого не знає про мережу. Тут навпаки:
жодної криптографії, лише HTTP і чесні стани.

ГОЛОВНЕ ПРАВИЛО ЦЬОГО ФАЙЛА. Клас дефектів №1 у цьому домі — «мовчки нічого
не робить». Тому жоден шлях звідси не повертає успіх, якого не було, і жоден
не ковтає відмову. Кожен вихід — названий стан:

    Held      лист лежить у сховку, сервер назвав дату
    Busy      429: забагато запитів з цієї IP (120/хв), сказано скільки чекати
    Full      507: місця немає. Сервер НЕ витирає чужий лист заради нашого
    Refused   400: наш конверт не за контрактом — це НАША помилка, не мережева
    Offline   до сервера не дійшли: мережа, DNS, час вийшов

`Refused` навмисно окремо від решти: 400 означає, що ми зібрали конверт не
тієї довжини або адресу не тієї форми, тобто розійшлися з телефоном. Такий
стан не можна повторювати з відкотом — повтор дасть те саме 400 і з'їсть
спробу. Його треба бачити.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass, field
from typing import Optional, Sequence, Union

import httpx

from node import peer_relay as pr

logger = logging.getLogger(__name__)

#: Ліміт сервера — 120 запитів за 60 с на IP (platform-site/server/main.py:134).
#: Тут він потрібен лише щоб не сваритись у логах, коли 429 таки прилетить.
SERVER_RATE_PER_MINUTE = 120

DEFAULT_TIMEOUT_S = 30.0


# ── Стани ────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Held:
    """Лежить. `held_until` — коли сховок його забуде, якщо ніхто не забере."""

    held_until: str


@dataclass(frozen=True)
class Busy:
    """429. Не помилка — правило. Чекати й повторити."""

    retry_after_s: float = 60.0


@dataclass(frozen=True)
class Full:
    """507. Місця немає — і сервер не звільняє його, витираючи чужий лист."""


@dataclass(frozen=True)
class Refused:
    """400. Наш конверт не за контрактом. Повторювати НЕ можна."""

    detail: str


@dataclass(frozen=True)
class Offline:
    """До сервера не дійшли. Лист живий, дорога — ні."""

    reason: str


DropOutcome = Union[Held, Busy, Full, Refused, Offline]


@dataclass(frozen=True)
class Letter:
    """Конверт, як його віддав сховок."""

    id: str
    tag: str
    blob: bytes


@dataclass(frozen=True)
class Fetched:
    letters: list[Letter] = field(default_factory=list)


FetchOutcome = Union[Fetched, Busy, Refused, Offline]


@dataclass(frozen=True)
class Burned:
    count: int


BurnOutcome = Union[Burned, Busy, Refused, Offline]


# ── Дорога ───────────────────────────────────────────────────────────────────


class RelayCourier:
    """Тонкий клієнт сховка. Не тримає стану листів — цим відає той, хто вище.

    Не має ні черги, ні повторів усередині: черга — це стан, а стан у клієнті
    транспорту означав би два джерела правди про те, доїхав лист чи ні. Тут
    лише названий результат одного походу.
    """

    def __init__(
        self,
        base_url: str,
        client: Optional[httpx.AsyncClient] = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        self._base = (base_url or "").strip().rstrip("/")
        self._timeout = timeout_s
        self._client = client
        self._own_client = client is None

    @property
    def configured(self) -> bool:
        """Порожня адреса — це «дороги немає», а не «спробуй кудись»."""
        return bool(self._base)

    async def _post(self, path: str, body: dict) -> Union[dict, Busy, Full, Refused, Offline]:
        if not self.configured:
            return Offline("адресу сховка не задано (relay_store_url порожній)")
        client = self._client or httpx.AsyncClient(timeout=self._timeout)
        try:
            response = await client.post(f"{self._base}{path}", json=body, timeout=self._timeout)
        except httpx.HTTPError as exc:
            # Мережеві збої — норма для вузла, який часто офлайн. Не помилка
            # рівня ERROR: лист лишається в черзі й поїде наступним заходом.
            logger.info("сховок недосяжний (%s): %s", path, exc.__class__.__name__)
            return Offline(f"{exc.__class__.__name__}: {exc}")
        finally:
            if self._own_client:
                await client.aclose()

        if response.status_code == 429:
            retry = response.headers.get("Retry-After")
            try:
                wait = float(retry) if retry else 60.0
            except ValueError:
                wait = 60.0
            return Busy(retry_after_s=wait)
        if response.status_code == 507:
            return Full()
        if response.status_code == 400:
            # Розходження з контрактом. Гучно, бо це наша помилка збірки
            # конверта, і повтор її не вилікує.
            logger.error("сховок відхилив запит %s за контрактом: %s", path, _detail(response))
            return Refused(_detail(response))
        if response.status_code >= 500:
            return Offline(f"сервер відповів {response.status_code}")
        if response.status_code != 200:
            return Refused(f"несподіваний код {response.status_code}: {_detail(response)}")
        try:
            return response.json()
        except ValueError:
            return Refused("сховок відповів не JSON")

    async def drop(self, tag: str, blob: bytes) -> DropOutcome:
        """Покласти конверт у скриньку.

        Форму перевіряємо ТУТ, до мережі: 400 від сервера коштує запиту з
        ліміту 120/хв, а причина в обох випадках наша.
        """
        if not pr.is_tag(tag):
            return Refused(f"адреса не тієї форми: {len(tag)} символів замість {pr.TAG_CHARS}")
        if len(blob) not in pr.BLOB_SIZES:
            return Refused(
                f"конверт завдовжки {len(blob)} Б — не з переліку {pr.BLOB_SIZES}"
            )
        result = await self._post(
            "/relay/drop", {"tag": tag, "blob": base64.b64encode(blob).decode("ascii")}
        )
        if isinstance(result, dict):
            return Held(held_until=str(result.get("held_until", "")))
        return result

    async def fetch(self, tags: Sequence[str]) -> FetchOutcome:
        """Забрати все, що лежить під цими адресами.

        Рівно 64 різних імені — не порада, а умова сервера. Вибірка іншої
        ширини сказала б йому, скільки співрозмовників має цей вузол.
        """
        tags = list(tags)
        if len(tags) != pr.FETCH_TAGS or len(set(tags)) != pr.FETCH_TAGS:
            return Refused(
                f"потрібно рівно {pr.FETCH_TAGS} РІЗНИХ адрес, "
                f"дано {len(tags)} (різних {len(set(tags))})"
            )
        if not all(pr.is_tag(t) for t in tags):
            return Refused("серед адрес є не тієї форми")
        result = await self._post("/relay/fetch", {"tags": tags})
        if not isinstance(result, dict):
            return result
        letters: list[Letter] = []
        for row in result.get("blobs", []):
            try:
                blob = base64.b64decode(row["blob"], validate=True)
            except Exception:
                # Один зіпсований конверт не має валити весь захід: решта
                # листів у цій відповіді чесно доїхала.
                logger.warning("сховок віддав конверт, який не декодується; пропускаю")
                continue
            letters.append(Letter(id=str(row.get("id", "")), tag=str(row.get("tag", "")), blob=blob))
        return Fetched(letters=letters)

    async def burn(self, ids: Sequence[str]) -> BurnOutcome:
        """Спалити забрані копії. Без цього вони лежать до кінця TTL."""
        ids = list(ids)
        if not ids:
            # Порожній список сервер відхилив би 400. Це не стан помилки —
            # просто нема чого палити.
            return Burned(count=0)
        if len(ids) > 256:
            return Refused(f"за раз палиться не більше 256 копій, дано {len(ids)}")
        result = await self._post("/relay/burn", {"ids": ids})
        if isinstance(result, dict):
            return Burned(count=int(result.get("burned", 0)))
        return result


def _detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict) and "detail" in payload:
            return str(payload["detail"])
    except ValueError:
        pass
    return response.text[:200]


__all__ = [
    "Burned",
    "Busy",
    "Fetched",
    "Full",
    "Held",
    "Letter",
    "Offline",
    "Refused",
    "RelayCourier",
]
