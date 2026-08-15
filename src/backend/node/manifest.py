"""Node manifest — the mesh honesty anchor (F0.3).

One Ed25519 keypair per node: the private key is persisted under the sanctioned
data dir (never in the repo), the public key is the node's stable identity. The
manifest advertises the capabilities declared in ``phantom_node.toml`` — that
file is the single source of truth and lists only what is wired end-to-end at
this commit (Laws 1 & 2). ``GET /node/manifest`` returns the manifest plus an
Ed25519 signature over its canonical form so a peer (the phone) can pin the key
and trust the advertisement before pairing.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from node.identity import key_path as _identity_key_path
from node.identity import load_or_create_key as _load_identity_key
from node.identity import public_hex as _identity_public_hex
from paths import REPO_ROOT, resolve_data_dir

_TOML_PATH = REPO_ROOT / "phantom_node.toml"
_KEY_NAME = "node_ed25519.key"


def _key_path() -> Path:
    return _identity_key_path()


def _load_or_create_key() -> Ed25519PrivateKey:
    return _load_identity_key()


def _public_hex(pub: Ed25519PublicKey) -> str:
    return _identity_public_hex(pub)


def _canonical(body: dict[str, Any]) -> bytes:
    return json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _read_declaration() -> dict[str, Any]:
    with _TOML_PATH.open("rb") as fh:
        data = tomllib.load(fh)
    caps = data.get("capabilities", {})
    return {
        "node": data.get("node", {}),
        # honesty: only truthy flags are advertised
        "capabilities": sorted(k for k, v in caps.items() if v is True),
    }


def build_manifest() -> dict[str, Any]:
    """Return the Ed25519-signed node manifest (JSON-serialisable dict)."""
    key = _load_or_create_key()
    pub_hex = _public_hex(key.public_key())
    decl = _read_declaration()
    node = decl["node"]
    body: dict[str, Any] = {
        "id": hashlib.sha256(bytes.fromhex(pub_hex)).hexdigest()[:16],
        "name": node.get("name", "PHANTOM"),
        "role": node.get("role", "node"),
        "platform": node.get("platform", "unknown"),
        "schema": node.get("schema", 1),
        "capabilities": decl["capabilities"],
        "public_key": pub_hex,
        "alg": "ed25519",
    }
    return {**body, "signature": key.sign(_canonical(body)).hex()}


def verify_manifest(manifest: dict[str, Any]) -> bool:
    """Verify a manifest's Ed25519 self-signature (peer-side parity check)."""
    sig = manifest.get("signature")
    pub_hex = manifest.get("public_key")
    if not sig or not pub_hex:
        return False
    body = {k: v for k, v in manifest.items() if k != "signature"}
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub_hex)).verify(
            bytes.fromhex(sig), _canonical(body)
        )
        return True
    except Exception:
        return False
