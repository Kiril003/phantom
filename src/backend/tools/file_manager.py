"""
File-manager service — sandboxed walker over an operator-controlled
search root.

Privacy invariants:

* The walker NEVER follows symlinks (anti-jailbreak).
* It refuses any ``root`` outside ``[~, /tmp, /opt/phantom]`` — the LLM
  cannot pivot to ``/etc`` or ``/var`` no matter what argument it
  hallucinates.
* The result includes the absolute path (FE keeps it sealed and shows
  the basename only — see ``FilesMatch.abs_path`` doc in chat.ts).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from hashlib import blake2s
from pathlib import Path
from typing import Any, Iterable, Optional

from ai.scenes import FilesMatch, FilesSceneData


# Material Symbols icon → file extension cluster.
_ICON_BY_EXT: dict[str, str] = {
    # images
    ".jpg": "image", ".jpeg": "image", ".png": "image", ".gif": "image",
    ".webp": "image", ".bmp": "image", ".heic": "image", ".tiff": "image",
    # movies
    ".mp4": "movie", ".mov": "movie", ".mkv": "movie", ".webm": "movie",
    ".avi": "movie",
    # audio
    ".mp3": "audiotrack", ".wav": "audiotrack", ".ogg": "audiotrack",
    ".flac": "audiotrack", ".m4a": "audiotrack",
    # docs
    ".pdf": "description", ".doc": "description", ".docx": "description",
    ".txt": "description", ".md": "description", ".rtf": "description",
    # code
    ".py": "code", ".js": "code", ".ts": "code", ".tsx": "code",
    ".rs": "code", ".go": "code", ".cpp": "code", ".c": "code",
    ".h": "code", ".sh": "code", ".rb": "code", ".java": "code",
    # archives
    ".zip": "archive", ".tar": "archive", ".gz": "archive",
    ".7z": "archive", ".rar": "archive", ".xz": "archive",
}

_TONE_BY_ICON: dict[str, str] = {
    "image": "amber",
    "movie": "coral",
    "audiotrack": "amber",
    "description": "neutral",
    "folder": "neutral",
    "code": "green",
    "archive": "coral",
    "unknown": "neutral",
}


def _icon_for(name: str, *, is_dir: bool) -> str:
    if is_dir:
        return "folder"
    ext = Path(name).suffix.lower()
    return _ICON_BY_EXT.get(ext, "unknown")


def _human_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    units = ("KB", "MB", "GB", "TB")
    val = float(n)
    for unit in units:
        val /= 1024
        if val < 1024 or unit == units[-1]:
            return f"{val:.1f} {unit}"
    return f"{val:.1f} TB"


def _human_date(ts: float) -> str:
    """Short date display ("15 Sep")."""
    dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone()
    return dt.strftime("%-d %b") if hasattr(dt, "strftime") else dt.isoformat()


def _ms(ts: float) -> int:
    return int(ts * 1000)


def _match_id(path: str, mtime_ns: int) -> str:
    digest = blake2s(f"{path}|{mtime_ns}".encode("utf-8"), digest_size=8).hexdigest()
    return digest


def _allowed_roots() -> list[Path]:
    """Operator-controlled allow-list. Order matters — first-match wins
    when the LLM passes a sub-tree that's nested under multiple."""
    home = Path(os.path.expanduser("~")).resolve()
    return [home, Path("/tmp").resolve(), Path("/opt/phantom").resolve()]


def _normalise_root(root: Optional[str]) -> Path:
    """Resolve ``root`` to an absolute path inside one of the allowed
    trees. Raises ValueError otherwise."""
    if not root:
        return _allowed_roots()[0]
    candidate = Path(os.path.expanduser(root)).resolve(strict=False)
    for allowed in _allowed_roots():
        try:
            candidate.relative_to(allowed)
        except ValueError:
            continue
        return candidate
    raise ValueError(
        f"root {root!r} resolves outside the allowed search tree "
        f"({[str(p) for p in _allowed_roots()]})"
    )


def _root_display(path: Path) -> str:
    home = Path(os.path.expanduser("~")).resolve()
    try:
        rel = path.relative_to(home)
        return f"~/{rel}" if str(rel) != "." else "~"
    except ValueError:
        return str(path)


def _walk(
    root: Path,
    *,
    follow_symlinks: bool,
    max_files: int,
) -> Iterable[Path]:
    """Yield up to ``max_files`` regular files under ``root``. Symlinks
    are skipped, hidden directories are pruned."""
    seen = 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=follow_symlinks):
        # Prune hidden dirs in place (anti-recursion into .git, .cache, etc).
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fname in filenames:
            if fname.startswith("."):
                continue
            full = Path(dirpath) / fname
            if full.is_symlink() and not follow_symlinks:
                continue
            yield full
            seen += 1
            if seen >= max_files:
                return


