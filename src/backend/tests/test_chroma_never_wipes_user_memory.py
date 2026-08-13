"""Opening the vector store must never destroy it.

`_get_client` used to treat ANY exception as "corrupted DB" and
`shutil.rmtree(config.chroma_path)` before recreating. A locked SQLite file, a
permissions blip, a transient I/O error or plain concurrent access was enough to
silently erase every long-term memory the user had — unrecoverable, in a product
whose entire premise is that it remembers.

Recovery is now opt-in and non-destructive: the damaged directory is moved
aside, never deleted.
"""
from __future__ import annotations

import os

import pytest

import memory.strategic_memory as sm


@pytest.fixture(autouse=True)
def _reset_client_singleton():
    prev = sm._chroma_client
    sm._chroma_client = None
    yield
    sm._chroma_client = prev


def _seed_store(tmp_path) -> str:
    """A directory standing in for a populated store, with a recognisable file."""
    store = tmp_path / "chroma"
    store.mkdir()
    (store / "chroma.sqlite3").write_text("precious user vectors")
    return str(store)


def _break_chroma(monkeypatch, exc: Exception):
    import chromadb

    def _boom(*a, **kw):
        raise exc

    monkeypatch.setattr(chromadb, "PersistentClient", _boom)


def test_open_failure_does_not_delete_the_store(tmp_path, monkeypatch):
    store = _seed_store(tmp_path)
    monkeypatch.setattr(sm.config, "chroma_path", store, raising=False)
    monkeypatch.setattr(sm.config, "chroma_auto_recover", False, raising=False)
    _break_chroma(monkeypatch, RuntimeError("database is locked"))

    with pytest.raises(RuntimeError):
        sm._get_client()

    assert os.path.exists(os.path.join(store, "chroma.sqlite3")), (
        "the store was destroyed by a transient open failure"
    )
    with open(os.path.join(store, "chroma.sqlite3")) as fh:
        assert fh.read() == "precious user vectors"


@pytest.mark.parametrize(
    "exc",
    [
        RuntimeError("database is locked"),
        PermissionError("permission denied"),
        OSError("input/output error"),
        KeyError("default_tenant"),
    ],
)
def test_no_transient_failure_class_wipes_the_store(tmp_path, monkeypatch, exc):
    store = _seed_store(tmp_path)
    monkeypatch.setattr(sm.config, "chroma_path", store, raising=False)
    monkeypatch.setattr(sm.config, "chroma_auto_recover", False, raising=False)
    _break_chroma(monkeypatch, exc)

    with pytest.raises(Exception):
        sm._get_client()

    assert os.path.exists(os.path.join(store, "chroma.sqlite3"))


def test_auto_recover_quarantines_rather_than_deletes(tmp_path, monkeypatch):
    """Even the opt-in destructive path must keep the data recoverable."""
    store = _seed_store(tmp_path)
    monkeypatch.setattr(sm.config, "chroma_path", store, raising=False)
    monkeypatch.setattr(sm.config, "chroma_auto_recover", True, raising=False)

    calls = {"n": 0}
    import chromadb

    real = chromadb.PersistentClient

    def _fail_once(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("corrupt metadata")
        return real(*a, **kw)

    monkeypatch.setattr(chromadb, "PersistentClient", _fail_once)

    sm._get_client()

    quarantined = [
        p for p in os.listdir(tmp_path)
        if p.startswith("chroma.corrupt-")
    ]
    assert quarantined, f"store was deleted, not quarantined: {os.listdir(tmp_path)}"
    kept = os.path.join(tmp_path, quarantined[0], "chroma.sqlite3")
    assert os.path.exists(kept), "quarantined store lost its contents"
    with open(kept) as fh:
        assert fh.read() == "precious user vectors"


def test_default_is_non_destructive():
    """A fresh install must not opt into the destructive path."""
    from config import PhantomConfig

    assert PhantomConfig.model_fields["chroma_auto_recover"].default is False


# ── Telemetry ────────────────────────────────────────────────────────────────
# Chroma's `Settings.anonymized_telemetry` defaults to True with a PostHog
# backend, so `PersistentClient(path=...)` alone starts a thread that POSTs
# usage events off the device. PHANTOM runs on the user's own hardware and
# holds encrypted GHOST records and a sealed archive; it must not report to a
# third party, and the user is never asked for consent.


def test_client_is_opened_with_telemetry_disabled(tmp_path, monkeypatch):
    """The settings we hand Chroma must switch the PostHog exporter off."""
    import chromadb
    from config import config

    captured = {}

    class _Stub:
        def list_collections(self):
            return []

    def _capture(*a, **kw):
        captured.update(kw)
        return _Stub()

    monkeypatch.setattr(chromadb, "PersistentClient", _capture)
    monkeypatch.setattr(config, "chroma_path", str(tmp_path / "chroma"))

    sm._get_client()

    settings = captured.get("settings")
    assert settings is not None, (
        "PersistentClient was opened with no settings — Chroma then applies its "
        f"telemetry-on defaults. kwargs seen: {sorted(captured)}"
    )
    assert settings.anonymized_telemetry is False


def test_no_client_is_constructed_without_settings():
    """Static sweep — a new call site must not reintroduce the default.

    The runtime test above only covers the path it exercises. This one reads
    every `PersistentClient(...)` in the backend and fails on any that omits
    `settings`, which is the only way the opt-out reaches Chroma.
    """
    import ast
    import pathlib

    root = pathlib.Path(__file__).resolve().parent.parent
    offenders: list[str] = []

    # `.claude` holds agent worktrees — checkouts of OTHER commits that happen
    # to live under the tree. Without it this sweep reads a stale copy of a
    # file that was fixed here and fails on it, so the verdict depends on
    # whatever anyone left lying around rather than on the product.
    for path in root.rglob("*.py"):
        if any(
            part in {".venv", "tests", "__pycache__", ".claude"}
            for part in path.parts
        ):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
            if name != "PersistentClient":
                continue
            if not any(kw.arg == "settings" for kw in node.keywords):
                offenders.append(f"{path.relative_to(root)}:{node.lineno}")

    assert not offenders, (
        "PersistentClient opened without `settings=` — Chroma will enable "
        f"PostHog telemetry there: {offenders}"
    )
