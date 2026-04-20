"""
Phase 9.3b — condition DSL evaluator for conditional standing orders.

Intentionally tiny: regex-pattern match against a curated list of metrics.
No real expression parsing — spec forbids it. Unknown conditions raise;
broken-psutil-check conditions evaluate False (fail-safe, don't fire).

Supported forms:
    "cpu_percent > 85"
    "cpu_percent >= 85"
    "disk_free_gb < 10"
    "disk_free_gb <= 10"
    "memory_percent > 80"
    "memory_percent >= 80"
    "hour == 8"
    "hour > 7"
    "hour < 20"
    "concern_count > 3"
    "fatigue > 0.8"
    "fatigue >= 0.8"
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Callable

logger = logging.getLogger(__name__)


_PATTERN = re.compile(
    r"^\s*(?P<metric>[a-z_]+)\s*(?P<op>==|>=|<=|>|<)\s*(?P<value>-?\d+(?:\.\d+)?)\s*$"
)


def _cpu_percent() -> float:
    try:
        import psutil
        # interval=0.1 — quick, lightweight; the long probe interval (whole
        # runner pulse is >10s) makes precision less important than speed.
        return float(psutil.cpu_percent(interval=0.1))
    except Exception as exc:
        logger.debug("psutil.cpu_percent failed: %s", exc)
        raise


def _disk_free_gb() -> float:
    try:
        import psutil
        return float(psutil.disk_usage("/").free) / 1e9
    except Exception as exc:
        logger.debug("psutil.disk_usage failed: %s", exc)
        raise


def _memory_percent() -> float:
    try:
        import psutil
        return float(psutil.virtual_memory().percent)
    except Exception as exc:
        logger.debug("psutil.virtual_memory failed: %s", exc)
        raise


def _hour() -> float:
    return float(datetime.now(tz=timezone.utc).hour)


def _concern_count() -> float:
    from agent.runtime import agent_runtime
    slot = agent_runtime.foreground_slot
    if slot is None:
        return 0.0
    return float(len(slot.self_model.active_concerns))


def _fatigue() -> float:
    from agent.runtime import agent_runtime
    slot = agent_runtime.foreground_slot
    if slot is None:
        return 0.0
    return float(slot.self_model.emotion.fatigue)


KNOWN_CONDITIONS: dict[str, Callable[[], float]] = {
    "cpu_percent": _cpu_percent,
    "disk_free_gb": _disk_free_gb,
    "memory_percent": _memory_percent,
    "hour": _hour,
    "concern_count": _concern_count,
    "fatigue": _fatigue,
}


_OPS: dict[str, Callable[[float, float], bool]] = {
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
}


async def evaluate_condition(expr: str) -> bool:
    """
    Parse + evaluate a condition string. Returns True when the condition
    holds, False otherwise. Broken metric calls return False (fail-safe).
    Raises ValueError for unknown metrics or malformed expressions so
    storage-time validation can reject them early.
    """
    m = _PATTERN.match(expr or "")
    if m is None:
        raise ValueError(f"malformed condition: {expr!r}")
    metric = m.group("metric")
    op = m.group("op")
    try:
        value = float(m.group("value"))
    except ValueError:
        raise ValueError(f"invalid numeric literal in condition: {expr!r}")
    if metric not in KNOWN_CONDITIONS:
        raise ValueError(
            f"unknown metric {metric!r}; supported: {sorted(KNOWN_CONDITIONS)}"
        )
    fn = KNOWN_CONDITIONS[metric]
    try:
        current = fn()
    except Exception as exc:
        logger.warning("condition metric %s evaluation failed: %s", metric, exc)
        return False  # fail-safe
    try:
        return _OPS[op](current, value)
    except KeyError:
        raise ValueError(f"unknown operator {op!r} in condition {expr!r}")


__all__ = ["evaluate_condition", "KNOWN_CONDITIONS"]
