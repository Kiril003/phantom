"""
Phase-6 T4 — Files REST surface.

Wraps `tools.file_manager` (search/list/read/delete) with auth-gated
HTTP endpoints for the FileBrowser FE + agent's `read_file`/`list_files`
tool handlers (Phase-6 T1 expansion in tool_executor).

Path-traversal defence-in-depth:
  1. file_manager._resolve_inside_allowed → canonicalise + check against
     the allow-list returned by `_allowed_roots()`.
  2. Bytes-cap on read (1 MiB) so the API can't be used to bulk-exfiltrate.
  3. ROOT-required for delete (operator must be the highest trust tier).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User
from security.auth import get_current_user
from security.permissions import require_root
from tools.file_manager import (
    READ_FILE_CAP_BYTES,
    WRITE_FILE_CAP_BYTES,
    delete_path,
    list_dir_raw,
    make_directory,
    read_file as _read_file,
    rename_path,
    search_files,
    write_file,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["files"])

# ── Signed raw access (images in chat) ───────────────────────────────────────
#
# <img src> can't carry the JWT header, so raw binary access is granted by
# a short-lived HMAC over (path, exp) minted server-side by the show_image
# chat tool. Same pattern as the workbench preview token.

RAW_CAP_BYTES = 10 * 1024 * 1024
RAW_MIME: dict[str, str] = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
}


def _raw_sig(path: str, exp: int) -> str:
    import hashlib
    import hmac as _hmac
    from config import config
    key = (config.jwt_secret_key or "phantom-dev").encode()
    return _hmac.new(key, f"{path}|{exp}".encode(), hashlib.sha256).hexdigest()


def sign_raw_url(path: str, *, ttl_s: int = 3600) -> str:
    """Mint a signed relative URL for one file. Caller must have validated
    the path is inside the allow-list (we re-validate on GET anyway)."""
    import time as _time
    from urllib.parse import quote
    exp = int(_time.time()) + ttl_s
    return (f"/api/v1/files/raw?path={quote(path)}&exp={exp}"
            f"&sig={_raw_sig(path, exp)}")


@router.get("/raw")
async def api_raw_file(
    path: str = Query(...),
    exp: int = Query(...),
    sig: str = Query(...),
):
    import hmac as _hmac
    import time as _time
    from pathlib import Path as _Path

    from fastapi import Response

    if _time.time() > exp:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="link expired")
    if not _hmac.compare_digest(sig, _raw_sig(path, exp)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="bad signature")
    from tools.file_manager import _resolve_inside_allowed
    try:
        target: _Path = _resolve_inside_allowed(path)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not a file")
    mime = RAW_MIME.get(target.suffix.lower())
    if mime is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="raw access is image-only",
        )
    if target.stat().st_size > RAW_CAP_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="file exceeds raw cap")
    return Response(content=target.read_bytes(), media_type=mime,
                    headers={"Cache-Control": "private, max-age=3600"})


@router.get("/list")
async def api_list_files(
    path: Optional[str] = Query(default=None, description="Absolute or ~-prefixed path; default = $HOME"),
    limit: int = Query(default=200, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = user, db  # auth-only; listing is operator-scoped via the allow-list
    try:
        return list_dir_raw(path=path, limit=limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        # Outside the allow-list — treat as forbidden.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get("/read")
async def api_read_file(
    path: str = Query(..., description="Absolute or ~-prefixed path inside the allow-list"),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user  # auth-gated; allow-list bounds *which* file
    try:
        return _read_file(path=path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except IsADirectoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"path is a directory, not a file: {exc}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get("/search")
async def api_search_files(
    query: str = Query(..., min_length=1, description="Substring to match in filename"),
    root: Optional[str] = Query(default=None),
    limit: int = Query(default=9, ge=1, le=50),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    try:
        scene = search_files(root=root, query=query, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {
        "root_display": scene.root_display,
        "total_matches": scene.total_matches,
        "matches": [m.model_dump() for m in scene.matches],
    }


@router.delete("/delete", status_code=status.HTTP_200_OK)
async def api_delete_file(
    path: str = Query(..., description="Absolute or ~-prefixed path of file to delete"),
    user: User = Depends(require_root),
) -> dict[str, Any]:
    """ROOT-only — delete a regular file. Refuses directories.

    The agent does NOT get this tool by default; only the FE FileBrowser
    delete button (which gates on user.role) reaches here.
    """
    _ = user
    try:
        return delete_path(path=path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except IsADirectoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"refuse to delete directory: {exc}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get("/cap")
async def api_files_cap(_: User = Depends(get_current_user)) -> dict[str, Any]:
    """Expose the read/write caps so the FE can warn before issuing big reads."""
    return {
        "read_cap_bytes": READ_FILE_CAP_BYTES,
        "write_cap_bytes": WRITE_FILE_CAP_BYTES,
    }


# ── Phase-6 follow-up — write / mkdir / rename (audit-2026-04-30) ─────


class WriteFileRequest(BaseModel):
    path: str = Field(..., description="Absolute or ~-prefixed target path")
    content: str = Field(default="", description="UTF-8 text body; capped at 5 MiB")
    overwrite: bool = Field(default=True)


@router.post("/write", status_code=status.HTTP_200_OK)
async def api_write_file(
    req: WriteFileRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    try:
        return write_file(path=req.path, content=req.content, overwrite=req.overwrite)
    except FileExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except IsADirectoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"path is a directory: {exc}",
        )
    except ValueError as exc:
        # Either allow-list rejection or content-too-large.
        msg = str(exc)
        code = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if "exceeds write cap" in msg
            else status.HTTP_403_FORBIDDEN
        )
        raise HTTPException(status_code=code, detail=msg)


class MakeDirRequest(BaseModel):
    path: str


@router.post("/mkdir", status_code=status.HTTP_200_OK)
async def api_mkdir(
    req: MakeDirRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    try:
        return make_directory(path=req.path)
    except FileExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


class RenameRequest(BaseModel):
    src: str
    dst: str


@router.post("/rename", status_code=status.HTTP_200_OK)
async def api_rename(
    req: RenameRequest,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    try:
        return rename_path(src=req.src, dst=req.dst)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except FileExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