def _build_match(path: Path, *, highlight: bool = False) -> FilesMatch:
    stat = path.stat()
    icon = _icon_for(path.name, is_dir=path.is_dir())
    tone = _TONE_BY_ICON.get(icon, "neutral")
    return FilesMatch(
        match_id=_match_id(str(path), stat.st_mtime_ns),
        name=path.name or str(path),
        icon=icon,  # type: ignore[arg-type]
        tone=tone,  # type: ignore[arg-type]
        size_display=_human_size(stat.st_size),
        size_bytes=int(stat.st_size),
        date_display=_human_date(stat.st_mtime),
        mtime_ms=_ms(stat.st_mtime),
        highlight=highlight,
        abs_path=str(path),
    )


def search_files(
    *,
    root: Optional[str],
    query: str,
    limit: int = 9,
    ai_note: Optional[str] = None,
) -> FilesSceneData:
    """Substring search across filenames under the resolved root.

    Returns the top-N matches scored by mtime (newest first). The single
    newest hit is flagged with ``highlight=True`` so the FE renders the
    "best match" badge.
    """
    base = _normalise_root(root)
    if not base.exists() or not base.is_dir():
        raise ValueError(f"root {base} does not exist or is not a directory")

    needle = (query or "").strip().lower()
    if not needle:
        raise ValueError("query is required and must be non-empty")
    if len(needle) > 200:
        raise ValueError("query exceeds 200 chars")

    candidates: list[Path] = []
    for path in _walk(base, follow_symlinks=False, max_files=2000):
        if needle in path.name.lower():
            candidates.append(path)
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    selected = candidates[: max(1, min(limit, 9))]
    matches = [
        _build_match(p, highlight=(idx == 0))
        for idx, p in enumerate(selected)
    ]
    return FilesSceneData(
        root_display=_root_display(base),
        total_matches=len(candidates),
        matches=matches,
        filter_placeholder=f"шукати у {_root_display(base)}",
        ai_note=ai_note,
    )


