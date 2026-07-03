"""Node manifest route — the mesh honesty anchor (F0.3).

Unauthenticated by design: a peer must read the node's identity and capability
advertisement BEFORE pairing. Returns the Ed25519-signed manifest; capabilities
reflect only what is wired end-to-end at this commit (Laws 1 & 2).
"""
from __future__ import annotations

from fastapi import APIRouter

from node.manifest import build_manifest

router = APIRouter(prefix="/node", tags=["node"])


@router.get("/manifest")
async def get_node_manifest() -> dict:
    return build_manifest()
