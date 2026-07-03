"""KeyVault — encrypted storage, priority acquire, rotation state machine."""
from __future__ import annotations

import time

import pytest

from ai.keyvault import KeyVault


@pytest.fixture
async def vault():
    from db.database import init_db
    await init_db()
    v = KeyVault()
    created: list[str] = []

    async def _add(**kw) -> str:
        kid = await v.add_key(**kw)
        created.append(kid)
        return kid

    v.add = _add  # type: ignore[attr-defined]
    yield v
    for kid in created:
        await v.remove_key(kid)


@pytest.mark.asyncio
async def test_key_stored_encrypted_and_hinted(vault):
    secret = "sk-test-abcdef123456"
    kid = await vault.add(provider="gemini", label="основний", secret=secret)
    from db.database import get_session
    from db.models import ManagedKeyRow
    async with get_session() as db:
        row = await db.get(ManagedKeyRow, kid)
    assert secret not in row.encrypted_key
    assert row.key_hint == "…3456"
    lease = await vault.acquire("gemini")
    assert lease is not None and lease.secret == secret


@pytest.mark.asyncio
async def test_acquire_respects_priority(vault):
    await vault.add(provider="gemini", label="backup", secret="sk-backup-0001",
                    priority=200)
    await vault.add(provider="gemini", label="main", secret="sk-main-0001",
                    priority=10)
    lease = await vault.acquire("gemini")
    assert lease.label == "main"


@pytest.mark.asyncio
async def test_rate_limit_rotates_to_next_key(vault):
    k1 = await vault.add(provider="gemini", label="k1", secret="sk-k1-000001",
                         priority=1)
    await vault.add(provider="gemini", label="k2", secret="sk-k2-000002",
                    priority=2)
    lease = await vault.acquire("gemini")
    assert lease.id == k1
    await vault.report(k1, "rate_limited")
    lease2 = await vault.acquire("gemini")
    assert lease2.label == "k2"
    keys = {k["label"]: k for k in await vault.list_keys("gemini")}
    assert keys["k1"]["state"] == "cooling"
    assert keys["k1"]["cooldown_until"] > time.time()


@pytest.mark.asyncio
async def test_cooldown_expiry_revives_key(vault):
    k1 = await vault.add(provider="gemini", label="k1", secret="sk-k1-000001",
                         priority=1)
    await vault.report(k1, "rate_limited")
    from db.database import get_session
    from db.models import ManagedKeyRow
    async with get_session() as db:
        row = await db.get(ManagedKeyRow, k1)
        row.cooldown_until = time.time() - 1
        await db.commit()
    lease = await vault.acquire("gemini")
    assert lease is not None and lease.id == k1
    keys = await vault.list_keys("gemini")
    assert keys[0]["state"] == "active"


@pytest.mark.asyncio
async def test_exponential_backoff_grows(vault):
    k1 = await vault.add(provider="gemini", label="k1", secret="sk-k1-000001")
    await vault.report(k1, "rate_limited")
    first = (await vault.list_keys("gemini"))[0]["cooldown_until"]
    await vault.report(k1, "rate_limited")
    second = (await vault.list_keys("gemini"))[0]["cooldown_until"]
    assert second - time.time() > first - time.time()


@pytest.mark.asyncio
async def test_auth_fail_marks_invalid_and_skipped(vault):
    k1 = await vault.add(provider="gemini", label="bad", secret="sk-bad-00001",
                         priority=1)
    await vault.add(provider="gemini", label="good", secret="sk-good-0001",
                    priority=2)
    await vault.report(k1, "auth_fail")
    lease = await vault.acquire("gemini")
    assert lease.label == "good"
    states = {k["label"]: k["state"] for k in await vault.list_keys("gemini")}
    assert states["bad"] == "invalid"


@pytest.mark.asyncio
async def test_quota_exhausted_long_cooldown(vault):
    k1 = await vault.add(provider="gemini", label="k1", secret="sk-k1-000001")
    await vault.report(k1, "quota")
    key = (await vault.list_keys("gemini"))[0]
    assert key["state"] == "exhausted"
    assert key["cooldown_until"] >= time.time() + 800


@pytest.mark.asyncio
async def test_ok_ticks_meters_and_resets_backoff(vault):
    k1 = await vault.add(provider="gemini", label="k1", secret="sk-k1-000001")
    await vault.report(k1, "ok", tokens=1500)
    await vault.report(k1, "ok", tokens=500)
    key = (await vault.list_keys("gemini"))[0]
    assert key["metrics"]["requests_1m"] == 2
    assert key["metrics"]["tokens_24h"] == 2000
    assert vault._cooldowns.get(k1, 0) == 0


@pytest.mark.asyncio
async def test_no_keys_returns_none_for_env_fallback(vault):
    assert await vault.acquire("nonexistent-provider") is None


@pytest.mark.asyncio
async def test_disabled_key_never_leased(vault):
    k1 = await vault.add(provider="gemini", label="k1", secret="sk-k1-000001")
    await vault.set_state(k1, "disabled")
    assert await vault.acquire("gemini") is None
    await vault.set_state(k1, "active")
    assert (await vault.acquire("gemini")).id == k1