def list_dir(
    *,
    root: Optional[str],
    limit: int = 9,
    ai_note: Optional[str] = None,
) -> FilesSceneData:
    """Direct-children listing — no recursion. Used for "what's in
    ~/Downloads?" without the LLM having to fabricate a query."""
    base = _normalise_root(root)
    if not base.exists() or not base.is_dir():
        raise ValueError(f"root {base} does not exist or is not a directory")

    children = sorted(
        (p for p in base.iterdir() if not p.name.startswith(".")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    selected = children[: max(1, min(limit, 9))]
    matches = [
        _build_match(p, highlight=(idx == 0))
        for idx, p in enumerate(selected)
    ]
    return FilesSceneData(
        root_display=_root_display(base),
        total_matches=len(children),
        matches=matches,
        filter_placeholder=f"фільтр у {_root_display(base)}",
        ai_note=ai_note,
    )


# Phase-6 T4 — REST surface helpers (audit-2026-04-30 — operator: 'з
# візуалу логіка не взята' for file_manager). The bytes-only `read_file`
# enforces a 1 MiB cap so the agent / FE can't stream a multi-GB binary
# into chat. Path traversal is blocked by `_normalise_root` then a
# `relative_to(allowed)` check on the candidate.

READ_FILE_CAP_BYTES = 1 * 1024 * 1024  # 1 MiB
READ_FILE_TEXT_PROBE_BYTES = 8192       # bytes used to detect text vs binary


def _resolve_inside_allowed(path: str) -> Path:
    candidate = Path(os.path.expanduser(path)).resolve(strict=False)
    for allowed in _allowed_roots():
        try:
            candidate.relative_to(allowed)
            return candidate
        except ValueError:
            continue
    raise ValueError(
        f"path {path!r} resolves outside the allowed roots "
        f"({[str(p) for p in _allowed_roots()]})"
    )


def read_file(*, path: str) -> dict[str, Any]:
    """Read a regular file inside the allowed roots, capped at 1 MiB.

    Returns a dict ready to JSON-serialise:
      - kind: 'text' | 'binary'
      - text content for 'text', or base64 for 'binary'
      - size + truncated flag.
    """
    target = _resolve_inside_allowed(path)
    if not target.exists():
        raise FileNotFoundError(str(target))
    if not target.is_file():
        raise IsADirectoryError(str(target))
    stat = target.stat()
    size = int(stat.st_size)
    truncated = size > READ_FILE_CAP_BYTES
    read_size = min(size, READ_FILE_CAP_BYTES)
    with target.open("rb") as fh:
        raw = fh.read(read_size)
    # Heuristic: a chunk is text if it decodes cleanly as UTF-8 AND has
    # zero null bytes in the first probe slice. Anything else is binary.
    probe = raw[:READ_FILE_TEXT_PROBE_BYTES]
    is_text = b"\x00" not in probe
    text_content: str | None = None
    if is_text:
        try:
            text_content = raw.decode("utf-8")
        except UnicodeDecodeError:
            is_text = False
    if is_text:
        return {
            "kind": "text",
            "path": str(target),
            "name": target.name,
            "size": size,
            "size_display": _human_size(size),
            "truncated": truncated,
            "mtime_ms": _ms(stat.st_mtime),
            "content": text_content or "",
        }
    import base64
    return {
        "kind": "binary",
        "path": str(target),
        "name": target.name,
        "size": size,
        "size_display": _human_size(size),
        "truncated": truncated,
        "mtime_ms": _ms(stat.st_mtime),
        "content_base64": base64.b64encode(raw).decode("ascii"),
    }


def list_dir_raw(*, path: Optional[str], limit: int = 200) -> dict[str, Any]:
    """Listing helper for the FileBrowser FE — same allow-list discipline
    as `list_dir` but returns the raw entries instead of a scene card."""
    base = _normalise_root(path)
    if not base.exists() or not base.is_dir():
        raise FileNotFoundError(str(base))
    parent_path: str | None = None
    try:
        parent = base.parent
        # Only expose parent if it is itself inside the allow-list.
        for allowed in _allowed_roots():
            if parent == allowed or str(parent).startswith(str(allowed)):
                parent_path = str(parent)
                break
    except Exception:
        parent_path = None
    entries = []
    for p in sorted(base.iterdir(), key=lambda q: (not q.is_dir(), q.name.lower())):
        if p.name.startswith("."):
            continue
        try:
            stat = p.stat()
        except OSError:
            continue
        entries.append({
            "name": p.name,
            "path": str(p),
            "is_dir": p.is_dir(),
            "size": int(stat.st_size) if p.is_file() else 0,
            "size_display": _human_size(stat.st_size) if p.is_file() else "",
            "mtime_ms": _ms(stat.st_mtime),
        })
        if len(entries) >= limit:
            break
    return {
        "path": str(base),
        "display": _root_display(base),
        "parent": parent_path,
        "entries": entries,
        "count": len(entries),
    }


WRITE_FILE_CAP_BYTES = 5 * 1024 * 1024  # 5 MiB write ceiling


def write_file(*, path: str, content: str | bytes, encoding: str = "utf-8", overwrite: bool = True) -> dict[str, Any]:
    """Write a regular file inside the allow-list. 5 MiB cap.

    `content` may be str (encoded with `encoding`, default utf-8) or
    bytes (written verbatim). Refuses to overwrite if `overwrite=False`
    and target exists.
    """
    target = _resolve_inside_allowed(path)
    if target.is_dir():
        raise IsADirectoryError(str(target))
    if target.exists() and not overwrite:
        raise FileExistsError(str(target))
    payload: bytes
    if isinstance(content, str):
        payload = content.encode(encoding)
    elif isinstance(content, (bytes, bytearray)):
        payload = bytes(content)
    else:
        raise TypeError(f"content must be str or bytes, got {type(content).__name__}")
    if len(payload) > WRITE_FILE_CAP_BYTES:
        raise ValueError(f"content exceeds write cap {WRITE_FILE_CAP_BYTES} bytes")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as fh:
        fh.write(payload)
    stat = target.stat()
    return {
        "ok": True,
        "path": str(target),
        "name": target.name,
        "size": int(stat.st_size),
        "size_display": _human_size(stat.st_size),
        "mtime_ms": _ms(stat.st_mtime),
    }


def make_directory(*, path: str) -> dict[str, Any]:
    """Create a new directory inside the allow-list. Idempotent — returns
    `created=False` when it already existed."""
    target = _resolve_inside_allowed(path)
    if target.exists() and not target.is_dir():
        raise FileExistsError(f"{target} exists and is not a directory")
    created = not target.exists()
    target.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": str(target), "created": created}


def rename_path(*, src: str, dst: str) -> dict[str, Any]:
    """Rename / move a path inside the allow-list. Both endpoints must
    resolve inside the allow-list."""
    src_path = _resolve_inside_allowed(src)
    dst_path = _resolve_inside_allowed(dst)
    if not src_path.exists():
        raise FileNotFoundError(str(src_path))
    if dst_path.exists():
        raise FileExistsError(str(dst_path))
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    src_path.rename(dst_path)
    return {"ok": True, "from": str(src_path), "to": str(dst_path)}


def delete_path(*, path: str) -> dict[str, Any]:
    """Delete a regular file inside the allow-list. Refuses directories
    and refuses anything outside the allow-list. Returns {ok, path}."""
    target = _resolve_inside_allowed(path)
    if not target.exists():
        raise FileNotFoundError(str(target))
    if target.is_dir():
        raise IsADirectoryError(str(target))
    target.unlink()
    return {"ok": True, "path": str(target)}


__all__ = [
    "search_files",
    "list_dir",
    "read_file",
    "list_dir_raw",
    "write_file",
    "make_directory",
    "rename_path",
    "delete_path",
    "READ_FILE_CAP_BYTES",
    "WRITE_FILE_CAP_BYTES",
]
