"""Знімок випікання не сміє нести числа, якого нема.

Кожен тест тут ламає ПОВЕДІНКУ, а не реалізацію: він питає готовий словник,
той самий, що поїде на скло і по WS, — а не внутрішні поля класів.
"""
from __future__ import annotations

import pytest

from geo.bake.contract import (
    BakeProgress, DownloadProgress, GuardFacts, JobStatus, Outcome, PackRecord,
    PreviousBake, VerifyProgress, audit_snapshot, redact_paths,
)


def _full_snapshot() -> dict:
    return JobStatus(
        job_id="7f3a", scope_id="kyiv", label_ua="Київ", stage="baking",
        started_at="2026-09-05T20:00:00+00:00",
        updated_at="2026-09-05T20:03:11+00:00",
        download=DownloadProgress(bytes_done=39_000_000, bytes_total=39_000_000,
                                  rate_bps=1.2e7, from_cache=True),
        verify=VerifyProgress(bytes_hashed=39_000_000, bytes_total=39_000_000),
        bake=BakeProgress(nodes_seen=2_100_000, nodes_kept=180_000, ways_seen=193_000,
                          ways_kept=192_800, rows_written=216_947, cells=1_250,
                          elapsed_s=15.7, ram_available_pct=41.2, input_bytes=39_000_000,
                          output_bytes=20_500_000, index_bytes=None),
        pack=PackRecord(pack_id="phantom_road_mesh.kyiv", bytes=51_000_000,
                        format_version=2, sha256="0" * 64, way_count=193_000,
                        row_count=216_947, cell_count=1_250, baked_at="2026-09-05"),
        previous=PreviousBake(way_count=192_000, elapsed_s=16.1, baked_at="2026-09-04"),
        guard=GuardFacts(floor_pct=30.0, strikes_to_trip=3, poll_s=5.0),
    ).as_dict()


def test_a_full_snapshot_breaks_no_honesty_rule():
    assert audit_snapshot(_full_snapshot()) == []


def test_bake_carries_no_total_no_percent_no_eta():
    bake = _full_snapshot()["bake"]
    for key in bake:
        lowered = key.lower()
        assert not lowered.endswith("_total"), key
        assert "percent" not in lowered and "eta" not in lowered, key
        assert "progress" not in lowered and "remaining" not in lowered, key
    # Скільки доріг у файлі — невідомо, доки файл не прочитано до кінця.
    assert "ways_total" not in bake and "nodes_total" not in bake


def test_only_download_and_verify_may_carry_a_total():
    snapshot = _full_snapshot()
    carriers = {
        section for section, body in snapshot.items()
        if isinstance(body, dict) and any(k.endswith("_total") for k in body)
    }
    assert carriers == {"download", "verify"}


def test_no_unified_job_percentage_anywhere():
    snapshot = _full_snapshot()
    assert not any("percent" in k or "progress" in k for k in snapshot)


def test_a_smuggled_percent_is_caught():
    snapshot = _full_snapshot()
    snapshot["bake"]["percent"] = 63
    assert any("percent" in fault for fault in audit_snapshot(snapshot))


def test_a_smuggled_way_total_is_caught():
    snapshot = _full_snapshot()
    snapshot["bake"]["ways_total"] = 193_000
    assert audit_snapshot(snapshot)


def test_an_absolute_path_in_the_snapshot_is_caught():
    snapshot = _full_snapshot()
    snapshot["outcome"] = {"kind": "failed", "reason": "corrupt",
                           "detail_ua": "/home/kyrylo/.phantom-data/map_packs/x.db"}
    assert any("шлях" in fault for fault in audit_snapshot(snapshot))


def test_outcome_scrubs_paths_but_keeps_the_source_url():
    outcome = Outcome("failed", "corrupt",
                      "не відкрився /home/kyrylo/data/ukraine.osm.pbf з "
                      "https://download.geofabrik.de/europe/ukraine-latest.osm.pbf")
    assert "/home/kyrylo" not in outcome.detail_ua
    assert "…/ukraine.osm.pbf" in outcome.detail_ua
    # Адреса джерела — не шлях по машині власника, і вона допомагає розібратись.
    assert "download.geofabrik.de/europe/ukraine-latest.osm.pbf" in outcome.detail_ua
    assert audit_snapshot({"outcome": outcome.to_dict()}) == []


