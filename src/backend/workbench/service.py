"""Workbench — multi-file project workspaces the AI builds and serves live.

A workspace is a directory under the phantom data dir. Every mutation is
appended to the workspace journal (journal.jsonl) so the build history is
inspectable. Preview access uses a per-workspace random token so an iframe
can load files without carrying JWT headers.
"""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import re
import secrets
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from paths import resolve_data_dir

logger = logging.getLogger(__name__)

MAX_FILES = 64
MAX_FILE_BYTES = 512 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_ACTIVE = 12

_SAFE_SEGMENT = re.compile(r"^[\w][\w.\- ]*$")

_TEXT_MIME_OVERRIDES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".css": "text/css",
    ".html": "text/html",
    ".md": "text/markdown",
}


class WorkbenchError(Exception):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def _root() -> Path:
    return resolve_data_dir("workbench")


def _safe_rel(rel_path: str) -> Path:
    """Validate a workspace-relative path: no traversal, no absolute, sane names."""
    p = Path(rel_path)
    if p.is_absolute() or not p.parts:
        raise WorkbenchError("bad_path", f"invalid path: {rel_path!r}")
    for seg in p.parts:
        if not _SAFE_SEGMENT.match(seg):
            raise WorkbenchError("bad_path", f"unsafe path segment: {seg!r}")
    return p


@dataclass
class Workspace:
    id: str
    title: str
    brief: str
    entry: str
    status: str  # building | ready | failed
    preview_token: str
    created_at_ms: int
    updated_at_ms: int
    user_id: str
    passes: list[dict] = field(default_factory=list)

    @property
    def dir(self) -> Path:
        return _root() / self.id

    @property
    def files_dir(self) -> Path:
        return self.dir / "files"

    def meta_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "title": self.title, "brief": self.brief,
            "entry": self.entry, "status": self.status,
            "preview_token": self.preview_token,
            "created_at_ms": self.created_at_ms,
            "updated_at_ms": self.updated_at_ms,
            "user_id": self.user_id, "passes": self.passes,
        }


