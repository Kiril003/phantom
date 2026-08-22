"""mDNS / DNS-SD service advertiser.

Publishes a `_phantom._tcp.local.` service descriptor so PHANTOM
Companion phones on the same Wi-Fi can find this backend without
scanning a QR. The phone-side discoverer is `MdnsPlugin.kt` (Kotlin
NsdManager wrapper) — it picks up the broadcast, surfaces the
host as a tap-to-pair entry on the pairing screen, and routes the
operator's claim through the regular `/pair/claim` flow.

Why this matters: the QR carries a snapshot of the backend's IP at
the moment it was generated. When the operator moves between
networks (school → home → cafe), that IP no longer reaches uvicorn.
With mDNS in the loop, the phone simply re-discovers phantom-os on
each Wi-Fi join + offers the fresh URL.

Implementation notes:
  * `python-zeroconf` (already pinned at 0.148+ via the install
    bundle) advertises ipv4 + ipv6 addresses for every interface
    that's up. Avahi-style `link-local` rewriting is automatic.
  * On hosts where multicast is firewalled (Docker bridge networks,
    enterprise APs) the publication call won't error — it just
    silently fails to reach phones. We log + continue so the
    backend stays bootable.
  * Hostnames must end with `.local.` — Avahi rejects bare names.
    The instance-name (`PHANTOM <user>`) is a friendly label the
    Kotlin plugin surfaces verbatim in PairingScreen.

Lifespan: caller imports `start_mdns()` + `stop_mdns()` and wires
them into the FastAPI lifespan. Startup is non-blocking; the publisher
runs entirely in zeroconf's own thread.
"""
from __future__ import annotations

import logging
import os
import socket
from typing import Optional

logger = logging.getLogger(__name__)

# Module-level handle so lifespan can stop cleanly on shutdown.
_publisher: Optional["MdnsPublisher"] = None


class MdnsPublisher:
    """Wraps `zeroconf.Zeroconf.register_service`. Lazy import so
    the package stays optional — if zeroconf isn't installed the
    backend still boots and logs a warning."""

    def __init__(self, port: int, instance_name: str = "PHANTOM"):
        self.port = port
        self.instance_name = instance_name
        self._zc = None
        self._info = None

    def start(self) -> bool:
        try:
            from zeroconf import IPVersion, ServiceInfo, Zeroconf
        except ImportError:
            logger.warning(
                "mdns: python-zeroconf not installed; phones will not auto-discover this host. "
                "`pip install zeroconf` to enable.",
            )
            return False

        # Use the machine hostname; fall back to a stable label when
        # `gethostname()` returns a non-DNS-friendly bytes blob.
        hostname = socket.gethostname() or "phantom-os"
        # Avahi/Bonjour requires `.local.` at the end of the FQDN.
        fqdn = (
            hostname
            if hostname.endswith(".local.")
            else f"{hostname.split('.')[0]}.local."
        )

        try:
            self._zc = Zeroconf(ip_version=IPVersion.V4Only)
        except OSError as exc:
            # Multicast may be blocked (e.g. Docker default bridge).
            logger.warning("mdns: Zeroconf init failed: %s", exc)
            return False

        self._info = ServiceInfo(
            type_="_phantom._tcp.local.",
            name=f"{self.instance_name}._phantom._tcp.local.",
            port=self.port,
            server=fqdn,
            # Properties are visible to the phone-side resolver as
            # bytes-keyed dict entries. Keep them small + descriptive
            # so future client versions can route on capabilities
            # without bumping the service-type.
            properties={
                b"version": b"1",
                b"app": b"phantom-os",
            },
        )
        try:
            self._zc.register_service(self._info)
        except Exception as exc:
            logger.warning("mdns: register_service failed: %s", exc)
            try:
                self._zc.close()
            finally:
                self._zc = None
                self._info = None
            return False

        logger.info(
            "mdns: announced %s as %s on port %d",
            self._info.name,
            fqdn,
            self.port,
        )
        return True

    def stop(self) -> None:
        if self._zc is not None and self._info is not None:
            try:
                self._zc.unregister_service(self._info)
            except Exception:
                pass
        if self._zc is not None:
            try:
                self._zc.close()
            except Exception:
                pass
        self._zc = None
        self._info = None


def start_mdns(port: int, instance_name: str = "PHANTOM") -> bool:
    """Start the global publisher. Idempotent — calling twice is a
    no-op (returns True if already running).

    PHANTOM_SKIP_MDNS=1 вимикає оголошення повністю. Причина (Ф0): на
    одній машині живе кілька бекендів (спільне дерево на 8000, worktree
    на 8010) — обидва оголошували б однаковий `_phantom._tcp`, і
    телефонний one-shot скан брав би першого, хто відповів. Стендові
    інстанси мовчать; сам механізм не чіпаємо — Ф3 поверне його з
    розрізненим ім'ям інстанса."""
    if os.environ.get("PHANTOM_SKIP_MDNS") == "1":
        logger.info("mdns: оголошення вимкнено (PHANTOM_SKIP_MDNS=1)")
        return False
    global _publisher
    if _publisher is not None:
        return True
    pub = MdnsPublisher(port=port, instance_name=instance_name)
    if pub.start():
        _publisher = pub
        return True
    return False


def stop_mdns() -> None:
    """Stop the global publisher. Safe to call without `start_mdns`."""
    global _publisher
    if _publisher is None:
        return
    _publisher.stop()
    _publisher = None