def test_windows_paths_are_scrubbed_too():
    assert "kyrylo" not in redact_paths(r"C:\Users\kyrylo\AppData\PHANTOM\pack.db")


def test_a_failure_must_name_a_reason_and_success_may_not_borrow_one():
    assert Outcome("done").reason is None
    with pytest.raises(ValueError):
        Outcome("failed")
    with pytest.raises(ValueError):
        Outcome("failed", "тому що")
    with pytest.raises(ValueError):
        Outcome("майже", "user")


def test_an_unknown_stage_cannot_be_constructed():
    with pytest.raises(ValueError):
        JobStatus(job_id="a", scope_id="kyiv", label_ua="Київ", stage="майже готово",
                  started_at="t", updated_at="t")


def test_both_method_names_give_the_same_dict():
    status = JobStatus(job_id="a", scope_id="kyiv", label_ua="Київ", stage="preflight",
                       started_at="t", updated_at="t")
    assert status.as_dict() == status.to_dict()


def test_unknown_node_count_is_null_not_zero():
    """Обсяг-країна вузлів не рахує — і мусить це сказати, а не показати 0."""
    assert BakeProgress().nodes_seen is None
    assert BakeProgress().to_dict()["nodes_seen"] is None


# ── Дві мови одного контракту ──────────────────────────────────────────
#
# Той самий знімок оголошено двічі: тут і в src/shared/types/bake.ts. Тести
# кожної сторони зелені окремо — і саме так «null відсотків» доїжджає до
# скла. Цей тест читає TS-файл і питає: чи ВСЕ, що емітить Python, TS знає,
# і чи кожне поле, яке Python має право віддати як null, TS допускає null.
# Напрям навмисно один: TS має право знати більше (свої optional-поля), а
# Python не має права віддати того, чого TS не чекає.

import re
import typing
from dataclasses import fields as _dc_fields
from pathlib import Path as _Path

from geo.bake import contract as _contract

_TS = _Path(__file__).resolve().parents[3] / "src" / "shared" / "types" / "bake.ts"

_PAIRS = (  # (Python dataclass, TS interface)
    (_contract.DownloadProgress, "BakeDownload"),
    (_contract.VerifyProgress, "BakeVerify"),
    (_contract.BakeProgress, "BakeCounters"),
    (_contract.Outcome, "BakeOutcome"),
    (_contract.PackRecord, "BakePack"),
    (_contract.PreviousBake, "BakePrevious"),
    (_contract.GuardFacts, "BakeGuard"),
    (_contract.JobStatus, "BakeSnapshot"),
)


def _ts_interfaces(source: str) -> dict[str, dict[str, str]]:
    """{interface: {field: type_text}}.

    Тіло — до ПЕРШОЇ `}`: жоден із дзеркальних інтерфейсів не має вкладених
    дужок, а нежадібний `.*?` до `\n}` на однорядковому `BakeVerify { … }`
    заковтував наступний блок і «губив» BakeCounters. Спіймано 05.09.
    """
    out: dict[str, dict[str, str]] = {}
    for m in re.finditer(r"export interface (\w+)\s*\{([^}]*)\}", source):
        body = re.sub(r"//[^\n]*", "", m.group(2))
        out[m.group(1)] = {
            f.group(1): ("?" if f.group(2) else "") + f.group(3).strip()
            for f in re.finditer(r"(\w+)(\??):\s*([^;\n]+)", body)
        }
    return out


_PRIMITIVE = {int: "number", float: "number", str: "string", bool: "boolean"}


def _py_primitive(cls: type) -> dict[str, str]:
    """Імʼя поля -> очікуване TS-слово, лише для скалярів (Optional розгорнуто)."""
    out: dict[str, str] = {}
    for f in _dc_fields(cls):
        hint = typing.get_type_hints(cls)[f.name]
        bare = [a for a in typing.get_args(hint) if a is not type(None)] or [hint]
        if len(bare) == 1 and bare[0] in _PRIMITIVE:
            out[f.name] = _PRIMITIVE[bare[0]]
    return out


