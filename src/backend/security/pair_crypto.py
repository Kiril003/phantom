"""Phase 19 Mobile Companion — pairing crypto primitives.

Implements `docs/MOBILE_COMPANION.md` §4 protocol:

  1. Server generates ephemeral X25519 keypair `(s_priv, s_pub)` per pair
     attempt and stashes it in an in-memory `PairingSession` with a 60 s
     TTL. Server emits the QR payload (server pubkey + nonce + cert pin).

  2. Phone scans QR, generates its own ephemeral X25519 `(c_priv, c_pub)`
     and a long-term Ed25519 device keypair (kept in Android Keystore).
     Phone derives the shared secret K via ECDH(c_priv, s_pub) → HKDF.
     Phone proves possession by sending HMAC-SHA256(K, pair_id || device_pub).

  3. Server reproduces ECDH(s_priv, c_pub) → HKDF, verifies the HMAC,
     persists `PairedDevice`, returns a device JWT plus a server proof
     HMAC-SHA256(K, device_jwt) that the phone can verify.

  4. Approve-on-phone challenges later use the device's Ed25519 long-term
     pubkey: server sends `request_id || nonce || verdict_template`,
     phone signs `nonce || verdict_string`, server verifies via Ed25519.

This module is pure crypto + an in-memory session store. NO database access,
NO FastAPI types — so it stays trivially unit-testable and audit-readable on
one screen. The route layer (`api/routes_pair.py`) wires it to HTTP / DB /
WebSocket broadcast.

Threat model & rationale:
  * Ephemeral X25519: forward-secrecy for the pairing exchange. A future
    leak of `config.jwt_secret_key` does not retroactively let an attacker
    decrypt the proof.
  * Long-term Ed25519: stable identity for approve-on-phone signatures.
    Lives in Android Keystore (StrongBox if present) per design §9.
  * HKDF with QR-nonce salt: ties the derived key to a specific pairing
    attempt, so replaying an old `claim` body fails (server's session for
    that nonce is one-shot and TTL'd).
  * 60 s TTL: physical-presence assumption. Operator must scan the QR within
    one minute or the session expires and pairing must restart.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

__all__ = [
    "PAIR_TTL_SECONDS",
    "MeshBlock",
    "mesh_tail",
    "PairingError",
    "PairingSession",
    "PairingSessionStore",
    "session_store",
    "build_qr_payload",
    "derive_shared_key",
    "verify_client_proof",
    "build_server_proof",
    "verify_device_signature",
    "encode_pubkey_b64",
    "b64_decode",
]


# Physical-presence assumption (operator scans QR within this window).
# Було 60 с — і цього не вистачає на «взяти телефон, розблокувати, знайти
# екран сканера»: QR тихо протухав, а паринг виглядав як поломка. Три
# хвилини так само вимагають фізичної присутності, але не женуть людину.
PAIR_TTL_SECONDS: int = 180

# HKDF parameters — domain-separated from PII encryption (`security/crypto.py`)
# so a leak in one path can't be repurposed for the other.
# Байт-у-байт як `PairProofs.HKDF_INFO` у телефоні (core-net/PairProofs.kt).
# Рядки розійшлись регістром і дефісом — ключі виходили різні, і КОЖЕН
# claim падав у bad_proof. Обидва файли про це попереджали; тест нижче
# тепер прибиває значення, щоб розбіжність не поїхала знову.
_HKDF_INFO = b"PHANTOM OS/mobile-pair-v1"


class PairingError(ValueError):
    """Raised on protocol-level failures (bad nonce, expired session, bad
    proof). Route layer turns this into HTTP 400 with a stable error code.
    """

    def __init__(self, message: str, *, code: str = "pair_error") -> None:
        super().__init__(message)
        self.code = code


# ── Session storage ──────────────────────────────────────────────────────────


@dataclass
class PairingSession:
    """One in-flight pairing attempt. Server-private fields never leave RAM.

    `created_by_user_id` is the ROOT operator who initiated `pair/init` — that
    user becomes the owner of the resulting `PairedDevice`. The phone does not
    pick the user; physical-presence at the desktop assigns it.
    """

    pair_id: str
    server_priv: x25519.X25519PrivateKey
    server_pub_b64: str
    nonce_b64: str
    nonce_bytes: bytes
    created_by_user_id: str
    # Короткий код для входу без камери: телефон знаходить вузол по mDNS і
    # питає `/pair/resolve/{pin}`. Живе рівно стільки ж, скільки сесія.
    pin: str = ""
    created_at: float = field(default_factory=time.monotonic)
    claimed: bool = False

    def is_expired(self, now: Optional[float] = None) -> bool:
        now = now if now is not None else time.monotonic()
        return (now - self.created_at) > PAIR_TTL_SECONDS


class PairingSessionStore:
    """Thread-safe, memory-only pairing session store with TTL eviction.

    Memory-only by design (per docs/MOBILE_COMPANION.md §4): the server
    private key MUST NOT touch disk. A daemon restart cancels every
    in-flight pairing — acceptable because the operator just rescans.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, PairingSession] = {}
        self._lock = threading.Lock()

    def create(self, *, created_by_user_id: str) -> PairingSession:
        priv = x25519.X25519PrivateKey.generate()
        pub_bytes = priv.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        nonce = os.urandom(24)
        pair_id = secrets.token_hex(16)
        session = PairingSession(
            pair_id=pair_id,
            server_priv=priv,
            server_pub_b64=base64.b64encode(pub_bytes).decode("ascii"),
            nonce_b64=base64.b64encode(nonce).decode("ascii"),
            nonce_bytes=nonce,
            created_by_user_id=created_by_user_id,
            pin=f"{secrets.randbelow(10**8):08d}",
        )
        with self._lock:
            # Opportunistic prune so the store cannot grow unbounded if many
            # operators init pairings without ever claiming.
            self._prune_locked()
            self._sessions[pair_id] = session
        return session

    def get(self, pair_id: str) -> Optional[PairingSession]:
        with self._lock:
            session = self._sessions.get(pair_id)
            if session is None:
                return None
            if session.is_expired():
                self._sessions.pop(pair_id, None)
                return None
            return session

    def get_by_pin(self, pin: str) -> Optional[PairingSession]:
        with self._lock:
            self._prune_locked()
            for session in self._sessions.values():
                if session.pin and secrets.compare_digest(session.pin, pin):
                    return session
            return None

    def consume(self, pair_id: str) -> Optional[PairingSession]:
        """Atomic single-shot fetch: removes the session before returning so
        a `claim` can never be replayed against the same pair_id."""
        with self._lock:
            session = self._sessions.pop(pair_id, None)
            if session is None:
                return None
            if session.is_expired():
                return None
            session.claimed = True
            return session

    def cancel(self, pair_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(pair_id, None) is not None

    def _prune_locked(self) -> None:
        now = time.monotonic()
        stale = [pid for pid, s in self._sessions.items() if s.is_expired(now)]
        for pid in stale:
            self._sessions.pop(pid, None)


session_store = PairingSessionStore()


# ── Protocol primitives ──────────────────────────────────────────────────────


def b64_decode(value: str, *, expected_len: Optional[int] = None) -> bytes:
    """URL-safe-friendly base64 decode that tolerates both standard and
    url-safe alphabets (Android sometimes emits the latter). Validates length
    when `expected_len` is given so callers don't have to repeat the check.
    """
    if value is None:
        raise PairingError("missing base64 value", code="bad_payload")
    try:
        # Pad to multiple of 4 — accept compact base64 without trailing '='.
        padded = value + "=" * (-len(value) % 4)
        try:
            raw = base64.b64decode(padded, validate=True)
        except Exception:
            raw = base64.urlsafe_b64decode(padded)
    except Exception as exc:
        raise PairingError(f"invalid base64: {exc}", code="bad_payload") from exc
    if expected_len is not None and len(raw) != expected_len:
        raise PairingError(
            f"unexpected length: got {len(raw)} want {expected_len}",
            code="bad_payload",
        )
    return raw


def encode_pubkey_b64(public_key: x25519.X25519PublicKey | ed25519.Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(raw).decode("ascii")


def derive_shared_key(
    server_priv: x25519.X25519PrivateKey,
    client_pub_b64: str,
    nonce_bytes: bytes,
) -> bytes:
    """ECDH + HKDF — same K both sides compute. 32-byte output."""
    client_pub_raw = b64_decode(client_pub_b64, expected_len=32)
    try:
        client_pub = x25519.X25519PublicKey.from_public_bytes(client_pub_raw)
    except Exception as exc:
        raise PairingError("invalid client_pub", code="bad_payload") from exc
    shared = server_priv.exchange(client_pub)
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=nonce_bytes,
        info=_HKDF_INFO,
    ).derive(shared)


def _hmac(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()


@dataclass(frozen=True)
class MeshBlock:
    """Довічна СІТЬОВА особа сторони — не ключі паринга.

    Ключі паринга одноразові: X25519 живе один claim, Ed25519 підписує лише
    `/pair/refresh`. Адреси скриньок у сховку PH5 виводяться зовсім з іншої
    пари — довічних identity телефона й вузла. Доки цей блок не їхав у
    `mobile-pair-v1`, ані ПК, ані телефон не мали чим скласти спільний ключ
    каналу: обидва чесно рахували адреси, і адреси були різні. Мовчки.
    """

    peer_id: str
    pub_ed25519_b64: str
    dh_x25519_b64: str

    @property
    def is_complete(self) -> bool:
        return bool(
            (self.peer_id or "").strip()
            and (self.pub_ed25519_b64 or "").strip()
            and (self.dh_x25519_b64 or "").strip()
        )


def mesh_tail(mesh: Optional[MeshBlock]) -> bytes:
    """Хвіст, яким сітьові ключі прив'язані до цього паринга.

    Порожній, коли блоку немає, — саме тому телефон попередньої збірки
    лишається сумісним. А відщипнути блок від запиту нової збірки не вийде:
    телефон уже підписав довге повідомлення, і без полів доказ не зійдеться.

    Байт-у-байт як `PairProofs.meshTail` (core-net/pair/PairProofs.kt).
    """
    if mesh is None or not mesh.is_complete:
        return b""
    return (
        mesh.peer_id.encode("utf-8")
        + b64_decode(mesh.pub_ed25519_b64, expected_len=32)
        + b64_decode(mesh.dh_x25519_b64, expected_len=32)
    )


def verify_client_proof(
    *,
    shared_key: bytes,
    pair_id: str,
    device_pub_ed25519_b64: str,
    proof_b64: str,
    mesh: Optional[MeshBlock] = None,
) -> None:
    """Constant-time-compare the phone's HMAC over `pair_id || device_pub`.

    Raises `PairingError` on mismatch with a stable code so the route layer
    can return HTTP 400 and the operator UI can show "QR scan looked tampered
    with — try again".
    """
    expected = _hmac(
        shared_key,
        pair_id.encode("utf-8")
        + b64_decode(device_pub_ed25519_b64, expected_len=32)
        + mesh_tail(mesh),
    )
    actual = b64_decode(proof_b64, expected_len=32)
    if not hmac.compare_digest(expected, actual):
        raise PairingError("client proof mismatch", code="bad_proof")


def build_server_proof(
    *,
    shared_key: bytes,
    device_jwt: str,
    node: Optional[MeshBlock] = None,
) -> str:
    """HMAC server emits so the phone can confirm it's talking to the same
    server it ECDH'd with (defense-in-depth on top of cert-pinning).

    Ключі вузла всередині доказу, а не поруч із ним: інакше посередник
    підмінив би сітьовий ключ ПК, телефон склав би адресу з чужим ключем і
    чесно писав би у скриньку, якої вузол ніколи не назве.
    """
    return base64.b64encode(
        _hmac(shared_key, device_jwt.encode("utf-8") + mesh_tail(node))
    ).decode("ascii")


def verify_device_signature(
    *,
    device_pub_ed25519_b64: str,
    message: bytes,
    signature_b64: str,
) -> None:
    """Verify an Ed25519 signature from a paired device (used by approve-on-
    phone). Raises `PairingError` on any failure.
    """
    pub_raw = b64_decode(device_pub_ed25519_b64, expected_len=32)
    sig_raw = b64_decode(signature_b64)
    try:
        ed25519.Ed25519PublicKey.from_public_bytes(pub_raw).verify(sig_raw, message)
    except InvalidSignature as exc:
        raise PairingError("signature invalid", code="bad_signature") from exc
    except Exception as exc:
        raise PairingError(f"signature verify failed: {exc}", code="bad_signature") from exc


# ── QR payload builder (called by the route layer) ───────────────────────────


def build_qr_payload(
    session: PairingSession,
    *,
    host: str,
    ip: str,
    port: int,
    cert_sha256_hex: str,
    endpoints: Optional[list[dict]] = None,
) -> dict:
    """JSON shape the desktop renders into a QR (per design §4)."""
    payload = {
        "v": 1,
        "host": host,
        "ip": ip,
        "port": port,
        "pair_id": session.pair_id,
        "server_pub": session.server_pub_b64,
        "server_cert_sha256": cert_sha256_hex,
        "exp": int(time.time()) + PAIR_TTL_SECONDS,
        "nonce": session.nonce_b64,
    }
    if endpoints:
        payload["v"] = 2
        payload["endpoints"] = endpoints
    return payload
