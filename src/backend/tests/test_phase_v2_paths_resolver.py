"""Day-4 Wave-1 — Block V-2: OS-aware data-path resolver (`paths.py`).

Closes audit-2026-05-01-day4 findings U5-PKG-H1 + U5-PKG-H3.
Implements ADR-DSH-002 (`docs/architecture/desktop-shell.md` §2).

Acceptance per the desktop-shell test plan:

* `test_data_dir_linux_dev` — `PHANTOM_PACKAGED` unset →
  `resolve_data_dir("chroma")` returns repo-root `.phantom-data/chroma`.
* `test_data_dir_packaged_path` — `PHANTOM_PACKAGED=1` + monkeypatched
  `platformdirs.user_data_dir` → resolver returns `<mock>/chroma`.
* `test_data_dir_env_override_wins` — `PHANTOM_DATA_DIR=/tmp/foo` set →
  resolver returns `/tmp/foo/chroma` regardless of packaged flag.

Plus regression coverage: every kind, frontend-dist legacy override,
ensure-data-dirs idempotence, REPO_ROOT pin against future refactor.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


# ────────────────────────────────────────────────── dev-mode ──


class TestDevMode:
    @pytest.mark.parametrize(
        "kind",
        ["chroma", "sqlite", "voice_models", "workspace"],
    )
    def test_dev_mode_returns_repo_root_phantom_data(self, monkeypatch, kind):
        """No PHANTOM_PACKAGED, no PHANTOM_DATA_DIR → repo-root
        `.phantom-data/<kind>`. The `.phantom-data` segment is in the
        gitignore (per ADR-DSH-002 §back-compat invariant 4) so dev
        commits don't accidentally check in caches."""
        from paths import REPO_ROOT, resolve_data_dir

        monkeypatch.delenv("PHANTOM_PACKAGED", raising=False)
        monkeypatch.delenv("PHANTOM_DATA_DIR", raising=False)
        monkeypatch.delenv("PHANTOM_FRONTEND_DIST", raising=False)

        result = resolve_data_dir(kind)

        assert result == REPO_ROOT / ".phantom-data" / kind, (
            f"dev-mode {kind!r} resolution drifted: {result}"
        )

    def test_repo_root_anchor_points_at_repo_root(self):
        """REPO_ROOT must be the directory holding `src/backend/`.
        Pinned because a future refactor that moves `paths.py` would
        silently shift every dev-mode resolution."""
        from paths import REPO_ROOT

        assert (REPO_ROOT / "src" / "backend").is_dir(), (
            f"REPO_ROOT={REPO_ROOT!r} is not a repo root with src/backend"
        )
        # Conftest CWD is src/backend; cross-check with that.
        assert (REPO_ROOT / "src" / "backend" / "paths.py").is_file()


# ────────────────────────────────────────────────── packaged-mode ──


class TestPackagedMode:
    @pytest.mark.parametrize(
        "kind",
        ["chroma", "sqlite", "voice_models", "workspace"],
    )
    def test_packaged_uses_platformdirs(self, monkeypatch, tmp_path, kind):
        """PHANTOM_PACKAGED=1 + monkeypatched `platformdirs.user_data_dir`
        → resolver routes through platformdirs. Mocks the OS-specific
        directory so the test is OS-agnostic — Linux CI returns
        `~/.local/share/PHANTOM` here too, and we don't care which
        spelling, only that it round-trips."""
        import paths

        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.delenv("PHANTOM_DATA_DIR", raising=False)
        mock_root = tmp_path / "appdata" / "PHANTOM"
        monkeypatch.setattr(
            paths.platformdirs,
            "user_data_dir",
            lambda *a, **kw: str(mock_root),
        )

        result = paths.resolve_data_dir(kind)

        assert result == mock_root / kind, (
            f"packaged-mode {kind!r} did not route through platformdirs"
        )

    def test_packaged_passes_app_name_and_author(self, monkeypatch, tmp_path):
        """Pin the `("PHANTOM", "PHANTOM-OS")` tuple sent to
        platformdirs — Windows derives a path from this exact pair
        (`%LOCALAPPDATA%\\PHANTOM-OS\\PHANTOM`). A refactor that drops
        the author silently changes the Windows install location."""
        import paths

        captured: list[tuple] = []

        def _spy(*args, **kwargs):
            captured.append((args, kwargs))
            return str(tmp_path)

        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.delenv("PHANTOM_DATA_DIR", raising=False)
        monkeypatch.setattr(paths.platformdirs, "user_data_dir", _spy)

        paths.resolve_data_dir("chroma")

        assert captured, "platformdirs.user_data_dir was never called"
        args, _ = captured[0]
        assert args[:2] == ("PHANTOM", "PHANTOM-OS"), (
            f"app-name/author tuple drifted: {args}"
        )


# ────────────────────────────────────────────────── env-override ──


