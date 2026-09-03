"""
Serial Bridge — pyserial-asyncio ESP32 ↔ Radxa.
Reads JSON lines at 921600 baud, writes command JSON lines.
Reconnects automatically on disconnect, tracks heartbeat timeout.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable, Awaitable

import serial_asyncio  # type: ignore[import-untyped]

from config import config
from sensors.sensor_parser import SensorParser, SensorBatch, HeartbeatMessage, ErrorMessage, ParsedMessage
from sensors.command_sender import command_sender

logger = logging.getLogger(__name__)

BatchCallback = Callable[[SensorBatch], Awaitable[None]]
HeartbeatCallback = Callable[[HeartbeatMessage], Awaitable[None]]
ErrorCallback = Callable[[ErrorMessage], Awaitable[None]]

HEARTBEAT_TIMEOUT_S = 10.0   # alert if no heartbeat for 10s
RECONNECT_DELAY_S = 3.0
# ESP32 — аксесуар ОПЦІЙНИЙ, тобто «його немає» це не аварія, а звичайний
# стан більшості машин. Доти доки цикл повторював спробу кожні 3 с і кричав
# logger.error щоразу, він давав 60 рядків зі 100 за пʼять хвилин і ховав
# справжні помилки в шумі про власну норму. Відступ росте вдвічі й
# упирається в пʼять хвилин: відсутній аксесуар коштує майже нічого, а
# ввімкнений у розетку помічається так само швидко, як і раніше.
RECONNECT_MAX_DELAY_S = 300.0
MAX_LINE_BYTES = 8192


def retry_delay_for(failures: int) -> float:
    """Скільки чекати перед спробою номер `failures`+1.

    Окремою функцією, бо саме її перевіряє сторож: інакше «відступ росте»
    довелося б доводити, чекаючи хвилинами в тесті.
    """
    if failures <= 0:
        return RECONNECT_DELAY_S
    return min(RECONNECT_DELAY_S * (2 ** (failures - 1)), RECONNECT_MAX_DELAY_S)


class SerialBridge:
    """
    Manages the serial connection to ESP32.
    Callbacks are invoked on the event loop when messages arrive.
    """

    def __init__(self) -> None:
        self._parser = SensorParser()
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._running = False
        self._connected = False
        self._last_heartbeat = 0.0
        self._reconnect_task: asyncio.Task | None = None
        # Скільки разів підряд не вдалося підключитись, і чому востаннє.
        # Потрібні обидва: перше задає відступ, друге — те, що можна
        # ПОКАЗАТИ замість крику в лозі.
        self._failures = 0
        self._last_error: str | None = None
        self._read_task: asyncio.Task | None = None
        self._watchdog_task: asyncio.Task | None = None

        self._on_batch: list[BatchCallback] = []
        self._on_heartbeat: list[HeartbeatCallback] = []
        self._on_error: list[ErrorCallback] = []
        self._on_disconnect: list[Callable[[], None]] = []

    # ── Public API ─────────────────────────────────────────────────────────────

    def on_batch(self, cb: BatchCallback) -> None:
        self._on_batch.append(cb)

    def on_heartbeat(self, cb: HeartbeatCallback) -> None:
        self._on_heartbeat.append(cb)

    def on_error(self, cb: ErrorCallback) -> None:
        self._on_error.append(cb)

    def on_disconnect(self, cb: Callable[[], None]) -> None:
        self._on_disconnect.append(cb)

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def accessory_state(self) -> dict:
        """Стан аксесуара словами — щоб «його немає» жило в СТАНІ, а не в
        потоці помилок.

        ESP32 опційний, тож `not connected` — це не збій, і поводитись із
        ним як зі збоєм означає щохвилини ховати справжні помилки під
        рядками про власну норму.
        """
        if self._connected:
            return {"state": "connected", "attempts": 0, "detail": None}
        if not self._running:
            return {"state": "off", "attempts": 0, "detail": None}
        return {
            "state": "not_connected",
            "attempts": self._failures,
            "retry_in_s": retry_delay_for(self._failures),
            "detail": self._last_error,
        }

    @property
    def last_heartbeat_ago(self) -> float:
        if self._last_heartbeat == 0.0:
            return float("inf")
        return time.monotonic() - self._last_heartbeat

    async def start(self) -> None:
        """Start the serial bridge — attempts connection, loops on reconnect."""
        self._running = True
        self._watchdog_task = asyncio.create_task(self._watchdog_loop(), name="serial_watchdog")
        await self._connect_loop()

    async def stop(self) -> None:
        """Gracefully stop."""
        self._running = False
        if self._watchdog_task:
            self._watchdog_task.cancel()
        if self._read_task:
            self._read_task.cancel()
        if self._writer:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
        self._connected = False
        logger.info("SerialBridge stopped")

    # ── Connection loop ────────────────────────────────────────────────────────

    async def _connect_loop(self) -> None:
        while self._running:
            try:
                await self._connect()
                self._read_task = asyncio.create_task(self._read_loop(), name="serial_read")
                await self._read_task
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._failures += 1
                self._last_error = f"{type(exc).__name__}: {exc}"
                if self._failures == 1:
                    # Один раз — на повний голос, із поясненням, що це не
                    # обовʼязково поломка.
                    logger.warning(
                        "ESP32 не підключено (%s). Аксесуар опційний — "
                        "повторюю з відступом, що росте; стан видно в "
                        "accessory_state, далі про це мовчу.",
                        self._last_error,
                    )
                else:
                    logger.debug(
                        "SerialBridge connection error #%d: %s",
                        self._failures, exc,
                    )
            finally:
                self._connected = False
                command_sender.set_writer(None)
                for cb in self._on_disconnect:
                    try:
                        cb()
                    except Exception:
                        pass

            if self._running:
                delay = retry_delay_for(self._failures)
                # Той самий рядок кожні 3 с був половиною шуму. Тепер він
                # тільки там, де щось справді змінилось.
                if self._failures <= 1:
                    logger.info("Reconnecting in %.1fs…", delay)
                else:
                    logger.debug("Reconnecting in %.1fs (спроба %d)…", delay, self._failures + 1)
                await asyncio.sleep(delay)

    async def _connect(self) -> None:
        logger.info(
            "Connecting to %s @ %d baud…",
            config.sensor_serial_port,
            config.sensor_serial_baud,
        )
        reader, writer = await serial_asyncio.open_serial_connection(
            url=config.sensor_serial_port,
            baudrate=config.sensor_serial_baud,
        )
        self._reader = reader
        self._writer = writer
        self._connected = True
        self._last_heartbeat = time.monotonic()
        command_sender.set_writer(writer)
        # Скидаємо і лічильник, і відступ: аксесуар, увімкнений у розетку
        # після години тиші, не має чекати наступних пʼяти хвилин, а
        # наступна його втрата мусить знову сказати про себе на повний голос.
        self._failures = 0
        self._last_error = None
        logger.info("ESP32 serial connected")

    # ── Read loop ──────────────────────────────────────────────────────────────

    async def _read_loop(self) -> None:
        assert self._reader is not None
        while self._running and self._connected:
            try:
                line = await asyncio.wait_for(
                    self._reader.readline(),
                    timeout=HEARTBEAT_TIMEOUT_S * 2,
                )
            except asyncio.TimeoutError:
                logger.warning("Serial read timeout — no data for %.0fs", HEARTBEAT_TIMEOUT_S * 2)
                break
            except Exception as exc:
                logger.error("Serial read error: %s", exc)
                break

            if not line:
                break

            raw = line.decode("utf-8", errors="replace").strip()
            if not raw:
                continue

            parsed = self._parser.parse(raw)
            if parsed is None:
                continue

            await self._dispatch(parsed)

    async def _dispatch(self, msg: ParsedMessage) -> None:
        if isinstance(msg, SensorBatch):
            for cb in self._on_batch:
                try:
                    await cb(msg)
                except Exception as exc:
                    logger.error("on_batch callback error: %s", exc)
        elif isinstance(msg, HeartbeatMessage):
            self._last_heartbeat = time.monotonic()
            for cb in self._on_heartbeat:
                try:
                    await cb(msg)
                except Exception as exc:
                    logger.error("on_heartbeat callback error: %s", exc)
        elif isinstance(msg, ErrorMessage):
            logger.warning("ESP32 sensor error [%s] code=%d: %s", msg.sensor, msg.code, msg.msg)
            for cb in self._on_error:
                try:
                    await cb(msg)
                except Exception as exc:
                    logger.error("on_error callback error: %s", exc)

    # ── Watchdog ───────────────────────────────────────────────────────────────

    async def _watchdog_loop(self) -> None:
        """Emit alert if heartbeat missing > HEARTBEAT_TIMEOUT_S."""
        from core.event_bus import event_bus  # avoid circular import at module level

        while self._running:
            await asyncio.sleep(5.0)
            if self._connected and self.last_heartbeat_ago > HEARTBEAT_TIMEOUT_S:
                logger.warning("ESP32 heartbeat missing for %.1fs", self.last_heartbeat_ago)
                event_bus.emit("esp32_disconnected", {"ago_s": self.last_heartbeat_ago})


# Singleton
serial_bridge = SerialBridge()
