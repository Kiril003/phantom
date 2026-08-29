"""Темп розсилання у сховок: скільки листів можна віддати просто зараз.

Навіщо окремий модуль, а не `for lst in outbox: courier.drop(...)`.

Сервер тримає 120 запитів за 60 с НА IP-АДРЕСУ
(platform-site/server/main.py:134, RELAY_RATE_LIMIT/WINDOW). Захід за листами
коштує ОДИН запит на будь-яку кількість скриньок — 64 адреси їдуть одним
`fetch`. А розсилання коштує один запит НА ЛИСТ. Тобто вузьке місце — не
читання, а письмо, і воно тим гостріше, чим довше вузол був офлайн.

Найгірший випадок, порахований, а не на око (при `DEFAULT_SENDS_PER_MINUTE`):
    30 листів  →  1 хв
    120 листів →  4 хв
    600 листів → 20 хв
    3600 листів → 2 год
Формула — `minutes_to_drain()` нижче, і на неї є тест: число в коментарі, яке
ніхто не перевіряє, застаріває першим.

Чому дефолт 30/хв, а не 120. Дві причини, обидві незручні:
  * ліміт рахується НА IP, а телефон і ПК за одним NAT — це одна IP. Забравши
    всі 120, ПК заглушив би телефон власника рівно тоді, коли обидва вийшли
    на зв'язок після офлайну;
  * та сама IP несе ще й `fetch` кожного заходу і `burn` після нього. Стеля,
    вибрана під зав'язку, лишає нулю місця на читання — вузол слав би й не
    отримував.
Тому чверть стелі на розсилання і три чверті лишаємо іншим. Число в конфігу:
хто знає свою мережу краще — підніме.

Головне правило, спільне з `relay_courier.py`: лист, який ЧЕКАЄ, ніколи не
показується як надісланий. `Wait` — це стан із причиною і строком, а не None.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Union

#: Стеля сервера, для довідки й перевірок. Не наш робочий темп.
SERVER_LIMIT_PER_MINUTE = 120
SERVER_WINDOW_S = 60.0

#: Наш темп. Чверть стелі — решта сусідам за тією ж IP і власним fetch/burn.
DEFAULT_SENDS_PER_MINUTE = 30


@dataclass(frozen=True)
class Go:
    """Можна віддавати. `allowance` — скільки саме, не більше."""

    allowance: int


@dataclass(frozen=True)
class Wait:
    """Не можна. Із причиною і строком — щоб людині було що показати.

    `reason` призначений для UI і навмисно людський: «черга йде, лишилось N»
    читабельніше за «rate limited».
    """

    seconds: float
    reason: str


Verdict = Union[Go, Wait]


@dataclass
class RelayPacer:
    """Ковзне вікно відправлень. Стану про листи не тримає — лише про темп.

    Свідомо не має ні черги, ні таймера: черга — це стан, і два джерела правди
    про те, чи лист поїхав, у цьому домі вже коштували дорого. Тут лише
    відповідь на питання «скільки можна просто зараз».
    """

    sends_per_minute: int = DEFAULT_SENDS_PER_MINUTE
    _sent_at: Deque[float] = field(default_factory=deque, repr=False)

    def __post_init__(self) -> None:
        if self.sends_per_minute < 1:
            raise ValueError("темп мусить бути хоча б 1 лист за хвилину")
        if self.sends_per_minute > SERVER_LIMIT_PER_MINUTE:
            raise ValueError(
                f"темп {self.sends_per_minute}/хв вище за стелю сервера "
                f"{SERVER_LIMIT_PER_MINUTE}/хв — сервер відповість 429, "
                "і кожен такий запит з'їсть спробу дарма"
            )

    def _forget_old(self, now: float) -> None:
        while self._sent_at and now - self._sent_at[0] >= SERVER_WINDOW_S:
            self._sent_at.popleft()

    def check(self, now: float, pending: int = 0) -> Verdict:
        """Скільки листів можна віддати цієї миті."""
        self._forget_old(now)
        free = self.sends_per_minute - len(self._sent_at)
        if free > 0:
            return Go(allowance=free)
        # Вікно повне: чекаємо, поки найстаріше відправлення з нього випаде.
        wait = SERVER_WINDOW_S - (now - self._sent_at[0])
        left = f", лишилось {pending}" if pending else ""
        return Wait(
            seconds=max(wait, 0.0),
            reason=f"черга йде своїм темпом{left}",
        )

    def note_sent(self, now: float, count: int = 1) -> None:
        """Відзначити фактично зроблені відправлення.

        Викликається ПІСЛЯ того, як `drop` повернув відповідь, — і на будь-яку
        відповідь, включно з `Full` і `Refused`. Запит витрачено незалежно від
        того, чи лист ліг: сервер порахував його у своєму вікні, і вдавати, що
        його не було, означає впертись у 429 на рівному місці.
        """
        for _ in range(max(count, 0)):
            self._sent_at.append(now)

    def note_server_said_busy(self, now: float) -> None:
        """Сервер відповів 429 — отже наш облік розійшовся з його.

        Таке буває чесно: за тією самою IP шле ще хтось (телефон власника).
        Тоді наше вікно вважаємо повним, не вгадуючи чуже: далі `check` сам
        видасть `Wait` рівно доти, доки найстаріше не випаде.
        """
        self._forget_old(now)
        while len(self._sent_at) < self.sends_per_minute:
            self._sent_at.append(now)

    def minutes_to_drain(self, pending: int) -> float:
        """Скільки хвилин займе розсилання `pending` листів у цьому темпі.

        Це те число, яке варто показувати людині замість витких «синхронізую».
        """
        if pending <= 0:
            return 0.0
        return pending / self.sends_per_minute

    def human_eta(self, pending: int) -> str:
        """Той самий строк словами. Округлення ВГОРУ: обіцяти менше, ніж вийде,
        гірше, ніж обіцяти більше."""
        if pending <= 0:
            return "черга порожня"
        minutes = math.ceil(self.minutes_to_drain(pending))
        if minutes < 60:
            return f"близько {minutes} хв"
        hours = minutes / 60
        return f"близько {hours:.1f} год".replace(".0 ", " ")


__all__ = [
    "DEFAULT_SENDS_PER_MINUTE",
    "SERVER_LIMIT_PER_MINUTE",
    "SERVER_WINDOW_S",
    "Go",
    "RelayPacer",
    "Verdict",
    "Wait",
]
