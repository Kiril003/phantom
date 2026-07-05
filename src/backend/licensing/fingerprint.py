"""Stable device fingerprint: machine-id + SoC serial, hashed.

Falls back to a persisted random id so containers/dev boards without
/etc/machine-id still get a stable identity.
"""
from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path

FALLBACK_ID_FILE = Path(os.environ.get("PHANTOM_DEVICE_ID_FILE", "~/.phantom/device-id")).expanduser()


def _machine_id() -> str:
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            content = Path(path).read_text().strip()
            if content:
                return content
        except OSError:
            continue
    FALLBACK_ID_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not FALLBACK_ID_FILE.exists():
        FALLBACK_ID_FILE.write_text(uuid.uuid4().hex)
        FALLBACK_ID_FILE.chmod(0o600)
    return FALLBACK_ID_FILE.read_text().strip()


def _soc_serial() -> str:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.lower().startswith("serial"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return ""


def device_fingerprint() -> str:
    material = f"phantom:{_machine_id()}:{_soc_serial()}"
    return hashlib.sha256(material.encode()).hexdigest()
