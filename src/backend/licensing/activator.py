"""Talks to the PHANTOM license server to bind this device to a license key."""
from __future__ import annotations

import os

import httpx

from licensing.fingerprint import device_fingerprint
from licensing.verifier import (
    LicenseStatus,
    license_status,
    remove_certificate,
    store_certificate,
    verify_certificate,
)

DEFAULT_SERVER = os.environ.get("PHANTOM_LICENSE_SERVER", "https://license.phantom-os.io")


class ActivationError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


async def activate(license_key: str, device_name: str = "phantom-os") -> LicenseStatus:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                f"{DEFAULT_SERVER}/api/activate",
                json={
                    "license_key": license_key.strip(),
                    "device_fingerprint": device_fingerprint(),
                    "device_name": device_name,
                },
            )
        except httpx.HTTPError as exc:
            raise ActivationError(f"license server unreachable: {exc}") from exc
    if resp.status_code != 200:
        detail = resp.json().get("detail", resp.text) if resp.content else str(resp.status_code)
        raise ActivationError(detail, status_code=resp.status_code)

    cert = resp.json()["certificate"]
    if not verify_certificate(cert):
        raise ActivationError("server returned certificate with untrusted signature")
    store_certificate(cert)
    return license_status()


async def deactivate(license_key: str) -> None:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            await client.post(
                f"{DEFAULT_SERVER}/api/deactivate",
                json={
                    "license_key": license_key.strip(),
                    "device_fingerprint": device_fingerprint(),
                },
            )
        except httpx.HTTPError:
            pass  # local removal still frees this device; server slot reconciles on next contact
    remove_certificate()


async def revalidate() -> dict:
    status = license_status()
    if not status.valid:
        return {"checked": False, "status": status.as_dict()}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(
                f"{DEFAULT_SERVER}/api/validate",
                json={
                    "license_id": status.license_id,
                    "cert_serial": status.serial,
                    "device_fingerprint": status.fingerprint,
                },
            )
            data = resp.json()
        except (httpx.HTTPError, ValueError):
            return {"checked": False, "status": status.as_dict()}
    if data.get("revoked"):
        remove_certificate()
        return {"checked": True, "status": license_status().as_dict()}
    return {"checked": True, "status": status.as_dict()}
