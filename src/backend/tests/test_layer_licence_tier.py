"""Шар, який не можна продавати, мусить казати це в маніфесті.

`ads_b` і `lightning` знято за ліцензіями, які цей продукт не може продати:
OpenSky і Blitzortung — CC-BY-NC-SA, а ADS-B над закритим небом ще й
структурно порожній. `weather_radar` (безкоштовний рівень RainViewer —
некомерційний) і `frontline` (DeepStateMap, CC-BY-NC-SA) не знято, а
відкладено — і різниця між «знято» і «відкладено» мусить жити у файлі, а не
в чиїйсь памʼяті, інакше через місяць шар тихо повертається в продаж.

Тест ловить дрейф у обидва боки: воскресіння вбитих і повернення відкладених
на платний рівень.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from geo import LayerTier
from geo.layer_registry import reload_layer_registry

KILLED = {"ads_b", "lightning"}
DEFERRED = {"weather_radar", "frontline"}

MANIFEST_DIR = Path(__file__).resolve().parents[1] / "geo/layer_registry/manifests"


@pytest.fixture(autouse=True)
def _registry():
    return reload_layer_registry()


def test_killed_layers_are_not_in_the_registry(_registry):
    alive = KILLED & {m.id for m in _registry.all()}
    assert alive == set(), f"шар знято, а він у реєстрі: {sorted(alive)}"


def test_killed_layers_have_no_manifest_left_to_enable():
    """«Ще працює, якщо ввімкнути» — це не знято."""
    leftovers = [layer for layer in KILLED if (MANIFEST_DIR / f"{layer}.yaml").exists()]
    assert leftovers == [], f"маніфест лишився: {leftovers}"


def test_deferred_layers_are_marked_deferred(_registry):
    for layer_id in sorted(DEFERRED):
        manifest = _registry.get(layer_id)
        assert manifest.tier is LayerTier.deferred, (
            f"{layer_id} повернувся на платний рівень без письмового дозволу"
        )
        assert manifest.tier_note.strip(), f"{layer_id} відкладено без причини"
        assert manifest.default_active is False


def test_deferred_state_reaches_the_frontend(_registry):
    """Проєкція для браузера мусить нести причину, а не лише прапорець."""
    payload = _registry.get("frontline").public_dict()
    assert payload["tier"] == "deferred"
    assert "DeepState" in payload["tier_note"]


def test_a_deferred_layer_cannot_be_default_active():
    from geo.layer_manifest import LayerManifest

    base = {
        "id": "probe_layer",
        "name_ua": "Проба",
        "name_en": "Probe",
        "category": "live",
        "license": "NC",
        "attribution": "тест",
        "source": {"type": "rest_polling", "url": "https://example.invalid"},
        "tier": "deferred",
        "tier_note": "ліцензія",
    }
    LayerManifest.model_validate(base)
    with pytest.raises(ValueError, match="default_active"):
        LayerManifest.model_validate({**base, "default_active": True})


def test_a_deferred_layer_must_name_its_reason():
    from geo.layer_manifest import LayerManifest

    with pytest.raises(ValueError, match="tier_note"):
        LayerManifest.model_validate(
            {
                "id": "probe_layer",
                "name_ua": "Проба",
                "name_en": "Probe",
                "category": "live",
                "license": "NC",
                "attribution": "тест",
                "source": {"type": "rest_polling", "url": "https://example.invalid"},
                "tier": "deferred",
            }
        )


def test_every_other_layer_is_still_sellable(_registry):
    """Щоб «deferred» не розповз тихо по решті каталогу."""
    deferred = {m.id for m in _registry.all() if m.tier is LayerTier.deferred}
    assert deferred == DEFERRED, f"несподівано відкладені: {sorted(deferred - DEFERRED)}"
