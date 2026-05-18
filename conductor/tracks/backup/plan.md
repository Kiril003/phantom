# A-1: Encrypted Backup & Restore Wizard

## Objective
Implement an operator-facing path to bundle chat history, vector memory (ChromaDB), standing orders, and configuration into an encrypted archive (`phantom-backup-<ts>.zip.enc`), and provide a mechanism to restore it. 

## Key Files & Context
- **Backend Service**: `src/backend/tools/backup_service.py` (new) — handles zip creation, Fernet encryption, and restore/wipe logic.
- **Backend API**: `src/backend/api/routes_admin.py` — expose `/api/v1/admin/backup/create` and `/api/v1/admin/backup/restore` endpoints.
- **Frontend UI**: `src/frontend/src/components/settings/BackupRestoreCard.tsx` (new) — the UI card for the Settings panel.
- **Frontend Settings**: `src/frontend/src/components/settings/SettingsPanel.tsx` — mount the new card.

## Implementation Steps

### 1. Backend Service (`backup_service.py`)
- Create a service that locates the `data/` directory (containing `phantom.db` and `chroma/`).
- **Create Backup**: Zip the `data/` directory and `.env` file into a byte stream. Encrypt the entire zip file using the existing `CRYPTO-1` Fernet key (`security.crypto._fernet()`).
- **Restore Backup**: Receive an encrypted byte stream, decrypt using `_fernet()`, extract the contents into a temporary directory. Stop database connections (or require a reboot), replace the `data/` directory and `.env`, and schedule a graceful restart.

### 2. Backend API
- Add `GET /api/v1/admin/backup/download` to generate and stream the `phantom-backup-<timestamp>.zip.enc` file.
- Add `POST /api/v1/admin/backup/upload` to accept a file upload and trigger the restore process.

### 3. Frontend UI (`BackupRestoreCard.tsx`)
- Create a new Settings card under a "Дані та Безпека" (Data & Security) section.
- **Download Button**: Triggers the download of the encrypted backup file.
- **Upload Dropzone/Button**: Allows selecting a `.zip.enc` file. Prompts with a severe warning ("Restoring will overwrite all current data and restart the system").
- Show loading states during backup generation and restoration.

### 4. Integration
- Add `BackupRestoreCard` to `SettingsPanel.tsx`.

## Verification & Testing
- Create a round-trip test `tests/test_phase_backup.py`.
- Seed data into SQLite and ChromaDB.
- Generate a backup.
- Wipe local data.
- Restore from the backup.
- Assert that the data is successfully restored and intact.
- Verify that Fernet key derivation allows a backup made with `JWT_SECRET_KEY` "A" to be restored on a fresh device initialized with `JWT_SECRET_KEY` "A".