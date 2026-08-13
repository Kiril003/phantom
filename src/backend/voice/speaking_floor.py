"""Хто зараз говорить — і один важіль, щоб його спинити.

Кожен шлях, який кладе звук в ефір із власної волі PHANTOM, реєструється тут:
і відповідь у чаті, і проактивна репліка агента (`agent/actions/voice_say.py`)
йдуть через `SentenceSpeaker`. Раніше їх було двоє й вони не знали один про
одного — перехоплення спиняло того, кого ніхто не слухав, поки другий
договорював поверх людини.

Реєстр тримає ще й ТЕКСТ щойно озвученого. Скасувати ехо в сигналі ми не
можемо, але точно знаємо, що зараз лунає з динаміка, — і саме це дозволяє
відрізнити власний голос від людського (voice/self_echo.py).

Чого тут немає: озвучка, яку замовляє сам клієнт (`POST /voice/tts`,
ChatWindow як запасний шлях для цілої відповіді). Її сервер не починав і не
знає, коли вона грає, тож і важеля над нею не має — спиняти її мусить той,
хто її запустив.
"""
from __future__ import annotations

import logging
from collections import deque
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)

#: Скільки останніх речень тримати як «те, що зараз у повітрі».
RECENT_SENTENCES = 8

StopFn = Callable[[str], Awaitable[None]]


class _Voice:
    __slots__ = ("stop", "spoken")

    def __init__(self, stop: StopFn) -> None:
        self.stop = stop
        self.spoken: deque[str] = deque(maxlen=RECENT_SENTENCES)


class SpeakingFloor:
    def __init__(self) -> None:
        self._voices: dict[str, dict[object, _Voice]] = {}
        self._last_line: dict[str, str] = {}

    def open(self, user_id: str, key: object, stop: StopFn) -> None:
        self._voices.setdefault(user_id, {})[key] = _Voice(stop)

    def note(self, user_id: str, key: object, text: str) -> None:
        line = (text or "").strip()
        if not line:
            return
        voice = self._voices.get(user_id, {}).get(key)
        if voice is not None:
            voice.spoken.append(line)
        self._last_line[user_id] = line

    def close(self, user_id: str, key: object) -> None:
        voices = self._voices.get(user_id)
        if not voices:
            return
        voices.pop(key, None)
        if not voices:
            self._voices.pop(user_id, None)

    def is_speaking(self, user_id: str) -> bool:
        return bool(self._voices.get(user_id))

    def recent(self, user_id: str) -> list[str]:
        out: list[str] = []
        for voice in self._voices.get(user_id, {}).values():
            out.extend(voice.spoken)
        return out

    def last_was_question(self, user_id: str) -> bool:
        return self._last_line.get(user_id, "").rstrip().endswith("?")

    async def stop(self, user_id: str, reason: str) -> None:
        """Спиняє всі голоси користувача. Реєстр звільняється ПЕРЕД викликами,
        тож жоден зупинювач, що не впорався, не лишає користувача «мовцем»
        назавжди."""
        voices = self._voices.pop(user_id, None)
        if not voices:
            return
        for voice in list(voices.values()):
            try:
                await voice.stop(reason)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "speaking floor: stop(%s) failed: %s", reason, exc
                )


class UserFloor:
    """Реєстр, звужений до одного користувача — рівно те, що бачить оркестратор."""

    def __init__(self, floor: SpeakingFloor, user_id: str) -> None:
        self._floor = floor
        self._user_id = user_id

    def is_speaking(self) -> bool:
        return self._floor.is_speaking(self._user_id)

    def recent(self) -> list[str]:
        return self._floor.recent(self._user_id)

    def last_was_question(self) -> bool:
        return self._floor.last_was_question(self._user_id)

    async def stop(self, reason: str) -> None:
        await self._floor.stop(self._user_id, reason)


speaking_floor = SpeakingFloor()


__all__ = [
    "RECENT_SENTENCES",
    "SpeakingFloor",
    "UserFloor",
    "speaking_floor",
]
