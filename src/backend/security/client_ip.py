"""XFF-aware client-IP resolution, shared by every per-IP gate.

Day-3 D3-A-2 landed this logic for the login lockout in
``api/routes_auth.py``. It lives here so the SaaS rate limiter — which had
the same reverse-proxy blind spot — resolves callers identically instead of
carrying a second, weaker copy.

Out of the box ``request.client.host`` is the immediate TCP peer. Behind a
reverse proxy (Caddy / Traefik / k8s ingress) that peer is always the proxy,
so any per-IP gate collapses every remote caller into a single key: a
system-wide DoS amplifier, and a no-op against the actual offender.
"""
from __future__ import annotations

from fastapi import Request


def resolve_client_ip(request: Request) -> str:
    """Return the caller's IP, honouring ``X-Forwarded-For`` when trusted.

    When ``security_trust_xff`` is False (default), the immediate TCP peer is
    the only thing we trust. When enabled AND the immediate peer is in
    ``security_trusted_proxies``, we walk ``X-Forwarded-For`` right-to-left and
    return the first IP that is NOT itself a trusted proxy. That's the standard
    reverse-proxy resolution: a chain ``client, edge_proxy, internal_proxy``
    lands as ``client`` once every hop on the right is trusted.

    Returns ``"unknown"`` only when there's no usable peer info at all —
    testing seam, never reached in production.
    """
    client = request.client
    direct = client.host if (client and client.host) else None
    if not direct:
        return "unknown"

    from config import config
    if not config.security_trust_xff:
        return direct
    trusted = set(config.security_trusted_proxies or [])
    if direct not in trusted:
        # Immediate peer isn't a configured proxy — XFF is therefore
        # unreliable (could be spoofed by the peer). Fall through to the
        # direct peer; the gate still keys on what we actually observed.
        return direct
    xff = request.headers.get("x-forwarded-for")
    if not xff:
        return direct
    # XFF: "client, proxy1, proxy2"  (left = original, right = closest)
    candidates = [c.strip() for c in xff.split(",") if c.strip()]
    for ip in reversed(candidates):
        if ip not in trusted:
            return ip
    # All hops are trusted — degenerate chain; treat as direct.
    return direct
