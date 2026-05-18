"""A-1: Backup & Restore endpoints."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from fastapi.responses import StreamingResponse
import io

from db.models import User
from security.permissions import require_root
from tools.backup_service import create_backup, restore_backup

router = APIRouter(tags=["Backup"])


@router.get("/admin/backup/download")
async def download_backup(_: User = Depends(require_root)):
    """Generate and stream an encrypted backup of the system data and .env."""
    try:
        encrypted_bytes = create_backup()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup creation failed: {exc}")

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"phantom-backup-{ts}.zip.enc"

    return StreamingResponse(
        io.BytesIO(encrypted_bytes),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/admin/backup/upload")
async def upload_backup(file: UploadFile = File(...), _: User = Depends(require_root)):
    """Restore the system from an encrypted backup file. This will restart the server."""
    if not file.filename.endswith(".enc"):
        raise HTTPException(status_code=400, detail="File must be a .enc backup.")

    encrypted_bytes = await file.read()
    try:
        # Note: restore_backup will call os.execv on success, so this endpoint
        # might not cleanly return a response if it succeeds immediately.
        # But we still try to return a 200 before the process dies.
        # Actually, if we os.execv, the HTTP response won't be sent.
        # Let's defer the restart slightly so the UI gets the 200 OK.
        import asyncio
        asyncio.create_task(_delayed_restore(encrypted_bytes))
        return {"status": "ok", "message": "Restoring backup and restarting..."}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Restore failed: {exc}")


async def _delayed_restore(encrypted_bytes: bytes):
    import asyncio
    await asyncio.sleep(1.0)
    await restore_backup(encrypted_bytes)
