"""Phase 19 Mobile Companion — paired_devices + mobile_sensor_batches +
mobile_approval_requests tables.

Idempotent: each statement uses CREATE TABLE / CREATE INDEX IF NOT EXISTS,
mirroring the rest of PHANTOM's bootstrap-time migration approach. Safe on
fresh DBs (Base.metadata.create_all already declares the same shape) and
re-runs (PRAGMA introspection short-circuits).

The shapes here MUST stay byte-equivalent to the SQLAlchemy ORM declarations
in `db/models.py` — column order / nullability / types match. Adding a new
column to either the ORM or this migration without updating the other will
desync the schema between fresh installs and upgraded ones.
"""
from __future__ import annotations

from sqlalchemy import text


_TABLE_DDL = {
    "paired_devices": """
        CREATE TABLE IF NOT EXISTS paired_devices (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_name VARCHAR(128) NOT NULL DEFAULT '',
            device_model VARCHAR(128) NOT NULL DEFAULT '',
            platform VARCHAR(16) NOT NULL DEFAULT 'android',
            platform_version VARCHAR(32),
            device_pub_ed25519 VARCHAR(128) NOT NULL,
            paired_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL,
            revoked_at DATETIME,
            revoked_by VARCHAR(36),
            revoked_reason VARCHAR(256),
            capabilities_json TEXT NOT NULL DEFAULT '[]'
        )
    """,
    "mobile_sensor_batches": """
        CREATE TABLE IF NOT EXISTS mobile_sensor_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id VARCHAR(36) NOT NULL REFERENCES paired_devices(id) ON DELETE CASCADE,
            user_id VARCHAR(36) NOT NULL,
            received_at DATETIME NOT NULL,
            device_ts_ms INTEGER NOT NULL DEFAULT 0,
            gps_lat REAL,
            gps_lon REAL,
            gps_accuracy_m REAL,
            motion_class VARCHAR(24),
            mic_rms REAL,
            body_bpm REAL,
            body_hrv REAL,
            ble_json TEXT NOT NULL DEFAULT '[]',
            wifi_json TEXT NOT NULL DEFAULT '[]'
        )
    """,
    "mobile_approval_requests": """
        CREATE TABLE IF NOT EXISTS mobile_approval_requests (
            id VARCHAR(36) PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL,
            device_id VARCHAR(36),
            task_id VARCHAR(36),
            action_name VARCHAR(64) NOT NULL,
            risk_level INTEGER NOT NULL DEFAULT 5,
            payload_json TEXT NOT NULL DEFAULT '{}',
            summary VARCHAR(512) NOT NULL DEFAULT '',
            nonce_b64 VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            verdict VARCHAR(16),
            signature_b64 VARCHAR(256),
            created_at DATETIME NOT NULL,
            expires_at DATETIME NOT NULL,
            resolved_at DATETIME
        )
    """,
}

_INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS ix_paired_devices_user ON paired_devices (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_paired_devices_active ON paired_devices (user_id, revoked_at)",
    "CREATE INDEX IF NOT EXISTS ix_mobile_sensor_batches_device_ts "
    "ON mobile_sensor_batches (device_id, received_at)",
    "CREATE INDEX IF NOT EXISTS ix_mobile_sensor_batches_user "
    "ON mobile_sensor_batches (user_id)",
    "CREATE INDEX IF NOT EXISTS ix_mobile_approval_pending "
    "ON mobile_approval_requests (user_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_mobile_approval_task "
    "ON mobile_approval_requests (task_id)",
]


async def apply(conn) -> None:
    for ddl in _TABLE_DDL.values():
        await conn.execute(text(ddl))
    for ddl in _INDEX_DDL:
        await conn.execute(text(ddl))
