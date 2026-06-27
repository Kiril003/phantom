"""
Fundamental drives system (Will Engine v1).
Curiosity, Mastery, Autonomy, Relatedness, Achievement, Security, Beauty.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy import select

from db.database import get_session
from db.models import DriveState
from ai.sentience.endocrine import endocrine_system

logger = logging.getLogger(__name__)


class Drive(BaseModel):
    name: str
    current_level: float = Field(0.5, ge=0.0, le=1.0)
    baseline: float = 0.5
    decay_rate: float = 0.01  # natural decrease toward baseline per tick
    pressure_rate: float = 0.01  # natural increase when not satisfied
    last_satisfied_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))

    def pressure(self) -> float:
        """The 'hunger' for this drive. 1.0 = high need, 0.0 = satisfied."""
        return 1.0 - self.current_level


class DriveSystem:
    """Manages the 7 fundamental drives of PHANTOM."""

    DRIVE_NAMES = [
        "curiosity", "mastery", "autonomy", "relatedness",
        "achievement", "security", "beauty"
    ]

    def __init__(self) -> None:
        self.drives: dict[str, Drive] = {
            name: Drive(name=name) for name in self.DRIVE_NAMES
        }
        self._last_tick: Optional[datetime] = None

    async def load(self) -> None:
        """Load drive states from database."""
        try:
            async with get_session() as db:
                result = await db.execute(select(DriveState))
                rows = result.scalars().all()
                for row in rows:
                    if row.name in self.drives:
                        self.drives[row.name].current_level = row.current_level
                        self.drives[row.name].baseline = row.baseline
                        self.drives[row.name].decay_rate = row.decay_rate
                        self.drives[row.name].pressure_rate = row.pressure_rate
                        self.drives[row.name].last_satisfied_at = row.last_satisfied_at.replace(tzinfo=timezone.utc)
        except Exception as exc:
            logger.warning("DriveSystem.load failed: %s", exc)

    async def save(self) -> None:
        """Persist drive states to database."""
        try:
            async with get_session() as db:
                for name, drive in self.drives.items():
                    result = await db.execute(
                        select(DriveState).where(DriveState.name == name)
                    )
                    row = result.scalar_one_or_none()
                    if not row:
                        row = DriveState(name=name)
                        db.add(row)
                    
                    row.current_level = drive.current_level
                    row.baseline = drive.baseline
                    row.decay_rate = drive.decay_rate
                    row.pressure_rate = drive.pressure_rate
                    row.last_satisfied_at = drive.last_satisfied_at
                await db.commit()
        except Exception as exc:
            logger.warning("DriveSystem.save failed: %s", exc)

    def tick(self) -> None:
        """Update drive levels based on time and endocrine state."""
        now = datetime.now(tz=timezone.utc)
        if self._last_tick is None:
            self._last_tick = now
            return

        delta_s = (now - self._last_tick).total_seconds()
        self._last_tick = now

        # Use hormones to modulate rates
        h = endocrine_system.state
        
        # Mapping hormones to drive modulation
        # Dopamine increases most drives (engagement)
        # Oxytocin increases relatedness
        # Cortisol increases security focus (by increasing its pressure rate)
        
        for name, drive in self.drives.items():
            # 1. Natural drift toward baseline
            drift = (drive.baseline - drive.current_level) * (drive.decay_rate * delta_s / 3600.0)
            drive.current_level += drift
            
            # 2. Pressure build-up (hunger increases over time)
            pressure_inc = drive.pressure_rate * (delta_s / 3600.0)
            
            # 3. Hormonal modulation
            if name == "curiosity":
                pressure_inc *= (1.0 + h.dopamine)
            elif name == "relatedness":
                pressure_inc *= (1.0 + h.oxytocin)
            elif name == "security":
                pressure_inc *= (1.0 + h.cortisol)
            elif name in ("mastery", "achievement", "autonomy", "beauty"):
                pressure_inc *= (1.0 + h.dopamine * 0.5)

            # Apply pressure (which actually decreases the 'satisfied' level)
            # Actually, specify: current_level is satisfaction. Higher = more satisfied.
            # So pressure build-up means current_level decreases.
            drive.current_level = max(0.0, min(1.0, drive.current_level - pressure_inc))

    def dominant(self) -> Drive:
        """Return the drive with the highest pressure."""
        return max(self.drives.values(), key=lambda d: d.pressure())

    def satisfy(self, name: str, amount: float = 0.1) -> None:
        """Increase satisfaction for a specific drive."""
        if name in self.drives:
            drive = self.drives[name]
            drive.current_level = max(0.0, min(1.0, drive.current_level + amount))
            drive.last_satisfied_at = datetime.now(tz=timezone.utc)

    async def reward(self, satisfactions: dict[str, float]) -> None:
        """Satisfy one or more drives at once and persist the result.

        Closes the will loop: when PHANTOM completes a goal it set itself,
        the drives that goal served lose pressure — and the change survives a
        restart, so motivation actually moves as the will acts."""
        for name, amount in satisfactions.items():
            self.satisfy(name, amount)
        await self.save()


# Singleton
drive_system = DriveSystem()
