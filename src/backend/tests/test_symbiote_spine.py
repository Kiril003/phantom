"""Хребет симбіота: присутність, вибір місця, доставка команд."""
import asyncio

import pytest

from symbiote.commands import (
    SymbioteCommand,
    CommandResult,
    command_bus,
    command_registry,
)
from symbiote.presence import PresenceStore


def test_presence_tracks_two_bodies():
    store = PresenceStore()
    store.update("u1", "desktop", kind="desktop", name="ПК", online=True)
    store.update(
        "u1", "phone-1", kind="phone", name="Телефон", online=True,
        battery_pct=64, lat=50.45, lon=30.52, accuracy_m=8,
    )
    snap = store.snapshot("u1")
    assert snap["total"] == 2
    assert snap["alive"] == 2


def test_position_comes_from_the_most_precise_body():
    store = PresenceStore()
    store.update("u1", "pc", kind="desktop", online=True, lat=50.0, lon=30.0, accuracy_m=50_000)
    store.update("u1", "ph", kind="phone", online=True, lat=50.45, lon=30.52, accuracy_m=8)
    position = store.snapshot("u1")["position"]
    assert position["from_body"] == "ph"
    assert position["accuracy_m"] == 8


def test_silent_body_is_not_counted_alive():
    store = PresenceStore()
    body = store.update("u1", "ph", kind="phone", online=True)
    body.updated_at -= 10_000
    assert store.snapshot("u1")["alive"] == 0


def test_registry_knows_both_directions():
    phone_verbs = {v["verb"] for v in command_registry.for_body_kind("phone")}
    desktop_verbs = {v["verb"] for v in command_registry.for_body_kind("desktop")}
    assert "phone.locate" in phone_verbs
    assert "pc.type" in desktop_verbs
    assert all(v["requires"] for v in command_registry.all())


@pytest.mark.asyncio
async def test_command_waits_in_the_inbox_until_body_takes_it():
    command = SymbioteCommand(verb="phone.locate", issued_by="desktop")
    await command_bus.enqueue("phone-1", command)
    first = await command_bus.drain("phone-1")
    assert [c.verb for c in first] == ["phone.locate"]
    assert await command_bus.drain("phone-1") == []


@pytest.mark.asyncio
async def test_expired_command_is_not_delivered():
    command = SymbioteCommand(verb="phone.ring")
    command.created_at -= 10_000
    await command_bus.enqueue("phone-2", command)
    assert await command_bus.drain("phone-2") == []


@pytest.mark.asyncio
async def test_result_settles_the_waiter():
    command = SymbioteCommand(verb="phone.locate")

    async def answer():
        await asyncio.sleep(0.05)
        await command_bus.settle(
            CommandResult(command_id=command.id, ok=True, payload={"lat": 50.45})
        )

    asyncio.create_task(answer())
    result = await command_bus.wait_for(command.id, timeout_s=2.0)
    assert result is not None and result.ok
    assert result.payload["lat"] == 50.45


@pytest.mark.asyncio
async def test_waiter_gives_up_when_body_stays_silent():
    assert await command_bus.wait_for("no-such-command", timeout_s=0.2) is None


def test_phone_and_desktop_radios_speak_one_language():
    """Android віддає MAC малими літерами, nmcli — великими."""
    from geo.wifi_scan import parse_packed
    from wardriving.collector import normalize_mac

    aps = parse_packed("cc:2d:21:44:06:00,-62,5240;9e:53:22:22:89:29,-75,2452")
    assert [a.bssid for a in aps] == ["CC:2D:21:44:06:00", "9E:53:22:22:89:29"]
    assert aps[0].bssid == normalize_mac("CC:2D:21:44:06:00")
    assert parse_packed("не-mac,-62,5240") == []


@pytest.mark.asyncio
async def test_instant_answer_is_not_lost():
    """Тіло відповідає ДО того, як ПК сів чекати."""
    command = SymbioteCommand(verb="phone.locate")
    waiter = await command_bus.expect(command.id)
    await command_bus.settle(
        CommandResult(command_id=command.id, ok=True, detail="місце віддано")
    )
    result = await command_bus.wait_for(command.id, timeout_s=0.2, future=waiter)
    assert result is not None and result.ok
