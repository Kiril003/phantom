"""Порожньо мусить означати «дивились і не побачили», а не «не дивились».

Тасковик віщав лише зміни, а адаптер повертав `[]` на будь-яку невдачу —
мережа, 429 за перевищення частоти, не-JSON. Далі по трубі це невідрізнимо
від «тривог немає», і мапа малювала зелену тишу саме тоді, коли джерело
мовчало. Тепер невдача — виняток, а кожен вдалий такт віщає підтвердження
з часом спостереження, щоб клієнт міг старіти стан замість вірити останньому.
"""
from __future__ import annotations

import httpx
import pytest

from geo.live_tasker import LiveTasker
from geo.sources.alarms_ua import AlarmsUAAdapter, AlarmsUnavailable


async def _noop_on_diff(layer_id: str, payload: list) -> None:
    return None


@pytest.fixture()
def broadcasts(monkeypatch) -> list[dict]:
    seen: list[dict] = []

    async def _capture(layer_id: str, observed_at: float, count: int) -> None:
        seen.append({"layer_id": layer_id, "observed_at": observed_at, "count": count})

    monkeypatch.setattr("geo.live_tasker.broadcast_observation", _capture)
    return seen


async def test_a_quiet_tick_still_announces_that_it_looked(broadcasts):
    """Нуль тривог — теж спостереження, і клієнт мусить про нього почути."""
    tasker = LiveTasker()
    tasker.register("alarms_ua", interval_s=30, fetch=_empty, on_diff=_noop_on_diff)
    await tasker.tick_once("alarms_ua")
    assert [b["layer_id"] for b in broadcasts] == ["alarms_ua"]
    assert broadcasts[0]["count"] == 0
    assert broadcasts[0]["observed_at"] > 0


async def test_an_unchanged_tick_still_announces(broadcasts):
    """Другий однаковий такт не дає diff — але підтвердження мусить бути."""
    tasker = LiveTasker()
    tasker.register("quiet", interval_s=30, fetch=_empty, on_diff=_noop_on_diff)
    assert await tasker.tick_once("quiet") is True
    assert await tasker.tick_once("quiet") is False, "diff там, де нічого не змінилось"
    assert len(broadcasts) == 2, "шар замовк, хоч його щойно підтвердили"


async def test_a_failed_tick_announces_nothing_and_ages_the_layer(broadcasts):
    tasker = LiveTasker()
    tasker.register("broken", interval_s=30, fetch=_boom, on_diff=_noop_on_diff)
    await tasker.tick_once("broken")
    assert broadcasts == [], "невдача віщає підтвердження — це і є зелена тиша"
    stats = {s["name"]: s for s in tasker.stats()}["broken"]
    assert stats["last_run_at"] > 0, "спроба була"
    assert stats["last_ok_at"] == 0.0, "спроби не можна видавати за спостереження"


async def test_last_ok_at_does_not_move_when_the_source_starts_failing(broadcasts):
    tasker = LiveTasker()
    calls = {"n": 0}

    async def flaky() -> list:
        calls["n"] += 1
        if calls["n"] == 1:
            return []
        raise AlarmsUnavailable("429")

    tasker.register("flaky", interval_s=30, fetch=flaky, on_diff=_noop_on_diff)
    await tasker.tick_once("flaky")
    first_ok = {s["name"]: s for s in tasker.stats()}["flaky"]["last_ok_at"]
    assert first_ok > 0
    await tasker.tick_once("flaky")
    after = {s["name"]: s for s in tasker.stats()}["flaky"]
    assert after["last_ok_at"] == first_ok, "бан по частоті зарахувався як спостереження"
    assert after["last_run_at"] > first_ok


async def test_rate_limited_upstream_raises_instead_of_reporting_calm(monkeypatch):
    """429 — це «нас відшили», а не «тривог немає»."""
    adapter = AlarmsUAAdapter(api_key="k")

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *_a, **_kw):
            return httpx.Response(429, text="Too Many Requests")

    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kw: _Client())
    with pytest.raises(AlarmsUnavailable, match="429"):
        await adapter.fetch()


async def test_network_failure_raises_instead_of_reporting_calm(monkeypatch):
    adapter = AlarmsUAAdapter(api_key="k")

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *_a, **_kw):
            raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kw: _Client())
    with pytest.raises(AlarmsUnavailable):
        await adapter.fetch()


async def test_an_empty_but_successful_answer_is_still_an_observation(monkeypatch):
    """«Дивились і не побачили» лишається порожнім списком, не винятком."""
    adapter = AlarmsUAAdapter(api_key="k")

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *_a, **_kw):
            return httpx.Response(200, json={"alerts": []})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kw: _Client())
    assert await adapter.fetch() == []


async def test_an_unconfigured_source_never_reports_calm():
    """Типове розгортання — без ключа. Воно не має права казати «тиша».

    `fetch_alarms_ua` повертав `[]`, коли адаптер не налаштований, і шар
    підтверджував спокій кожні 30 секунд, нічого жодного разу не спитавши.
    """
    from geo.layer_registry import reload_layer_registry
    from geo.sources.alarms_ua import AlarmsUAAdapter, reset_alarms_ua_for_tests
    from geo.live_tasker import setup_default_tasks

    reload_layer_registry()
    reset_alarms_ua_for_tests(AlarmsUAAdapter(""))
    tasker = LiveTasker()
    await setup_default_tasks(tasker)
    assert "alarms_ua" in tasker.names

    seen: list = []

    async def _capture(*args) -> None:
        seen.append(args)

    import geo.live_tasker as mod

    original = mod.broadcast_observation
    mod.broadcast_observation = _capture
    try:
        await tasker.tick_once("alarms_ua")
    finally:
        mod.broadcast_observation = original
    assert seen == [], "шар без ключа підтвердив спокій"
    stats = {s["name"]: s for s in tasker.stats()}["alarms_ua"]
    assert stats["last_ok_at"] == 0.0


async def _empty() -> list:
    return []


async def _boom() -> list:
    raise AlarmsUnavailable("upstream down")
