"""Tier-A H-6 — Day-2 audit D2-A6 / G-1 / F-17.

Three regression surfaces:

* `init_chroma_eager` opens the PersistentClient + enumerates collections
  at lifespan startup so the FIRST `/readyz` call no longer pays the
  2-3 s leaked-collection scan cost.
* `_probe_chroma` no longer calls `list_collections()` per probe — it
  trusts the lifespan warmup and just confirms the client is bound.
* `prune_orphan_collections` removes `user_*` collections whose suffix
  isn't a known SQL user, with a `dry_run` mode for safe inspection.
"""
from __future__ import annotations

import pytest


# ── G-1 — eager init + probe cheapness ────────────────────────────────────────


class TestG1ProbeChroma:
    @pytest.mark.asyncio
    async def test_probe_returns_not_initialised_until_warmed(self, monkeypatch):
        # Force the module-level singleton back to None and verify the
        # probe cleanly says "not_initialized" without faulting.
        from memory import strategic_memory as sm
        from observability import _probe_chroma

        monkeypatch.setattr(sm, "_chroma_client", None)
        ok, detail = await _probe_chroma()
        assert ok is False
        assert "not_initialized" in detail

    @pytest.mark.asyncio
    async def test_probe_does_not_call_list_collections(self, monkeypatch):
        # After lifespan startup the client is bound; the probe must
        # NOT call list_collections — that's the expensive scan G-1 was
        # tripping over. Stand a fake client up and assert the method
        # is never invoked.
        from memory import strategic_memory as sm
        from observability import _probe_chroma

        calls: list[str] = []

        class _FakeClient:
            def list_collections(self):  # pragma: no cover - asserted not called
                calls.append("list_collections")
                return []

        monkeypatch.setattr(sm, "_chroma_client", _FakeClient())
        ok, detail = await _probe_chroma()
        assert ok is True
        assert detail == "ok"
        assert calls == [], (
            "D2-A6 regression: _probe_chroma still calls list_collections() "
            "on the hot path; cold-scan latency leaks into /readyz."
        )

    @pytest.mark.asyncio
    async def test_init_chroma_eager_warms_client(self, monkeypatch):
        # init_chroma_eager must (a) bind the singleton and (b) call
        # list_collections exactly once. Fake the chromadb import so the
        # test doesn't touch the real on-disk store.
        from memory import strategic_memory as sm

        list_calls: list[int] = []

        class _FakeClient:
            def list_collections(self):
                list_calls.append(1)
                return ["a", "b", "c"]

        # _get_client() resolves chromadb lazily — patch the singleton
        # directly so the function returns our fake without importing
        # chromadb at all.
        monkeypatch.setattr(sm, "_chroma_client", _FakeClient())
        result = await sm.init_chroma_eager()
        assert result.get("collections") == 3
        assert "elapsed_ms" in result
        assert list_calls == [1]
        assert sm.client_initialized() is True


# ── F-17 — orphan-collection janitor ──────────────────────────────────────────


class TestF17Janitor:
    @pytest.mark.asyncio
    async def test_prune_drops_unknown_user_collections(self, monkeypatch):
        from memory import strategic_memory as sm

        deleted: list[str] = []

        class _Col:
            def __init__(self, name: str):
                self.name = name

        class _FakeClient:
            def list_collections(self):
                return [
                    _Col("user_alice_safe"),
                    _Col("user_bob_safe"),
                    _Col("user_orphan_one"),
                    _Col("user_orphan_two"),
                    _Col("system_meta"),  # non-user prefix — must be kept
                ]

            def delete_collection(self, name: str):
                deleted.append(name)

        monkeypatch.setattr(sm, "_chroma_client", _FakeClient())
        summary = await sm.prune_orphan_collections(
            {"alice_safe", "bob_safe"}, dry_run=False
        )
        assert summary["scanned"] == 5
        # alice + bob + system_meta = kept; two orphans = deleted.
        assert summary["kept"] == 3
        assert sorted(summary["deleted"]) == [
            "user_orphan_one",
            "user_orphan_two",
        ]
        assert sorted(deleted) == [
            "user_orphan_one",
            "user_orphan_two",
        ], "F-17 regression: delete_collection NOT called for orphan rows"
        assert summary["failures"] == []

    @pytest.mark.asyncio
    async def test_dry_run_lists_without_deleting(self, monkeypatch):
        from memory import strategic_memory as sm

        deleted: list[str] = []

        class _Col:
            def __init__(self, name: str):
                self.name = name

        class _FakeClient:
            def list_collections(self):
                return [_Col("user_only_orphan")]

            def delete_collection(self, name: str):  # pragma: no cover - not allowed
                deleted.append(name)

        monkeypatch.setattr(sm, "_chroma_client", _FakeClient())
        summary = await sm.prune_orphan_collections(set(), dry_run=True)
        assert summary["dry_run"] is True
        assert summary["deleted"] == ["user_only_orphan"]
        assert deleted == [], (
            "F-17 dry-run regression: actually called delete_collection — "
            "the operator's --dry-run is meant to be a read-only inspection."
        )

    @pytest.mark.asyncio
    async def test_failure_in_one_collection_does_not_block_others(self, monkeypatch):
        from memory import strategic_memory as sm

        class _Col:
            def __init__(self, name: str):
                self.name = name

        class _FakeClient:
            def list_collections(self):
                return [_Col("user_bad"), _Col("user_good")]

            def delete_collection(self, name: str):
                if name == "user_bad":
                    raise RuntimeError("synthetic delete failure")

        monkeypatch.setattr(sm, "_chroma_client", _FakeClient())
        summary = await sm.prune_orphan_collections(set(), dry_run=False)
        assert summary["deleted"] == ["user_good"]
        assert len(summary["failures"]) == 1
        assert summary["failures"][0]["name"] == "user_bad"
        assert "synthetic delete failure" in summary["failures"][0]["error"]


