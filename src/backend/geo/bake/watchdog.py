"""Самозупинка за памʼяттю. Дві сторожі, бо однієї структурно замало.

ЧОМУ 5 СЕКУНД, А НЕ 10, ЯК У СКРИПТІ. Демон oom-guard на цій машині має гілку
по PSI: він стріляє, коли `some avg10` перевищує 25 при RAM під 30%. `avg10` —
це вікно в 10 секунд, тож 30 секунд під межею (три страйки по 10) уже лежать
ВСЕРЕДИНІ його тригера: він вистрелить перший, а вистрелить він по імені, і
першим у списку PREFER стоїть `uvicorn` — тобто загине сервер, а не випікання.
Три страйки по 5 секунд дають 15-секундне вікно, яке ще встигає закінчитись
нашим чистим SIGTERM.

ЧОМУ ПІДЛОГА 15%, А НЕ НИЖЧЕ. У oom-guard власна межа 12%. Ставити нашу нижче
означає віддати рішення йому — а він не вміє ні закрити SQLite, ні прибрати
.db.part, ні сказати людині, ЧОМУ спинилось.

ЧОМУ ДВІ СТОРОЖІ. Батько опитує раз на 5 с — тобто він завжди на 5 секунд
пізно, і поки worker сидить у C++ всередині pyosmium, він не питає нічого. Тому
всередині worker'а є ще й кооперативна перевірка на кожному зливі партії
(5 000 рядків): вона встигає закрити базу чисто й вийти кодом 75 сама.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

EXIT_SELF_STOPPED = 75
DEFAULT_FLOOR_PCT = 30.0
ABSOLUTE_MIN_FLOOR_PCT = 15.0
POLL_INTERVAL_S = 5.0
STRIKES_TO_TRIP = 3
TERM_GRACE_S = 5.0

MemReader = Callable[[], tuple[int, int]]


class LowMemory(RuntimeError):
    """Кооперативна зупинка: памʼяті менше за підлогу."""


def read_meminfo() -> tuple[int, int]:
    """(MemTotal, MemAvailable) у кБ. Кидає OSError, якщо /proc недоступний."""
    total = available = 0
    with open("/proc/meminfo", "r", encoding="ascii") as fh:
        for line in fh:
            if line.startswith("MemTotal:"):
                total = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                available = int(line.split()[1])
                break
    if total <= 0:
        raise OSError("MemTotal нечитабельний")
    return total, available


def available_pct(reader: MemReader = read_meminfo) -> Optional[float]:
    """Відсоток доступної памʼяті, або None, якщо поміряти не вдалось."""
    try:
        total, available = reader()
    except (OSError, ValueError, IndexError):
        return None
    return 100.0 * available / total


def clamp_floor(pct: float) -> float:
    """Підлогу нижче за 15% не приймаємо — нижче вирішує вже не наш код."""
    return max(ABSOLUTE_MIN_FLOOR_PCT, float(pct))


def read_pressure() -> Optional[float]:
    """`some avg10` з /proc/pressure/memory. None — ядро його не дає."""
    try:
        with open("/proc/pressure/memory", "r", encoding="ascii") as fh:
            for line in fh:
                if line.startswith("some "):
                    for part in line.split():
                        if part.startswith("avg10="):
                            return float(part.split("=", 1)[1])
    except (OSError, ValueError):
        return None
    return None


def read_peak_rss(pid: int) -> Optional[int]:
    """VmHWM процесу в байтах — поміряний пік, а не миттєвий RSS."""
    try:
        text = Path(f"/proc/{pid}/status").read_text(encoding="ascii")
    except OSError:
        return None
    for line in text.splitlines():
        if line.startswith("VmHWM:"):
            try:
                return int(line.split()[1]) * 1024
            except (ValueError, IndexError):
                return None
    return None


def cooperative_check(floor_pct: float, reader: MemReader = read_meminfo) -> None:
    """Всередині worker'а, на кожному зливі партії. Кидає [LowMemory]."""
    pct = available_pct(reader)
    if pct is not None and pct < clamp_floor(floor_pct):
        raise LowMemory(f"вільної памʼяті {pct:.1f}%, підлога {clamp_floor(floor_pct):.0f}%")


def memory_state(
    floor_pct: float, reader: MemReader = read_meminfo, poll_s: float = POLL_INTERVAL_S,
) -> dict[str, Any]:
    """Те, що сторожа бачить ЗАРАЗ — до натискання, а не після 900 МБ.

    Проба bake_capability міряє байти (≥ 2 ГіБ для міста — прохід), а сторожа
    стріляє по відсотку: машина з 2,8 ГіБ вільними з 16 проходить пробу й гине
    на першому зливі партії. Заміряно 05.09: 17,8 % проти підлоги 30 %.
    Ця функція каже рівно те, що сказала б сторожа, — тим самим читачем.
    """
    pct = available_pct(reader)
    floor = clamp_floor(floor_pct)
    return {"ram_available_pct": pct, "floor_pct": floor, "strikes_to_trip": STRIKES_TO_TRIP,
            "poll_s": poll_s, "measured": pct is not None,
            "would_stop": pct is not None and pct < floor, "psi_some_avg10": read_pressure()}


class MemoryWatchdog:
    """Батьківська сторожа: 3 страйки поспіль -> SIGTERM, 5 с, SIGKILL."""

    def __init__(
        self, *, floor_pct: float = DEFAULT_FLOOR_PCT,
        reader: MemReader = read_meminfo, interval_s: float = POLL_INTERVAL_S,
    ) -> None:
        self.floor_pct = clamp_floor(floor_pct)
        self._reader = reader
        self._interval = interval_s
        self.strikes = 0
        self.tripped = False
        self.peak_rss_bytes: Optional[int] = None
        self.last_pct: Optional[float] = None

    def observe(self, pct: Optional[float]) -> bool:
        """Чистий крок: True == пора стріляти. None (не поміряли) не карає."""
        self.last_pct = pct
        if pct is None:
            return False
        self.strikes = self.strikes + 1 if pct < self.floor_pct else 0
        return self.strikes >= STRIKES_TO_TRIP

    async def guard(self, proc: "asyncio.subprocess.Process") -> bool:
        """Стежити, доки процес живий. True — ми його спинили."""
        while proc.returncode is None:
            try:
                await asyncio.wait_for(proc.wait(), timeout=self._interval)
                break
            except asyncio.TimeoutError:
                pass
            peak = read_peak_rss(proc.pid)
            if peak is not None:
                self.peak_rss_bytes = max(self.peak_rss_bytes or 0, peak)
            if self.observe(available_pct(self._reader)):
                self.tripped = True
                logger.warning(
                    "випікання спиняється: RAM %.1f%% < %.0f%%, PSI some avg10=%s",
                    self.last_pct or -1.0, self.floor_pct, read_pressure(),
                )
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=TERM_GRACE_S)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                return True
        return False
