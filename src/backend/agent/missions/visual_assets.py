"""
Vertical V10 — Per-mission visual asset store.

Manages a directory of PNG screenshots, render previews, and other image
artefacts captured during a mission. Lives at:

    ~/.phantom/missions/<mission_id>/assets/

Assets are referenced from the markdown ledger as relative paths
(``./assets/phase-3-preview.png``) so the ledger stays portable and a
``file://`` desktop viewer can open images without a server.

IO strategy mirrors ledger.py: asyncio.to_thread() wrapping synchronous
open/write/read. No aiofiles dependency.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_ASSETS_DIR_NAME = "assets"


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class VisualAssetStore:
    """Per-mission visual asset directory manager.

    All public methods are async coroutines that delegate blocking IO to
    asyncio.to_thread so the event loop stays responsive.

    Args:
        mission_id: UUID string for the mission.
        mission_dir: Absolute path to the mission directory
                     (e.g. ``~/.phantom/missions/<id>``).
    """

    def __init__(self, mission_id: str, mission_dir: str) -> None:
        self.mission_id = mission_id
        self.mission_dir = mission_dir
        self._assets_dir = os.path.join(mission_dir, _ASSETS_DIR_NAME)

    # ── Directory lifecycle ───────────────────────────────────────────────────

    def _ensure_dir(self) -> None:
        """Synchronous mkdir — called inside to_thread."""
        os.makedirs(self._assets_dir, exist_ok=True)

    # ── Write helpers ─────────────────────────────────────────────────────────

    async def store_png(self, png_bytes: bytes, name: str) -> str:
        """Write PNG bytes to the asset directory.

        Args:
            png_bytes: Raw PNG file content.
            name: Filename without extension (e.g. ``"phase-3-preview"``).
                  A ``.png`` extension is added if not present.

        Returns:
            Relative path from the mission dir root, e.g.
            ``"./assets/phase-3-preview.png"``.
        """
        safe_name = _sanitise_name(name)
        if not safe_name.endswith(".png"):
            safe_name = safe_name + ".png"

        abs_path = os.path.join(self._assets_dir, safe_name)

        def _sync() -> None:
            self._ensure_dir()
            with open(abs_path, "wb") as fh:
                fh.write(png_bytes)

        await asyncio.to_thread(_sync)
        rel = f"./{_ASSETS_DIR_NAME}/{safe_name}"
        logger.debug(
            "visual_assets: stored PNG mission=%s name=%s size=%d",
            self.mission_id, safe_name, len(png_bytes),
        )
        return rel

    async def store_text(
        self, content: str, name: str, ext: str = "txt"
    ) -> str:
        """Write text content to the asset directory.

        Args:
            content: UTF-8 text to store.
            name: Filename without extension.
            ext: Extension to append (default ``"txt"``).

        Returns:
            Relative path, e.g. ``"./assets/phase-1-notes.txt"``.
        """
        safe_name = _sanitise_name(name)
        clean_ext = ext.lstrip(".")
        filename = f"{safe_name}.{clean_ext}"
        abs_path = os.path.join(self._assets_dir, filename)

        def _sync() -> None:
            self._ensure_dir()
            with open(abs_path, "w", encoding="utf-8") as fh:
                fh.write(content)

        await asyncio.to_thread(_sync)
        rel = f"./{_ASSETS_DIR_NAME}/{filename}"
        logger.debug(
            "visual_assets: stored text mission=%s name=%s",
            self.mission_id, filename,
        )
        return rel

    # ── Query helpers ─────────────────────────────────────────────────────────

    def asset_path(self, name: str) -> str:
        """Return the absolute filesystem path for an asset by name.

        Does NOT check whether the file exists — callers should use
        ``list_assets()`` to enumerate present assets.
        """
        safe_name = _sanitise_name(name)
        return os.path.join(self._assets_dir, safe_name)

    def list_assets(self) -> list[dict[str, Any]]:
        """Return metadata for every file in the asset directory.

        Returns:
            List of dicts with keys: ``name``, ``size``, ``kind``,
            ``captured_at`` (ISO-8601 mtime), ``rel_path``.
            Returns an empty list when the directory does not exist.
        """
        if not os.path.isdir(self._assets_dir):
            return []

        out: list[dict[str, Any]] = []
        try:
            entries = os.listdir(self._assets_dir)
        except OSError:
            return []

        for entry in sorted(entries):
            abs_path = os.path.join(self._assets_dir, entry)
            if not os.path.isfile(abs_path):
                continue
            try:
                stat = os.stat(abs_path)
                size = stat.st_size
                mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            except OSError:
                size = 0
                mtime = ""

            kind = _kind_for(entry)
            out.append({
                "name": entry,
                "size": size,
                "kind": kind,
                "captured_at": mtime,
                "rel_path": f"./{_ASSETS_DIR_NAME}/{entry}",
                "abs_path": abs_path,
            })
        return out

    # ── Convenience ───────────────────────────────────────────────────────────

    async def read_png_as_b64(self, name: str) -> str | None:
        """Read a stored PNG and return it as a base64 string.

        Returns None if the file does not exist or cannot be read.
        """
        safe_name = _sanitise_name(name)
        if not safe_name.endswith(".png"):
            safe_name = safe_name + ".png"
        abs_path = os.path.join(self._assets_dir, safe_name)

        def _sync() -> bytes | None:
            try:
                with open(abs_path, "rb") as fh:
                    return fh.read()
            except OSError:
                return None

        data = await asyncio.to_thread(_sync)
        if data is None:
            return None
        return base64.b64encode(data).decode("ascii")


# ── Internal helpers ──────────────────────────────────────────────────────────

def _sanitise_name(name: str) -> str:
    """Strip path separators and dangerous chars from an asset name.

    Keeps alphanumerics, hyphens, underscores, periods — nothing else.
    """
    import re
    safe = re.sub(r"[^\w\-.]", "_", name)
    # Collapse leading dots to prevent hidden files.
    safe = safe.lstrip(".")
    return safe or "asset"


def _kind_for(filename: str) -> str:
    """Map extension to a kind label."""
    ext = os.path.splitext(filename)[1].lower()
    return {
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".gif": "image",
        ".webp": "image",
        ".pdf": "document",
        ".txt": "text",
        ".md": "text",
        ".html": "html",
        ".json": "json",
    }.get(ext, "binary")


# ── Factory helper ─────────────────────────────────────────────────────────────

def asset_store_for_mission(mission_id: str) -> "VisualAssetStore":
    """Return a VisualAssetStore for the canonical mission directory.

    Path: ``~/.phantom/missions/<mission_id>/``
    """
    phantom_home = os.path.expanduser("~/.phantom")
    mission_dir = os.path.join(phantom_home, "missions", mission_id)
    return VisualAssetStore(mission_id=mission_id, mission_dir=mission_dir)


__all__ = ["VisualAssetStore", "asset_store_for_mission"]