# ── F-17 — filesystem-orphan dir cleanup ──────────────────────────────────────


class TestF17DirJanitor:
    @pytest.mark.asyncio
    async def test_prune_dirs_removes_unreferenced_uuid_dirs(self, monkeypatch, tmp_path):
        # Stand a temporary chroma_path with three UUID-named dirs and
        # one non-UUID dir. Mark only one UUID as "live" via the fake
        # client; the other two must be removed; the non-UUID is
        # untouched (forward-compat: chromadb may add metadata dirs).
        from memory import strategic_memory as sm
        from config import config

        live_id = "00000000-0000-0000-0000-000000000001"
        orphan_a = "00000000-0000-0000-0000-00000000000a"
        orphan_b = "00000000-0000-0000-0000-00000000000b"
        non_uuid = "metadata"

        for name in (live_id, orphan_a, orphan_b, non_uuid):
            d = tmp_path / name
            d.mkdir()
            (d / "data_level0.bin").write_bytes(b"x" * 32)

        class _LiveCol:
            def __init__(self, cid: str):
                self.id = cid
                self.name = "user_phantom"

        class _FakeClient:
            def list_collections(self):
                return [_LiveCol(live_id)]

        monkeypatch.setattr(sm, "_chroma_client", _FakeClient())
        monkeypatch.setattr(config, "chroma_path", str(tmp_path))

        summary = await sm.prune_orphan_dirs(dry_run=False)
        assert summary["scanned"] == 3  # only UUID-named dirs counted
        assert summary["live"] == 1
        assert sorted(summary["deleted_dirs"]) == sorted([orphan_a, orphan_b])
        assert summary["freed_bytes"] >= 64

        # Live dir + non-uuid dir survive; orphan dirs are gone.
        assert (tmp_path / live_id).is_dir()
        assert (tmp_path / non_uuid).is_dir()
        assert not (tmp_path / orphan_a).exists()
        assert not (tmp_path / orphan_b).exists()

    @pytest.mark.asyncio
    async def test_prune_dirs_dry_run_reports_freed_without_deleting(
        self, monkeypatch, tmp_path
    ):
        from memory import strategic_memory as sm
        from config import config

        orphan = "11111111-1111-1111-1111-111111111111"
        d = tmp_path / orphan
        d.mkdir()
        (d / "x.bin").write_bytes(b"y" * 100)

        class _FakeClient:
            def list_collections(self):
                return []

        monkeypatch.setattr(sm, "_chroma_client", _FakeClient())
        monkeypatch.setattr(config, "chroma_path", str(tmp_path))

        summary = await sm.prune_orphan_dirs(dry_run=True)
        assert summary["dry_run"] is True
        assert summary["deleted_dirs"] == [orphan]
        assert summary["freed_bytes"] >= 100
        # Real check: dry-run did NOT touch disk.
        assert (tmp_path / orphan).is_dir()

    @pytest.mark.asyncio
    async def test_prune_dirs_handles_missing_chroma_path(self, monkeypatch, tmp_path):
        # If chroma_path doesn't exist (fresh container, never written),
        # the janitor must report an empty result and not crash.
        from memory import strategic_memory as sm
        from config import config

        monkeypatch.setattr(config, "chroma_path", str(tmp_path / "does-not-exist"))
        summary = await sm.prune_orphan_dirs(dry_run=False)
        assert summary["scanned"] == 0
        assert summary["deleted_dirs"] == []
        assert summary["failures"] == []