class WorkbenchService:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()

    # ── lifecycle ────────────────────────────────────────────────────────

    async def create(self, *, title: str, brief: str, user_id: str,
                     entry: str = "index.html") -> Workspace:
        async with self._lock:
            active = [w for w in self._scan() if w.status != "failed"]
            if len(active) >= MAX_ACTIVE:
                oldest = min(active, key=lambda w: w.updated_at_ms)
                await self._delete_dir(oldest.id)
                logger.info("workbench: LRU-evicted %s", oldest.id)
            ws = Workspace(
                id=uuid.uuid4().hex[:12],
                title=title.strip()[:160] or "Untitled",
                brief=brief.strip()[:4000],
                entry=entry,
                status="building",
                preview_token=secrets.token_urlsafe(24),
                created_at_ms=int(time.time() * 1000),
                updated_at_ms=int(time.time() * 1000),
                user_id=user_id,
            )
            ws.files_dir.mkdir(parents=True, exist_ok=True)
            self._save_meta(ws)
            self.journal(ws.id, "created", {"title": ws.title})
            return ws

    def get(self, workbench_id: str) -> Workspace:
        meta_path = _root() / workbench_id / "meta.json"
        if not meta_path.is_file():
            raise WorkbenchError("not_found", f"workbench {workbench_id} not found")
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        return Workspace(**raw)

    def list(self) -> list[Workspace]:
        return sorted(self._scan(), key=lambda w: w.updated_at_ms, reverse=True)

    async def delete(self, workbench_id: str) -> None:
        async with self._lock:
            await self._delete_dir(workbench_id)

    # ── files ────────────────────────────────────────────────────────────

    def write_files(self, workbench_id: str, files: list[dict[str, str]]) -> int:
        ws = self.get(workbench_id)
        if len(files) > MAX_FILES:
            raise WorkbenchError("too_many_files", f"max {MAX_FILES} files per write")
        staged: list[tuple[Path, bytes]] = []
        for f in files:
            rel = _safe_rel(str(f.get("path", "")))
            content = str(f.get("content", "")).encode("utf-8")
            if len(content) > MAX_FILE_BYTES:
                raise WorkbenchError("file_too_big", f"{rel} exceeds {MAX_FILE_BYTES} bytes")
            staged.append((rel, content))
        existing = sum(p.stat().st_size for p in ws.files_dir.rglob("*") if p.is_file())
        incoming = sum(len(c) for _, c in staged)
        if existing + incoming > MAX_TOTAL_BYTES:
            raise WorkbenchError("workspace_full", f"workspace exceeds {MAX_TOTAL_BYTES} bytes")
        for rel, content in staged:
            target = ws.files_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        ws.updated_at_ms = int(time.time() * 1000)
        self._save_meta(ws)
        self.journal(ws.id, "files_written",
                     {"count": len(staged), "paths": [str(r) for r, _ in staged]})
        return len(staged)

    def read_file(self, workbench_id: str, rel_path: str) -> str:
        ws = self.get(workbench_id)
        target = ws.files_dir / _safe_rel(rel_path)
        if not target.is_file():
            raise WorkbenchError("not_found", f"no file {rel_path}")
        return target.read_text(encoding="utf-8", errors="replace")

    def tree(self, workbench_id: str) -> list[dict[str, Any]]:
        ws = self.get(workbench_id)
        out: list[dict[str, Any]] = []
        for p in sorted(ws.files_dir.rglob("*")):
            if p.is_file():
                out.append({
                    "path": str(p.relative_to(ws.files_dir)),
                    "size": p.stat().st_size,
                })
        return out

    def resolve_preview(self, workbench_id: str, token: str,
                        rel_path: str) -> tuple[Path, str]:
        """Token-gated static resolution for the preview iframe."""
        ws = self.get(workbench_id)
        if not secrets.compare_digest(token, ws.preview_token):
            raise WorkbenchError("forbidden", "bad preview token")
        rel = _safe_rel(rel_path or ws.entry)
        target = ws.files_dir / rel
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            raise WorkbenchError("not_found", f"no file {rel_path}")
        mime = _TEXT_MIME_OVERRIDES.get(target.suffix.lower()) or \
            mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        return target, mime

    # ── state + journal ──────────────────────────────────────────────────

    def set_status(self, workbench_id: str, status: str) -> Workspace:
        ws = self.get(workbench_id)
        ws.status = status
        ws.updated_at_ms = int(time.time() * 1000)
        self._save_meta(ws)
        return ws

    def add_pass(self, workbench_id: str, entry: dict[str, Any]) -> Workspace:
        ws = self.get(workbench_id)
        ws.passes.append(entry)
        ws.updated_at_ms = int(time.time() * 1000)
        self._save_meta(ws)
        return ws

    def journal(self, workbench_id: str, event: str, data: dict[str, Any]) -> None:
        line = json.dumps(
            {"ts_ms": int(time.time() * 1000), "event": event, **data},
            ensure_ascii=False,
        )
        path = _root() / workbench_id / "journal.jsonl"
        try:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError as exc:
            logger.warning("workbench journal write failed: %s", exc)

    def read_journal(self, workbench_id: str, limit: int = 200) -> list[dict]:
        path = _root() / workbench_id / "journal.jsonl"
        if not path.is_file():
            return []
        lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
        out = []
        for ln in lines:
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
        return out

    def screenshot_path(self, workbench_id: str, pass_n: int) -> Path:
        return _root() / workbench_id / f"pass_{pass_n}.png"

    # ── internals ────────────────────────────────────────────────────────

    def _scan(self) -> list[Workspace]:
        root = _root()
        if not root.is_dir():
            return []
        out = []
        for d in root.iterdir():
            meta = d / "meta.json"
            if meta.is_file():
                try:
                    out.append(Workspace(**json.loads(meta.read_text(encoding="utf-8"))))
                except (json.JSONDecodeError, TypeError) as exc:
                    logger.warning("workbench: bad meta in %s: %s", d.name, exc)
        return out

    def _save_meta(self, ws: Workspace) -> None:
        ws.dir.mkdir(parents=True, exist_ok=True)
        (ws.dir / "meta.json").write_text(
            json.dumps(ws.meta_dict(), ensure_ascii=False, indent=1),
            encoding="utf-8",
        )

    async def _delete_dir(self, workbench_id: str) -> None:
        target = _root() / workbench_id
        if target.is_dir():
            await asyncio.to_thread(shutil.rmtree, target, True)


workbench_service = WorkbenchService()
