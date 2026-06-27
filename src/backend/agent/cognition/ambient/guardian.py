"""Ambient guardian — evaluate the world-snapshot against care rules, debounced.

Pure core (`AmbientGuardian.scan`) is fully unit-testable with synthetic
snapshots. The async ticker (`run`) reads the live ContextEngine snapshot,
surfaces fired alerts to the user via the consciousness stream, and broadcasts
them for the UI. No LLM, no I/O in the hot path — cheap enough to run beside the
will, proactive, and consciousness loops on weak hardware.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# A rule's check sees the current snapshot and the previous one (for trends).
RuleCheck = Callable[[dict, Optional[dict]], Optional[str]]


@dataclass
class AmbientAlert:
    rule_id: str
    category: str          # health | environment | system | wellbeing
    severity: int          # 1 (gentle) .. 10 (urgent)
    message: str           # what to tell the user, ready to surface


@dataclass
class AmbientRule:
    id: str
    category: str
    severity: int
    cooldown_s: float
    check: RuleCheck
    enabled: bool = True


@dataclass
class AmbientGuardian:
    rules: list[AmbientRule] = field(default_factory=list)
    _last_fired: dict[str, float] = field(default_factory=dict)
    _prev: Optional[dict] = None

    def scan(self, snapshot: dict, *, now: Optional[float] = None) -> list[AmbientAlert]:
        """Evaluate every enabled rule against the snapshot. Returns the alerts
        that fired and are past their per-rule cooldown. Deterministic given
        ``now``; mutates only the debounce ledger + previous-snapshot memory."""
        t = now if now is not None else time.time()
        fired: list[AmbientAlert] = []
        for rule in self.rules:
            if not rule.enabled:
                continue
            try:
                message = rule.check(snapshot, self._prev)
            except Exception as exc:  # a broken rule must never break the scan
                logger.debug("ambient rule %s raised: %s", rule.id, exc)
                continue
            if not message:
                continue
            if t - self._last_fired.get(rule.id, -1e18) < rule.cooldown_s:
                continue
            self._last_fired[rule.id] = t
            fired.append(AmbientAlert(rule.id, rule.category, rule.severity, message))
        self._prev = snapshot
        return fired

    # ── async ticker (singleton lifecycle) ──────────────────────────────────
    def __post_init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._last_aqi_fetch: float = -1e18

    def ensure_rules(self) -> None:
        if not self.rules:
            from agent.cognition.ambient.rules import default_rules
            self.rules = default_rules()

    def start(self) -> None:
        from config import config
        if not getattr(config, "ambient_guardian_enabled", True):
            return
        if self._task is not None and not self._task.done():
            return
        self.ensure_rules()
        self._stop.clear()
        self._task = asyncio.create_task(self.run(), name="ambient_guardian")
        logger.info("AmbientGuardian started (%d rules)", len(self.rules))

    def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def run(self) -> None:
        from config import config
        from core.context_engine import context_engine
        while not self._stop.is_set():
            interval = float(getattr(config, "ambient_guardian_interval_s", 60) or 60)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
                break
            except asyncio.TimeoutError:
                pass
            if not getattr(config, "ambient_guardian_enabled", True):
                continue
            try:
                snapshot = context_engine.get_snapshot()
                await self._enrich_env(snapshot)
                for alert in self.scan(snapshot):
                    await self._surface(snapshot, alert)
            except Exception as exc:
                logger.debug("ambient guardian tick error: %s", exc)

    async def _enrich_env(self, snapshot: dict) -> None:
        """Best-effort: when the user has a location fix, fetch live air quality
        (keyless Open-Meteo) so the air-quality rule has real data even without
        a hardware air sensor. Refreshed slowly — air quality drifts gradually."""
        from config import config
        refresh = float(getattr(config, "ambient_aqi_refresh_s", 1800) or 1800)
        now = time.time()
        if now - self._last_aqi_fetch < refresh:
            return
        where = snapshot.get("where") or {}
        lat, lon = where.get("lat"), where.get("lon")
        if lat is None or lon is None:
            return
        self._last_aqi_fetch = now
        try:
            from geo.sources.environmental import EnvironmentalAdapter
            aqi = await EnvironmentalAdapter().fetch_us_aqi(lat, lon)
            if aqi is not None:
                from core.context_engine import context_engine
                context_engine.set_env_aqi(aqi)
                snapshot.setdefault("env", {})["aqi"] = aqi
        except Exception as exc:
            logger.debug("ambient env enrich failed: %s", exc)

    async def _surface(self, snapshot: dict, alert: AmbientAlert) -> None:
        """Tell the user: weave into the next conversation turn (consciousness
        stream) and broadcast a live event for the UI. Best-effort each."""
        user_id = (snapshot.get("who") or {}).get("user_id")
        if user_id:
            try:
                from agent.consciousness_stream import consciousness_stream
                consciousness_stream.push_insight(user_id, alert.message)
            except Exception as exc:
                logger.debug("ambient surface→consciousness failed: %s", exc)
        try:
            from api.websocket_hub import hub
            await hub.broadcast("agent.stream", "ambient.alert", {
                "rule": alert.rule_id, "category": alert.category,
                "severity": alert.severity, "message": alert.message,
            })
        except Exception as exc:
            logger.debug("ambient surface→broadcast failed: %s", exc)


ambient_guardian = AmbientGuardian()
