"""Глушник телеметрії Chroma — бо жоден штатний важіль її не спиняє.

Виміряно 29.08.2026 на зібраному AppImage у порожньому оточенні.

Код бекенда робить усе правильно: кожен `PersistentClient` відкривається з
`Settings(anonymized_telemetry=False)`, і на це стоїть тест, який обходить
AST і валиться на будь-якому конструкторі без `settings=`. І все одно в
журналі чистого прогону, двічі:

    chromadb.telemetry.product.posthog: Failed to send telemetry event
    ClientStartEvent: capture() takes 1 positional argument but 3 were given

Перевірив ОБИДВА штатні шляхи, по черзі й разом:

    ANONYMIZED_TELEMETRY=False   → `Settings().anonymized_telemetry` = False
    CHROMA_TELEMETRY_IMPL=…      → `Settings().chroma_telemetry_impl` = наш клас

Обидва приймаються, і жоден не допомагає: chromadb 0.5.5 однаково піднімає
`Posthog` і однаково пробує відправити `ClientStartEvent`. Подія не пішла
тільки тому, що в самої бібліотеки розійшлась сигнатура виклику posthog.
Заслін, який тримається на чужому баґу, — не заслін: полагодять сигнатуру
при оновленні, і дані поїдуть з машини користувача мовчки.

Тому єдине, що справді працює, — прибрати сам метод. Це латка чужого
пакета, і вона тут навмисно видима: окремий файл, назва без евфемізмів,
виклик один і на видноті (`_phantom_entry._bootstrap_env`). Перевірено —
після виклику `silence()` жодного рядка телеметрії в журналі немає.

Побічно це прибирає ще одне, видиме лише в сирцях бази:
`ProductTelemetryClient.USER_ID_PATH` кладе постійний ідентифікатор
користувача у `~/.cache/chroma/telemetry_user_id`.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def silence() -> bool:
    """Знешкодити `Posthog.capture`. Повертає True, якщо латка лягла.

    Кликати ДО створення першого клієнта Chroma — інакше подія старту вже
    полетить. Не піднімає винятків: якщо структура пакета зміниться,
    застосунок має стартувати, але про це треба почути.
    """
    try:
        from chromadb.telemetry.product.posthog import Posthog
    except Exception as exc:  # noqa: BLE001 — пакет міг переїхати
        logger.warning(
            "Телеметрію Chroma не вдалось знешкодити (%s) — "
            "перевір, чи вона не почала відправлятись.", type(exc).__name__,
        )
        return False

    Posthog.capture = lambda self, *args, **kwargs: None  # type: ignore[method-assign]
    return True
