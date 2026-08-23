"""A-1: Backup & Restore Wizard tests.

Verifies that the backend can zip the data/ directory, encrypt it with Fernet,
and correctly decrypt and restore it (overwriting current state).
"""
import io
import os
import shutil
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient

from paths import REPO_ROOT
from tools.backup_service import create_backup, restore_backup
from security.crypto import _fernet


@pytest.fixture
def dummy_data_dir(tmp_path, monkeypatch):
    """Point the data directory to a safe tmp path for tests."""
    monkeypatch.setenv("PHANTOM_DATA_DIR", str(tmp_path))
    from paths import ensure_data_dirs
    ensure_data_dirs()

    # Create a dummy file to be backed up
    (tmp_path / "sqlite").mkdir(parents=True, exist_ok=True)
    (tmp_path / "sqlite" / "dummy.txt").write_text("Hello Backup")
    
    # Also drop a dummy .env
    dummy_env = tmp_path / ".env.dummy"
    dummy_env.write_text("DUMMY=1")
    monkeypatch.setattr("tools.backup_service.REPO_ROOT", tmp_path)
    monkeypatch.setattr("tools.backup_service.ENV_FILE_PATH", dummy_env)

    return tmp_path


@pytest.mark.asyncio
async def test_create_and_restore_backup_service(dummy_data_dir, monkeypatch):
    """Test the core service logic without HTTP."""
    # Mock os.execv so it doesn't kill the test runner!
    mock_execv = MagicMock()
    monkeypatch.setattr("os.execv", mock_execv)

    # 1. Create backup
    encrypted_bytes = create_backup()
    assert encrypted_bytes.startswith(b"gAAAAA")  # Fernet tokens start with gAAAAA

    # 2. Modify the data dir to simulate data loss or changes
    test_file = dummy_data_dir / "sqlite" / "dummy.txt"
    assert test_file.read_text() == "Hello Backup"
    
    test_file.unlink()
    assert not test_file.exists()

    # 3. Restore backup
    await restore_backup(encrypted_bytes)

    # 4. Verify data is back
    assert test_file.exists()
    assert test_file.read_text() == "Hello Backup"
    assert mock_execv.called


@pytest.mark.asyncio
async def test_backup_api_endpoints(auth_root_client, monkeypatch):
    """Test the download and upload HTTP routes."""
    # Mock the restore call so it doesn't actually restart the server in tests
    mock_restore = AsyncMock()
    monkeypatch.setattr("api.routes_backup.restore_backup", mock_restore)

    # Test Download
    resp = auth_root_client.get("/api/v1/admin/backup/download")
    assert resp.status_code == 200
    assert "application/octet-stream" in resp.headers["content-type"]
    assert "attachment; filename=" in resp.headers["content-disposition"]
    
    encrypted_bytes = resp.content
    assert len(encrypted_bytes) > 0

    # Test Upload with valid bytes
    files = {"file": ("phantom-backup-test.zip.enc", encrypted_bytes, "application/octet-stream")}
    resp_up = auth_root_client.post("/api/v1/admin/backup/upload", files=files)
    assert resp_up.status_code == 200
    assert resp_up.json()["status"] == "ok"

    # Wait for the async background task to run
    import asyncio
    await asyncio.sleep(1.5)
    
    mock_restore.assert_called_once_with(encrypted_bytes)


class AsyncMock(MagicMock):
    async def __call__(self, *args, **kwargs):
        return super(AsyncMock, self).__call__(*args, **kwargs)
