"""Phase 24-A — Layer registry validation tests."""
from __future__ import annotations

from pathlib import Path

import pytest

from geo import LayerCategory, LayerManifest, get_layer_registry
from geo.layer_manifest import LayerSource, LayerSourceType, LayerStyle
from geo.layer_registry import (
    LayerManifestError,
    LayerNotFoundError,
    LayerRegistry,
    reload_layer_registry,
)


_MIN_MANIFEST = """\
id: {id}
name_ua: ім'я
name_en: name
category: personal
license: PHANTOM-internal
attribution: PHANTOM
source:
  type: local_db
  ttl_s: 30
"""


def _write(dir_: Path, stem: str, body: str) -> Path:
    path = dir_ / f"{stem}.yaml"
    path.write_text(body, encoding="utf-8")
    return path


# ── Manifest model ─────────────────────────────────────────────────────────


def test_manifest_validates_minimal_payload():
    m = LayerManifest(
        id="t",
        name_ua="т",
        name_en="t",
        category=LayerCategory.personal,
        license="MIT",
        attribution="PHANTOM",
        source=LayerSource(type=LayerSourceType.local_db, ttl_s=30),
    )
    assert m.id == "t"
    assert m.style.fill_opacity == pytest.approx(0.6)
    assert m.priority.value == "normal"
    assert m.public_dict()["id"] == "t"


def test_manifest_strips_secret_auth_fields_from_public_dict():
    m = LayerManifest(
        id="alarm",
        name_ua="т",
        name_en="t",
        category=LayerCategory.ukraine,
        license="NC",
        attribution="alarms.in.ua",
        source=LayerSource(
            type=LayerSourceType.rest_polling,
            url="https://example.com/api",
            auth={"kind": "api_key", "env_key": "ALARMS_UA_KEY", "header_name": "Authorization"},
            poll_interval_s=30,
            ttl_s=30,
        ),
    )
    pub = m.public_dict()
    assert pub["source"]["auth"] == {"kind": "api_key"}
    assert "env_key" not in pub["source"]["auth"]


def test_manifest_id_pattern_enforced():
    with pytest.raises(Exception):
        LayerManifest(
            id="Bad-Id",  # uppercase + dash
            name_ua="т",
            name_en="t",
            category=LayerCategory.personal,
            license="MIT",
            attribution="x",
            source=LayerSource(type=LayerSourceType.local_db, ttl_s=10),
        )


def test_manifest_dedups_agent_verbs():
    m = LayerManifest(
        id="t",
        name_ua="т",
        name_en="t",
        category=LayerCategory.personal,
        license="MIT",
        attribution="x",
        source=LayerSource(type=LayerSourceType.local_db, ttl_s=10),
        agent_verbs=["map.flyto", "map.flyto", "map.set_view"],
    )
    assert m.agent_verbs == ["map.flyto", "map.set_view"]


# ── Registry ───────────────────────────────────────────────────────────────


def test_registry_loads_default_manifests_without_errors():
    registry = reload_layer_registry()
    assert registry.load_errors() == []
    ids = {m.id for m in registry.all()}
    # The 12 manifests shipped in 24-A.
    expected = {
        "base",
        "presence",
        "wardriving",
        "heatmap",
        "intel",
        "recon",
        "facts",
        "air_raid_ua",
        "frontline",
        "fires",
        "substations",
    }
    missing = expected - ids
    assert missing == set(), f"manifest set missing {missing}"


def test_registry_default_active_subset_matches_manifests():
    registry = reload_layer_registry()
    defaults = set(registry.default_active_ids())
    # Conservative subset — operator must opt into expensive layers.
    assert "base" in defaults
    assert "presence" in defaults
    assert "facts" in defaults
    assert "frontline" not in defaults


def test_registry_filters_by_category_and_offline(tmp_path):
    registry = reload_layer_registry()
    ukraine = registry.filter(category=LayerCategory.ukraine)
    assert {m.id for m in ukraine} == {"air_raid_ua", "frontline"}
    offline = registry.filter(available_offline=True)
    assert "base" in {m.id for m in offline}
    assert "air_raid_ua" not in {m.id for m in offline}


def test_registry_get_raises_for_missing_id():
    registry = reload_layer_registry()
    with pytest.raises(LayerNotFoundError):
        registry.get("does_not_exist")


def test_registry_rejects_id_mismatch_on_disk(tmp_path: Path):
    _write(
        tmp_path,
        "filename_stem",
        _MIN_MANIFEST.format(id="other_id"),
    )
    reg = LayerRegistry(manifest_dir=tmp_path).load()
    assert reg.all() == []
    assert len(reg.load_errors()) == 1
    fname, err = reg.load_errors()[0]
    assert fname == "filename_stem.yaml"
    assert "filename stem" in err


def test_registry_rejects_invalid_yaml(tmp_path: Path):
    _write(tmp_path, "bad", "id: oops\n  invalid: : yaml")
    reg = LayerRegistry(manifest_dir=tmp_path).load()
    assert reg.all() == []
    assert len(reg.load_errors()) == 1


def test_registry_rejects_schema_violation(tmp_path: Path):
    body = """\
id: schema
name_ua: a
name_en: b
category: bogus_category
license: x
attribution: x
source:
  type: local_db
  ttl_s: 30
"""
    _write(tmp_path, "schema", body)
    reg = LayerRegistry(manifest_dir=tmp_path).load()
    assert reg.all() == []
    assert "validation" in reg.load_errors()[0][1].lower()


def test_registry_singleton_returns_same_instance():
    a = get_layer_registry()
    b = get_layer_registry()
    assert a is b


def test_registry_public_index_excludes_secrets():
    registry = reload_layer_registry()
    air_raid = next(m for m in registry.public_index() if m["id"] == "air_raid_ua")
    assert air_raid["source"]["auth"] == {"kind": "api_key"}