class TestEnvOverride:
    @pytest.mark.parametrize(
        "kind",
        ["chroma", "sqlite", "voice_models", "workspace"],
    )
    def test_phantom_data_dir_wins_over_packaged(self, monkeypatch, tmp_path, kind):
        """PHANTOM_DATA_DIR is the operator's escape hatch (kiosk
        configs, NFS mounts, sandboxed test runs). It must win over
        the packaged-mode platformdirs branch — pin both flags ON."""
        from paths import resolve_data_dir

        override = tmp_path / "operator-pinned"
        monkeypatch.setenv("PHANTOM_PACKAGED", "1")
        monkeypatch.setenv("PHANTOM_DATA_DIR", str(override))

        result = resolve_data_dir(kind)

        assert result == override / kind

    def test_phantom_data_dir_wins_over_dev(self, monkeypatch, tmp_path):
        from paths import resolve_data_dir

        override = tmp_path / "dev-override"
        monkeypatch.delenv("PHANTOM_PACKAGED", raising=False)
        monkeypatch.setenv("PHANTOM_DATA_DIR", str(override))

        assert resolve_data_dir("chroma") == override / "chroma"

    def test_phantom_data_dir_expands_user_tilde(self, monkeypatch):
        """`~/phantom` must expand. Operators routinely set kiosk
        paths from shell scripts."""
        from paths import resolve_data_dir

        monkeypatch.delenv("PHANTOM_PACKAGED", raising=False)
        monkeypatch.setenv("PHANTOM_DATA_DIR", "~/.phantom-test-override")

        result = resolve_data_dir("chroma")

        assert "~" not in str(result), f"tilde not expanded: {result}"
        assert str(result).endswith("/.phantom-test-override/chroma")


# ────────────────────────────────────────────────── frontend_dist ──


class TestFrontendDist:
    def test_frontend_dist_legacy_env_override_wins(self, monkeypatch, tmp_path):
        """`PHANTOM_FRONTEND_DIST` is the legacy single-shot full-path
        override at `main.py:706`. Preserved as-is so existing
        deployment scripts keep working — even when PHANTOM_DATA_DIR
        is also set."""
        from paths import resolve_data_dir

        legacy = tmp_path / "legacy-dist"
        monkeypatch.setenv("PHANTOM_FRONTEND_DIST", str(legacy))
        monkeypatch.setenv("PHANTOM_DATA_DIR", "/should/be/ignored")

        result = resolve_data_dir("frontend_dist")

        assert result == legacy

    def test_frontend_dist_no_legacy_falls_through(self, monkeypatch, tmp_path):
        """Without the legacy override, `frontend_dist` resolves like
        any other kind — under PHANTOM_DATA_DIR or platformdirs."""
        from paths import resolve_data_dir

        monkeypatch.delenv("PHANTOM_FRONTEND_DIST", raising=False)
        override = tmp_path / "data"
        monkeypatch.setenv("PHANTOM_DATA_DIR", str(override))

        assert resolve_data_dir("frontend_dist") == override / "frontend_dist"


# ────────────────────────────────────────────────── ensure_data_dirs ──


class TestEnsureDataDirs:
    def test_ensure_creates_all_write_kinds(self, monkeypatch, tmp_path):
        """`ensure_data_dirs` materialises chroma / sqlite / voice_models
        / workspace under the resolved root. `frontend_dist` is *not*
        created (it's read-only in production)."""
        from paths import ensure_data_dirs

        monkeypatch.setenv("PHANTOM_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("PHANTOM_FRONTEND_DIST", raising=False)

        ensure_data_dirs()

        for kind in ("chroma", "sqlite", "voice_models", "workspace"):
            assert (tmp_path / kind).is_dir(), f"{kind} not created"
        # frontend_dist not in write-set.
        assert not (tmp_path / "frontend_dist").exists(), (
            "frontend_dist should not be auto-created"
        )

    def test_ensure_idempotent(self, monkeypatch, tmp_path):
        """Two calls in a row must succeed — supervised restarts and
        pytest reruns hit this path repeatedly."""
        from paths import ensure_data_dirs

        monkeypatch.setenv("PHANTOM_DATA_DIR", str(tmp_path))
        ensure_data_dirs()
        ensure_data_dirs()  # no raise

        # Drop a file; second call must not wipe it.
        canary = tmp_path / "chroma" / "canary.txt"
        canary.write_text("alive")
        ensure_data_dirs()
        assert canary.read_text() == "alive"

    def test_resolve_does_not_mkdir(self, monkeypatch, tmp_path):
        """`resolve_data_dir` is pure — it must NOT create directories.
        Only `ensure_data_dirs` is allowed to mkdir, so test code can
        assert non-existence without race conditions."""
        from paths import resolve_data_dir

        monkeypatch.setenv("PHANTOM_DATA_DIR", str(tmp_path / "fresh"))

        path = resolve_data_dir("chroma")

        assert not path.exists(), (
            "resolve_data_dir mkdir'd unexpectedly — that's "
            "ensure_data_dirs's job"
        )
