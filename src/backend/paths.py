"""OS-aware data-path resolver — Day-4 Block V-2 (ADR-DSH-002).

Closes audit-2026-05-01-day4 finding U5-PKG-H1 (`./chroma_data` cwd in
`Program Files\\PHANTOM\\` hits UAC) and U5-PKG-H3 (POSIX-only
`/app/dist` frontend default).

The single entry point is `resolve_data_dir(kind)` returning a
`pathlib.Path`. Resolution precedence:

    1. Per-kind env override:
        - `chroma`         → `PHANTOM_DATA_DIR/chroma`
        - `sqlite`         → `PHANTOM_DATA_DIR/sqlite`
        - `voice_models`   → `PHANTOM_DATA_DIR/voice_models`
        - `frontend_dist`  → `PHANTOM_FRONTEND_DIST` (legacy, full path)
        - `workspace`      → `PHANTOM_DATA_DIR/workspace`
       `PHANTOM_DATA_DIR` set → all kinds rooted there.
    2. Packaged mode (`PHANTOM_PACKAGED=1`) →
       `platformdirs.user_data_dir("PHANTOM", "PHANTOM-OS") / kind`.
       Linux: `~/.local/share/PHANTOM/<kind>`.
       macOS: `~/Library/Application Support/PHANTOM/<kind>`.
       Windows: `%LOCALAPPDATA%\\PHANTOM-OS\\PHANTOM\\<kind>`.
    3. Dev fallback → `<repo_root>/.phantom-data/<kind>` (gitignored).

`ensure_data_dirs()` materialises the four canonical write-targets
(chroma / sqlite / voice_models / workspace) once at lifespan G1. The
function is idempotent so test runs and supervised restarts are safe.

Day-4 ships the resolver itself; the call-site flips
(`config.chroma_path`, `database_url`, `silero_path`,
`PHANTOM_FRONTEND_DIST`) are intentionally *not* part of this block —
each is a downstream wiring change with its own back-compat
implications and gets its own commit (Wave-2).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import platformdirs

__all__ = ["DataKind", "resolve_data_dir", "ensure_data_dirs", "REPO_ROOT"]

DataKind = Literal["chroma", "sqlite", "voice_models", "frontend_dist", "workspace"]

# Canonical write-targets that `ensure_data_dirs()` creates at boot.
# `frontend_dist` is *read-only* in production (the Tauri sidecar ships
# it next to the exe); we never `mkdir` it here.
_WRITE_KINDS: tuple[DataKind, ...] = ("chroma", "sqlite", "voice_models", "workspace")

# Repo-root anchor — `__file__` is `<repo>/src/backend/paths.py`, so the
# root is two parents up. Computed at import time, cheap.
REPO_ROOT: Path = Path(__file__).resolve().parents[2]

_APP_NAME = "PHANTOM"
_APP_AUTHOR = "PHANTOM-OS"


def _is_packaged() -> bool:
    return os.environ.get("PHANTOM_PACKAGED") == "1"


def _root_dir() -> Path:
    """Pick the root directory for *all* kinds. The kind suffix is
    appended in `resolve_data_dir`."""
    override = os.environ.get("PHANTOM_DATA_DIR")
    if override:
        return Path(override).expanduser()
    if _is_packaged():
        # `platformdirs` reads the live OS each call — never cache.
        return Path(platformdirs.user_data_dir(_APP_NAME, _APP_AUTHOR))
    return REPO_ROOT / ".phantom-data"


def resolve_data_dir(kind: DataKind) -> Path:
    """Return the OS-correct path for `kind`. Pure — does NOT mkdir.

    `frontend_dist` honours the legacy `PHANTOM_FRONTEND_DIST` env
    (single-shot full-path override) before falling through to the
    standard kind-suffix resolution; this preserves the
    `main.py` :706 contract.
    """
    if kind == "frontend_dist":
        legacy = os.environ.get("PHANTOM_FRONTEND_DIST")
        if legacy:
            return Path(legacy).expanduser()
    return _root_dir() / kind


def ensure_data_dirs() -> None:
    """Materialise the four canonical write-target directories. Called
    once at lifespan G1 (per ADR-RTP-001) before any subsystem touches
    a path. Idempotent — safe for pytest reruns and watchdog restarts.
    """
    for kind in _WRITE_KINDS:
        resolve_data_dir(kind).mkdir(parents=True, exist_ok=True)
