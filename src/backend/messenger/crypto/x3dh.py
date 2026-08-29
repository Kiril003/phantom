"""X3DH: ініціатор і отримувач сходяться на спільному секреті без раунду в ефір.

Ініціатор бере опублікований bundle і рахує секрет одразу — отримувач може
бути офлайн. Чотири DH, а не один, бо кожен закриває свою дірку: DH(IK_a,SPK_b)
автентифікує ініціатора, DH(EK_a,IK_b) — отримувача, DH(EK_a,SPK_b) дає
forward secrecy, DH(EK_a,OPK_b) — захист від повтору того самого першого
повідомлення після компрометації signed prekey.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from messenger.crypto.keys import (
    IDENTITY_DH_CONTEXT,
    KEY_LEN,
    KeyStore,
    MessengerKeyError,
    PublicBundle,
    load_ed25519_public,
    load_x25519_public,
    x25519_public_raw,
)

__all__ = [
    "AgreedSecret",
    "InitialMessage",
    "X3DH_INFO",
    "X3DHError",
    "associated_data",
    "initiate",
    "respond",
]

X3DH_INFO = b"PHANTOM OS/messenger-x3dh-v1"
SECRET_LEN = 32

# Префікс із одиничних байтів — доменний розділювач X3DH для кривої X25519:
# він не дає переплутати вхід HKDF з жодним іншим DH-конкатом у системі.
_CURVE_PREFIX = b"\xff" * KEY_LEN
_HKDF_SALT = b"\x00" * 32


class X3DHError(MessengerKeyError):
    """Узгодження не відбулось: підпис, ключ або prekey не сходяться."""


@dataclass(frozen=True)
class InitialMessage:
    """Преамбула першого повідомлення — усе, що потрібно отримувачу для X3DH."""

    identity_ed: bytes
    identity_dh: bytes
    identity_dh_sig: bytes
    ephemeral: bytes
    signed_prekey_id: int
    one_time_prekey_id: Optional[int] = None


@dataclass(frozen=True)
class AgreedSecret:
    secret: bytes
    associated_data: bytes


def associated_data(
    initiator_ed: bytes,
    initiator_dh: bytes,
    responder_ed: bytes,
    responder_dh: bytes,
) -> bytes:
    """AD прибиває обидві особи до кожного шифротексту сесії.

    Обидва identity-ключі, а не лише DH: підміна Ed25519 теж мусить ламати
    розшифрування, інакше зловмисник міг би переприписати чужий DH собі.
    """
    return initiator_ed + initiator_dh + responder_ed + responder_dh


def _dh(private: X25519PrivateKey, public: X25519PublicKey) -> bytes:
    try:
        return private.exchange(public)
    except ValueError as exc:
        raise X3DHError("X25519-обмін відхилено (вироджена точка)") from exc


def _derive(chunks: list[bytes]) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=SECRET_LEN,
        salt=_HKDF_SALT,
        info=X3DH_INFO,
    ).derive(_CURVE_PREFIX + b"".join(chunks))


def _verify_identity_dh(identity_ed: bytes, identity_dh: bytes, sig: bytes) -> None:
    try:
        ed = load_ed25519_public(identity_ed)
    except MessengerKeyError as exc:
        raise X3DHError(str(exc)) from exc
    if not isinstance(sig, (bytes, bytearray)) or len(sig) != 64:
        raise X3DHError("підпис identity-DH мусить бути 64 байти")
    try:
        ed.verify(bytes(sig), IDENTITY_DH_CONTEXT + identity_dh)
    except InvalidSignature as exc:
        raise X3DHError("identity-DH не підписаний заявленим Ed25519") from exc


def initiate(
    store: KeyStore,
    bundle: PublicBundle,
    expected_node_id: Optional[str] = None,
) -> tuple[AgreedSecret, InitialMessage]:
    """Бік, який починає розмову. Кидає UntrustedBundle, якщо bundle підмінили."""
    bundle.verify(expected_node_id)

    ephemeral = X25519PrivateKey.generate()
    responder_identity = load_x25519_public(bundle.identity_dh)
    responder_signed = load_x25519_public(bundle.signed_prekey)

    chunks = [
        _dh(store.identity_dh_private, responder_signed),
        _dh(ephemeral, responder_identity),
        _dh(ephemeral, responder_signed),
    ]
    if bundle.one_time_prekey is not None:
        chunks.append(_dh(ephemeral, load_x25519_public(bundle.one_time_prekey)))

    agreed = AgreedSecret(
        secret=_derive(chunks),
        associated_data=associated_data(
            store.identity_ed_public,
            store.identity_dh_public,
            bundle.identity_ed,
            bundle.identity_dh,
        ),
    )
    initial = InitialMessage(
        identity_ed=store.identity_ed_public,
        identity_dh=store.identity_dh_public,
        identity_dh_sig=store.identity_dh_signature,
        ephemeral=x25519_public_raw(ephemeral),
        signed_prekey_id=bundle.signed_prekey_id,
        one_time_prekey_id=bundle.one_time_prekey_id,
    )
    return agreed, initial


def respond(store: KeyStore, initial: InitialMessage) -> AgreedSecret:
    """Бік, який приймає розмову. Одноразовий prekey тут не витрачається.

    Витрата — справа виклику вище: поки шифротекст не відкрився, ми не знаємо,
    чи це справжній ініціатор, а спалений prekey вже не повернути.
    """
    _verify_identity_dh(
        initial.identity_ed, initial.identity_dh, initial.identity_dh_sig
    )

    signed_private = store.signed_prekey_private(initial.signed_prekey_id)
    initiator_identity = load_x25519_public(initial.identity_dh)
    ephemeral = load_x25519_public(initial.ephemeral)

    chunks = [
        _dh(signed_private, initiator_identity),
        _dh(store.identity_dh_private, ephemeral),
        _dh(signed_private, ephemeral),
    ]
    if initial.one_time_prekey_id is not None:
        one_time = store.one_time_private(initial.one_time_prekey_id)
        chunks.append(_dh(one_time, ephemeral))

    return AgreedSecret(
        secret=_derive(chunks),
        associated_data=associated_data(
            initial.identity_ed,
            initial.identity_dh,
            store.identity_ed_public,
            store.identity_dh_public,
        ),
    )