def _py_nullable(cls: type) -> dict[str, bool]:
    hints = typing.get_type_hints(cls)
    return {f.name: type(None) in typing.get_args(hints[f.name]) for f in _dc_fields(cls)}


def test_the_typescript_mirror_of_the_contract_has_not_drifted():
    assert _TS.exists(), f"TS-дзеркало контракту зникло: {_TS}"
    ts = _ts_interfaces(_TS.read_text(encoding="utf-8"))
    faults: list[str] = []
    for py_cls, ts_name in _PAIRS:
        if ts_name not in ts:
            faults.append(f"{ts_name}: інтерфейсу нема в bake.ts (Python емітить {py_cls.__name__})")
            continue
        declared = ts[ts_name]
        for name, nullable in _py_nullable(py_cls).items():
            if name not in declared:
                faults.append(f"{ts_name}.{name}: Python емітить, TS не знає")
            elif nullable and "null" not in declared[name] and not declared[name].startswith("?"):
                faults.append(f"{ts_name}.{name}: Python віддає null, TS оголосив {declared[name]!r}")
        for name, word in _py_primitive(py_cls).items():
            typed = declared.get(name, "")
            if typed and word not in typed and not re.search(r"\bBake\w+", typed):
                faults.append(f"{ts_name}.{name}: Python емітить {word}, TS оголосив {typed!r}")
    # Обидва словники значень: усе, що Python може віддати, TS мусить перелічити.
    src = _TS.read_text(encoding="utf-8")
    for label, values in (("BakeStage", _contract.STAGES),
                          ("BakeOutcomeReason", _contract.OUTCOME_REASONS)):
        union = re.search(rf"export type {label}\s*=([^;]+);", src)
        listed = set(re.findall(r"'([\w]+)'", union.group(1))) if union else set()
        for v in values:
            if v not in listed:
                faults.append(f"{label}: бракує '{v}'")
    assert not faults, "\n".join(["bake.ts розійшовся з contract.py:"] + faults)


def test_format_version_is_an_integer_because_it_is_read_from_a_pragma():
    """`PRAGMA user_version` повертає ціле; рядок «2» у пакеті не читав би ніхто."""
    record = PackRecord(pack_id="p", bytes=1, format_version=2, sha256="0" * 64,
                        way_count=1, row_count=1, cell_count=1, baked_at="t")
    assert isinstance(record.to_dict()["format_version"], int)


def test_no_sub_country_extract_url_ever_enters_the_catalogue():
    """Слід у мережі, а не трафік: обласний URL розголошує район інтересу.

    Запит `ukraine-latest.osm.pbf` каже спостерігачеві «хтось цікавиться
    Україною». Запит витягу однієї області каже «хтось цікавиться САМЕ ЦИМ
    районом» — і для продукту, яким користуються у воюючій країні, це різниця
    не теоретична. Тому дрібніший обсяг береться з файла КРАЇНИ й ріжеться
    рамкою локально.

    Сторож потрібен саме тому, що порушення виглядатиме як оптимізація: качати
    876 МБ заради Києва щиро здається марнотратством, і наступна людина
    «полагодить» це одним рядком. Тест ловить рядок, не намір.
    """
    from geo.bake import catalogue

    for source in catalogue.SOURCES.values():
        assert source.path.count("/") == 1, (
            f"{source.id}: шлях {source.path!r} глибший за <континент>/<країна> — "
            "схоже на під-країновий витяг"
        )

    for scope in catalogue.SCOPES:
        if scope.bbox is None:
            continue
        # Обсяг із рамкою МУСИТЬ їхати на джерело рівня країни, а не на власне.
        assert scope.source_id in catalogue.SOURCES, scope.id
        assert catalogue.SOURCES[scope.source_id].path.endswith("-latest.osm.pbf")
        assert scope.id != scope.source_id, (
            f"{scope.id}: обсяг із рамкою дістав власне джерело — саме та зміна, "
            "яку це правило забороняє"
        )
