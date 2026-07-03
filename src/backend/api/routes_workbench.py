"""Workbench API — live multi-file creations built by the Atelier loop.

  POST   /api/v1/workbench                  create + build (async)
  GET    /api/v1/workbench                  list
  GET    /api/v1/workbench/{id}             meta
  GET    /api/v1/workbench/{id}/journal     build journal
  GET    /api/v1/workbench/{id}/tree        file listing
  GET    /api/v1/workbench/{id}/file        one file's text
  POST   /api/v1/workbench/{id}/refine      new pass with instruction
  DELETE /api/v1/workbench/{id}
  GET    /api/v1/workbench/{id}/preview/{path}?t=  token-gated static
  GET    /api/v1/workbench/{id}/screenshot/{n}?t=  pass screenshot
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from security.auth import require_auth
from security.jwt_manager import TokenPayload
from workbench.service import WorkbenchError, workbench_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workbench", tags=["workbench"])

_BUILDS: dict[str, asyncio.Task] = {}


class CreatePayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    brief: str = Field(..., min_length=8, max_length=4000)


class RefinePayload(BaseModel):
    instruction: str = Field(..., min_length=3, max_length=2000)


def _http(exc: WorkbenchError) -> HTTPException:
    code = {"not_found": 404, "forbidden": 403, "bad_path": 400,
            "too_many_files": 413, "file_too_big": 413,
            "workspace_full": 413}.get(exc.kind, 500)
    return HTTPException(status_code=code, detail=str(exc))


async def _phase_broadcast(workbench_id: str):
    from api.websocket_hub import hub

    async def cb(name: str, data: dict[str, Any]) -> None:
        await hub.broadcast("chat", "workbench.phase",
                            {"workbench_id": workbench_id, "phase": name, **data})
    return cb


def _spawn_build(workbench_id: str, *, refine: str = "") -> None:
    from workbench.atelier import build

    async def _run() -> None:
        cb = await _phase_broadcast(workbench_id)
        try:
            await build(workbench_id, refine_instruction=refine, on_phase=cb)
        except Exception:
            pass  # journaled + status=failed inside build()
        finally:
            _BUILDS.pop(workbench_id, None)

    if workbench_id in _BUILDS:
        raise HTTPException(status_code=409, detail="build already running")
    _BUILDS[workbench_id] = asyncio.create_task(
        _run(), name=f"workbench_build_{workbench_id}")


@router.post("")
async def create(payload: CreatePayload,
                 token: TokenPayload = Depends(require_auth)) -> dict:
    ws = await workbench_service.create(
        title=payload.title, brief=payload.brief, user_id=token.sub)
    _spawn_build(ws.id)
    return ws.meta_dict()


@router.get("")
async def list_all(_: TokenPayload = Depends(require_auth)) -> list[dict]:
    return [w.meta_dict() for w in workbench_service.list()]


@router.get("/{workbench_id}")
async def get_meta(workbench_id: str,
                   _: TokenPayload = Depends(require_auth)) -> dict:
    try:
        return workbench_service.get(workbench_id).meta_dict()
    except WorkbenchError as exc:
        raise _http(exc)


@router.get("/{workbench_id}/journal")
async def get_journal(workbench_id: str, limit: int = Query(200, le=1000),
                      _: TokenPayload = Depends(require_auth)) -> list[dict]:
    return workbench_service.read_journal(workbench_id, limit)


@router.get("/{workbench_id}/tree")
async def get_tree(workbench_id: str,
                   _: TokenPayload = Depends(require_auth)) -> list[dict]:
    try:
        return workbench_service.tree(workbench_id)
    except WorkbenchError as exc:
        raise _http(exc)


@router.get("/{workbench_id}/file")
async def get_file(workbench_id: str, path: str,
                   _: TokenPayload = Depends(require_auth)) -> dict:
    try:
        return {"path": path,
                "content": workbench_service.read_file(workbench_id, path)}
    except WorkbenchError as exc:
        raise _http(exc)


@router.post("/{workbench_id}/refine")
async def refine(workbench_id: str, payload: RefinePayload,
                 _: TokenPayload = Depends(require_auth)) -> dict:
    try:
        ws = workbench_service.get(workbench_id)
    except WorkbenchError as exc:
        raise _http(exc)
    workbench_service.journal(ws.id, "refine_requested",
                              {"instruction": payload.instruction[:500]})
    _spawn_build(ws.id, refine=payload.instruction)
    return {"ok": True, "workbench_id": ws.id}


@router.delete("/{workbench_id}")
async def delete(workbench_id: str,
                 _: TokenPayload = Depends(require_auth)) -> dict:
    task = _BUILDS.pop(workbench_id, None)
    if task is not None:
        task.cancel()
    await workbench_service.delete(workbench_id)
    return {"ok": True}


@router.get("/{workbench_id}/preview/{path:path}")
async def preview(workbench_id: str, path: str, t: str = Query("")) -> Response:
    try:
        target, mime = workbench_service.resolve_preview(workbench_id, t, path)
    except WorkbenchError as exc:
        raise _http(exc)
    return Response(
        content=target.read_bytes(),
        media_type=mime,
        headers={
            "Cache-Control": "no-store",
            "X-Frame-Options": "SAMEORIGIN",
            "Content-Security-Policy":
                "default-src 'self' 'unsafe-inline' data: blob:; "
                "connect-src 'self'; frame-ancestors 'self'",
        },
    )


@router.get("/{workbench_id}/screenshot/{n}")
async def screenshot(workbench_id: str, n: int, t: str = Query("")) -> Response:
    try:
        ws = workbench_service.get(workbench_id)
    except WorkbenchError as exc:
        raise _http(exc)
    import secrets as _secrets
    if not _secrets.compare_digest(t, ws.preview_token):
        raise HTTPException(status_code=403, detail="bad preview token")
    path = workbench_service.screenshot_path(workbench_id, n)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no screenshot")
    return Response(content=path.read_bytes(), media_type="image/png",
                    headers={"Cache-Control": "no-store"})
