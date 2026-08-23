"""
PHANTOM OS — OS-Aware Data Path Resolver (ADR-DSH-002)

Provides platform-specific directories for database, chroma, frontend dist,
and voice models. Prioritizes environment variables, then packaged mode,
and falls back to local dev directories.
"""

import os
from pathlib import Path

import platformdirs

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_root_dir = REPO_ROOT

def data_root() -> Path:
    """Root of this node's data directory — everything else hangs off it."""
    phantom_data_dir = os.environ.get("PHANTOM_DATA_DIR")
    if phantom_data_dir:
        return Path(phantom_data_dir).expanduser()
    if os.environ.get("PHANTOM_PACKAGED") == "1":
        return Path(platformdirs.user_data_dir("PHANTOM", "PHANTOM-OS"))
    return REPO_ROOT / ".phantom-data"


def resolve_data_dir(kind: str) -> Path:
    """
    Resolve the absolute path for a given data kind.

    Arguments:
        kind: "chroma", "sqlite", "voice_models", "workspace", "frontend_dist"

    Returns:
        Path object pointing to the specific directory.
    """
    if kind == "frontend_dist" and os.environ.get("PHANTOM_FRONTEND_DIST"):
        return Path(os.environ["PHANTOM_FRONTEND_DIST"]).expanduser()

    return data_root() / kind


def ensure_data_dirs() -> None:
    """Ensure all required data directories exist."""
    for kind in ["chroma", "sqlite", "voice_models", "workspace"]:
        dir_path = resolve_data_dir(kind)
        dir_path.mkdir(parents=True, exist_ok=True)
