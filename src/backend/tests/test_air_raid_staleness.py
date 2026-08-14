"""Тривога: скільки запитів на хвилину і скільки живе факт.

Два числа, обидва небезпечні.

`rate_limit_per_minute` стояв 120 проти задокументованої жорсткої межі
alerts.in.ua у 12/хв на IP (історія — 2/хв). Заробити бан цим числом можна
рівно тоді, коли шар потрібен: під час тривоги, коли всі опитують частіше.

`ttl_s` каже, коли перезапитати. Скільки живе сам факт — інше число, і без
нього дволітній «відбій» малюється зеленим спокоєм. Тиша живе дві хвилини,
тривога — десять; несиметрично навмисно, бо застаріла тривога помиляється в
бік безпеки, а застаріла тиша — ні.
"""
from __future__ import annotations

import pytest

from geo import StaleRender
from geo.layer_registry import reload_layer_registry

# devs.alerts.in.ua, перевірено 14.08.2026.
ALERTS_IN_UA_DOCUMENTED_LIMIT = 12


@pytest.fixture(autouse=True)
def _registry():
    return reload_layer_registry()


def test_poll_rate_stays_inside_the_documented_upstream_limit(_registry):
    source = _registry.get("air_raid_ua").source
    assert source.rate_limit_per_minute is not None
    assert source.rate_limit_per_minute <= ALERTS_IN_UA_DOCUMENTED_LIMIT, (
        f"{source.rate_limit_per_minute}/хв проти дозволених "
        f"{ALERTS_IN_UA_DOCUMENTED_LIMIT}/хв — це заявка на бан під час тривоги"
    )


def test_the_actual_poll_interval_also_fits_the_limit(_registry):
    """Межа в маніфесті нічого не варта, якщо тасковик її обганяє."""
    source = _registry.get("air_raid_ua").source
    polls_per_minute = 60 / float(source.poll_interval_s or 60)
    assert polls_per_minute <= ALERTS_IN_UA_DOCUMENTED_LIMIT


def test_the_alert_layer_declares_how_long_its_facts_live(_registry):
    staleness = _registry.get("air_raid_ua").staleness
    assert staleness is not None, "шар стверджує щось про «зараз» без строку придатності"
    assert staleness.stale_render is StaleRender.unknown
    assert staleness.resync_budget_bytes is not None


def test_quiet_expires_sooner_than_an_alert(_registry):
    staleness = _registry.get("air_raid_ua").staleness
    assert staleness.asymmetric is not None
    assert staleness.asymmetric.clear_s == 120
    assert staleness.asymmetric.active_s == 600
    assert staleness.asymmetric.clear_s < staleness.asymmetric.active_s


def test_the_schema_refuses_a_symmetry_that_trusts_silence():
    """Тиша не може бути надійнішою за тривогу — це та сама вада наново."""
    from geo.layer_manifest import LayerStaleness

    with pytest.raises(ValueError, match="clear_s"):
        LayerStaleness.model_validate({"asymmetric": {"clear_s": 600, "active_s": 120}})


def test_the_schema_refuses_a_staleness_block_that_bounds_nothing():
    from geo.layer_manifest import LayerStaleness

    with pytest.raises(ValueError, match="half_life_s"):
        LayerStaleness.model_validate({"stale_render": "unknown"})
