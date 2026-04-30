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
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import User
from security.auth import get_current_user
from security.permissions import require_root
from tools.file_manager import (
    READ_FILE_CAP_BYTES,
    delete_path,
    list_dir_raw,
    read_file as _read_file,
    search_files,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["files"])


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
    """Expose the read cap so the FE can warn before issuing big reads."""
    return {"read_cap_bytes": READ_FILE_CAP_BYTES}
