"""KeyVault — many API keys per provider, transparent rotation on quota.

Keys live encrypted (Fernet via security.crypto) in `managed_keys`.
acquire() hands out the best live key; report() drives the state machine:
  ok         → meters tick
  429/quota  → cooling with exponential backoff, next key by priority
  auth_fail  → invalid (operator must replace)
  5xx        → failure count, cooling after a burst
Rolling 1m/1h/24h windows are kept in memory for the ШТАБ reactor panel;
lifetime totals persist in SQLite.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select

from db.database import get_session
from db.models import ManagedKeyRow
from security.crypto import decrypt_pii, encrypt_pii

logger = logging.getLogger(__name__)

Outcome = str  # ok | rate_limited | quota | auth_fail | server_error

_BASE_COOLDOWN_S = 30.0
_MAX_COOLDOWN_S = 3600.0
_SERVER_ERROR_BURST = 3


@dataclass
class _Meter:
    events: list[tuple[float, int]] = field(default_factory=list)  # (ts, tokens)
    failures: list[float] = field(default_factory=list)

    def tick(self, tokens: int) -> None:
        now = time.time()
        self.events.append((now, tokens))
        self._trim(now)

    def fail(self) -> None:
        now = time.time()
        self.failures.append(now)
        self._trim(now)

    def _trim(self, now: float) -> None:
        cutoff = now - 86400
        self.events = [e for e in self.events if e[0] >= cutoff]
        self.failures = [f for f in self.failures if f >= cutoff]

    def window(self, seconds: float) -> tuple[int, int]:
        cutoff = time.time() - seconds
        hits = [e for e in self.events if e[0] >= cutoff]
        return len(hits), sum(t for _, t in hits)

    def failures_24h(self) -> int:
        return len(self.failures)


@dataclass
class LeasedKey:
    id: str
    provider: str
    label: str
    secret: str


class KeyVault:
    def __init__(self) -> None:
        self._meters: dict[str, _Meter] = {}
        self._cooldowns: dict[str, float] = {}  # key_id -> consecutive cools

    # ── CRUD ────────────────────────────────────────────────────────────

    async def add_key(
        self, *, provider: str, label: str, secret: str, priority: int = 100
    ) -> str:
        key_id = uuid.uuid4().hex[:12]
        row = ManagedKeyRow(
            id=key_id,
            provider=provider,
            label=label or f"{provider}-{key_id[:4]}",
            encrypted_key=encrypt_pii(secret),
            key_hint=f"…{secret[-4:]}" if len(secret) >= 4 else "…",
            priority=priority,
        )
        async with get_session() as db:
            db.add(row)
            await db.flush()
        logger.info("keyvault: added %s key %s (%s)", provider, key_id, row.label)
        return key_id

    async def remove_key(self, key_id: str) -> bool:
        async with get_session() as db:
            row = await db.get(ManagedKeyRow, key_id)
            if row is None:
                return False
            await db.delete(row)
            await db.commit()
        self._meters.pop(key_id, None)
        return True

    async def set_state(self, key_id: str, state: str) -> bool:
        async with get_session() as db:
            row = await db.get(ManagedKeyRow, key_id)
            if row is None:
                return False
            row.state = state
            if state == "active":
                row.cooldown_until = None
            await db.commit()
        return True

    async def list_keys(self, provider: str | None = None) -> list[dict]:
        async with get_session() as db:
            stmt = select(ManagedKeyRow).order_by(
                ManagedKeyRow.provider, ManagedKeyRow.priority
            )
            if provider:
                stmt = stmt.where(ManagedKeyRow.provider == provider)
            rows = list((await db.execute(stmt)).scalars().all())
        now = time.time()
        out = []
        for row in rows:
            meter = self._meters.setdefault(row.id, _Meter())
            r1m, _ = meter.window(60)
            r1h, _ = meter.window(3600)
            r24, t24 = meter.window(86400)
            state = row.state
            if state == "cooling" and (row.cooldown_until or 0) <= now:
                state = "active"
            out.append(
                {
                    "id": row.id,
                    "provider": row.provider,
                    "label": row.label,
                    "priority": row.priority,
                    "state": state,
                    "cooldown_until": row.cooldown_until,
                    "key_hint": row.key_hint,
                    "metrics": {
                        "requests_1m": r1m,
                        "requests_1h": r1h,
                        "requests_24h": r24,
                        "tokens_24h": t24,
                        "failures_24h": meter.failures_24h(),
                        "last_used_at": row.last_used_at,
                    },
                }
            )
        return out

    # ── Rotation core ───────────────────────────────────────────────────

    async def acquire(self, provider: str) -> LeasedKey | None:
        """Best live key for provider, by priority. None → caller falls back
        to env-config key or the local Ollama rung."""
        now = time.time()
        async with get_session() as db:
            stmt = (
                select(ManagedKeyRow)
                .where(ManagedKeyRow.provider == provider)
                .order_by(ManagedKeyRow.priority)
            )
            rows = list((await db.execute(stmt)).scalars().all())
            for row in rows:
                if row.state in ("invalid", "disabled"):
                    continue
                if row.state in ("cooling", "exhausted"):
                    if (row.cooldown_until or 0) > now:
                        continue
                    row.state = "active"
                    row.cooldown_until = None
                try:
                    secret = decrypt_pii(row.encrypted_key)
                except Exception:
                    logger.error("keyvault: key %s undecryptable — invalid", row.id)
                    row.state = "invalid"
                    continue
                row.last_used_at = now
                await db.commit()
                return LeasedKey(row.id, row.provider, row.label, secret)
            await db.commit()
        return None

    async def report(
        self, key_id: str, outcome: Outcome, *, tokens: int = 0
    ) -> None:
        meter = self._meters.setdefault(key_id, _Meter())
        async with get_session() as db:
            row = await db.get(ManagedKeyRow, key_id)
            if row is None:
                return
            if outcome == "ok":
                meter.tick(tokens)
                row.requests_total += 1
                row.tokens_total += tokens
                self._cooldowns[key_id] = 0
            elif outcome in ("rate_limited", "quota"):
                meter.fail()
                row.failures_total += 1
                streak = self._cooldowns.get(key_id, 0) + 1
                self._cooldowns[key_id] = streak
                cool = min(_BASE_COOLDOWN_S * (2 ** (streak - 1)), _MAX_COOLDOWN_S)
                if outcome == "quota":
                    cool = max(cool, 900.0)
                    row.state = "exhausted"
                else:
                    row.state = "cooling"
                row.cooldown_until = time.time() + cool
                logger.warning(
                    "keyvault: %s key %s → %s for %.0fs",
                    row.provider, key_id, row.state, cool,
                )
            elif outcome == "auth_fail":
                meter.fail()
                row.failures_total += 1
                row.state = "invalid"
                logger.error("keyvault: key %s invalid (auth)", key_id)
            else:  # server_error
                meter.fail()
                row.failures_total += 1
                if meter.failures_24h() >= _SERVER_ERROR_BURST and len(
                    [f for f in meter.failures if f >= time.time() - 120]
                ) >= _SERVER_ERROR_BURST:
                    row.state = "cooling"
                    row.cooldown_until = time.time() + _BASE_COOLDOWN_S
            await db.commit()


_vault: KeyVault | None = None


def get_vault() -> KeyVault:
    global _vault
    if _vault is None:
        _vault = KeyVault()
    return _vault
