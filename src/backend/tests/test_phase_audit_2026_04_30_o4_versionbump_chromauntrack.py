"""Day-3 audit-2026-04-30 — Block O commit O-4.

Closes:

* **D3-A-4** — `_VERSION` was never bumped after the v0.18.1 re-tag,
  so `phantom_build_info` and `/healthz` lied about the running build.
  Now `0.18.2-fixup` (Day-3 fixup tier; v0.19 lands at the end of
  Block Q with the chat tool-use loop).
* **D3-A-8** — OPERATIONS.md claimed metrics counters "are not yet
  incremented from the chat / voice paths". They've been wired since
  v0.18.1. Doc-only fix re-anchors the operator's expectation.
* **D3-C-8** — `chroma.sqlite3` was previously tracked in git. Audit:
  operator data history (collection metadata, sealed embeddings) ends
  up in the commit graph forever. Now untracked via `.gitignore`; the
  persistent client recreates the file on first instantiation
  (lifespan `init_chroma_eager`).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


# ── D3-A-4 — version field actually carries the running build ─────────────────


class TestD3A4VersionBump:
    def test_version_constant_matches_active_release_line(self):
        """The version string MUST move with each release. Day-3 is on
        the 0.18.2-fixup tier — Tier-A closures only, no new feature
        line. v0.19.0-jarvis-online lands at the end of Block Q."""
        from observability import _VERSION
        # Day-2 final tag was `v0.18.1-saas-base` at `91bbeb9`. Day-3
        # opens with this tier; further bumps within Day 3 land in O-7
        # (JWT cap hardening), Block Q (chat tool-use → v0.19), and
        # Block R (frontend Settings → v0.20 if both lanes green).
        assert _VERSION == "0.18.2-fixup", (
            f"D3-A-4 regression: _VERSION drifted ({_VERSION!r}) — "
            f"phantom_build_info will lie about the running build."
        )

    def test_build_info_metric_exposes_current_version(self):
        """`phantom_build_info{version="..."}` is the only signal a
        scraping pipeline has to bind dashboards to a release. Render
        the exposition and assert the version label is current."""
        from observability import render_metrics, _VERSION
        text = render_metrics()
        assert f'phantom_build_info{{version="{_VERSION}"}} 1' in text

    def test_healthz_reports_current_version(self):
        """The `/health` (legacy) and `/healthz` payloads MUST surface
        the same version. We hit `/healthz` because that's the
        Kubernetes livenessProbe target where dashboards anchor."""
        from fastapi.testclient import TestClient
        from main import create_app
        from observability import _VERSION

        app = create_app()
        with TestClient(app) as c:
            r = c.get("/healthz")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("version") == _VERSION, body


# ── D3-A-8 — OPERATIONS.md metrics-incremented section is current ─────────────


class TestD3A8OperationsMdAccuracy:
    def test_operations_no_longer_claims_counters_unwired(self):
        """The stale 'not yet incremented' wording must be gone — Day-2
        already wired the counters. An operator reading OPERATIONS
        must not be told to skip dashboard work that's actually done."""
        repo = Path(__file__).resolve().parents[3]
        ops = (repo / "docs" / "OPERATIONS.md").read_text()
        assert "not yet incremented" not in ops, (
            "D3-A-8 regression: OPERATIONS.md still has the stale claim."
        )
        # And the replacement carries the post-v0.18.1 truth.
        assert "wired into the hot paths" in ops, (
            "D3-A-8 regression: OPERATIONS.md replacement wording lost."
        )


# ── D3-C-8 — chroma.sqlite3 must NOT be tracked in git ────────────────────────


class TestD3C8ChromaSqliteUntracked:
    def test_gitignore_covers_chroma_sqlite_and_sidecars(self):
        """`.gitignore` MUST list both the main DB and its sqlite
        sidecars (-journal, -shm, -wal). Without those, a write that
        leaves WAL artefacts on disk would still surface in
        `git status` and tempt a future commit."""
        repo = Path(__file__).resolve().parents[3]
        gi = (repo / ".gitignore").read_text()
        for line in (
            "src/backend/chroma_data/chroma.sqlite3",
            "src/backend/chroma_data/chroma.sqlite3-journal",
            "src/backend/chroma_data/chroma.sqlite3-shm",
            "src/backend/chroma_data/chroma.sqlite3-wal",
        ):
            assert line in gi, (
                f"D3-C-8 regression: .gitignore missing {line!r} — "
                f"operator-data files would be committable."
            )

    def test_chroma_sqlite_no_longer_in_git_index(self):
        """`git ls-files` MUST NOT return chroma.sqlite3 — the file may
        still exist on disk for the running daemon, but it must be
        absent from the tracked tree so a future `git add .` doesn't
        silently re-introduce operator data."""
        repo = Path(__file__).resolve().parents[3]
        out = subprocess.run(
            ["git", "ls-files", "src/backend/chroma_data/chroma.sqlite3"],
            cwd=repo, capture_output=True, text=True, check=False,
        )
        # Empty stdout means file is not tracked; non-empty means it is.
        assert out.stdout.strip() == "", (
            f"D3-C-8 regression: chroma.sqlite3 is still tracked by git. "
            f"Run `git rm --cached src/backend/chroma_data/chroma.sqlite3`. "
            f"ls-files said: {out.stdout!r}"
        )
