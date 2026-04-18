"""Network actions — net.scan (basic ping sweep + tcp port check)."""
from __future__ import annotations

import asyncio
import ipaddress
import time
from typing import ClassVar

from pydantic import Field

from ..schemas import ActionResult, Precondition, RiskLevel
from .base import Action, ActionContext

_FIXED_PORTS = [
    21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587,
    993, 995, 3000, 3306, 5000, 5432, 6379, 8080, 8443,
]


async def _ping_one(host: str, sem: asyncio.Semaphore) -> str | None:
    async with sem:
        try:
            proc = await asyncio.create_subprocess_exec(
                "ping", "-c", "1", "-W", "1", host,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            rc = await proc.wait()
            return host if rc == 0 else None
        except FileNotFoundError:
            return None


async def _check_port(host: str, port: int) -> bool:
    try:
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=1.0)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


class NetScan(Action):
    name: ClassVar[str] = "net.scan"
    risk_level: ClassVar[RiskLevel] = RiskLevel.SAFE

    subnet: str = Field(..., description="CIDR (basic) or single host (ports)")
    mode: str = Field(default="basic", description="'basic' = ping sweep, 'ports' = tcp scan")

    def preconditions(self) -> list[Precondition]:
        return [Precondition(key="network.online", required=None, failure_mode="abandon")]

    async def execute(self, ctx: ActionContext) -> ActionResult:
        t0 = time.monotonic()
        if self.mode == "basic":
            try:
                net = ipaddress.ip_network(self.subnet, strict=False)
            except ValueError as exc:
                return ActionResult(
                    ok=False, error=f"bad_subnet: {exc}",
                    error_class="bad_subnet",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            if net.prefixlen < 24:
                return ActionResult(
                    ok=False,
                    error="basic mode caps at /24",
                    error_class="too_wide",
                    elapsed_ms=int((time.monotonic() - t0) * 1000),
                )
            sem = asyncio.Semaphore(32)
            hosts = [str(h) for h in net.hosts()]
            results = await asyncio.gather(*[_ping_one(h, sem) for h in hosts])
            alive = [h for h in results if h is not None]
            return ActionResult(
                ok=True,
                output={"mode": "basic", "subnet": str(net), "alive": alive, "scanned": len(hosts)},
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        if self.mode == "ports":
            host = self.subnet.strip()
            try:
                ipaddress.ip_address(host)
            except ValueError:
                # Allow hostnames too
                pass
            open_ports: list[int] = []
            for port in _FIXED_PORTS:
                if await _check_port(host, port):
                    open_ports.append(port)
                await asyncio.sleep(0.1)  # 100ms rate-limit per spec
            return ActionResult(
                ok=True,
                output={"mode": "ports", "host": host, "open": open_ports, "checked": _FIXED_PORTS},
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )

        return ActionResult(
            ok=False, error=f"unknown_mode: {self.mode}",
            error_class="bad_args",
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
