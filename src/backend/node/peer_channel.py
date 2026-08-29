"""Ключ каналу PH4 і ім'я вузла у просторі імен телефона.

Навіщо це поруч із `peer_relay.py`. Адреси скриньок сховка виводяться з ключа
ПАРИ, а ключ пари на телефоні — це саме те, що рахує `PeerChannel.derive`
(PeerChannel.kt). Доки ПК не вміє вивести його байт-у-байт, PH5 у нас
працює «сам із собою»: обидва боки чесно рахують адреси, різні, і обидва
бачать порожню скриньку. Мовчки.

ДЖЕРЕЛО ПРАВДИ — ТЕЛЕФОН. Контракт підтверджено з коду 29.08.2026:
  PeerChannel.kt:41  shared = X25519.ecdh(myPriv, base64Decode(theirDhPubB64))
                     key    = Hkdf.derive(shared, salt(myId, theirId), INFO, 32)
  PeerChannel.kt:44  salt(a, b) = "$low⧉$high" UTF-8, low/high — сторони,
                     впорядковані порівнянням РЯДКІВ
  PeerChannel.kt:22  INFO = "PHANTOM OS/peer-msg-v2"

Окремо — ім'я. Тут була пастка, яку варто назвати вголос: ПК рахував своє
`node_id` як sha256(СИРІ байти Ed25519)[:32] — 64 hex-символи від сирого
ключа. Телефон рахує зовсім інакше (DeviceIdentityStore.kt):
хешує UTF-8 байти BASE64-РЯДКА того ж ключа, бере ВІСІМ байтів і віддає
16 малих hex-символів. Три розходження в одній функції. Ім'я входить і в
сіль, і в канонічний рядок адреси, тож помилка тут ламає все нижче за течією
й не дає жодного сліду.
"""
from __future__ import annotations

import base64
import re
from hashlib import sha256
from typing import Optional

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

#: Той самий недрукований роздільник, що і в PH5 (PeerChannel.kt:21).
SEP = "\x1f"

#: PeerChannel.kt:22. Не плутати з "PHANTOM OS/peer-relay-v1" зі сховка:
#: це РІЗНІ контексти, і перший виводить ключ, з якого другий робить адреси.
INFO = b"PHANTOM OS/peer-msg-v2"

KEY_SIZE_BYTES = 32
X25519_KEY_SIZE = 32

#: DeviceIdentityStore.kt — FINGERPRINT_BYTES = 8, далі "%02x" на кожен байт.
FINGERPRINT_BYTES = 8

#: Наслідок: ім'я вузла — рівно 16 символів малого шістнадцяткового.
PEER_ID_SHAPE = re.compile(r"^[0-9a-f]{16}$")


def peer_id_of(ed25519_public_raw: bytes) -> str:
    """Ім'я вузла ТАК, ЯК ЙОГО РАХУЄ ТЕЛЕФОН.

    Три деталі, кожна з яких сама по собі ламає сумісність:
      1. хешується не сирий ключ, а UTF-8 байти його BASE64-рядка;
      2. base64 — стандартний алфавіт, БЕЗ набивки і без переносів
         (Android: NO_WRAP or NO_PADDING);
      3. береться 8 байтів дайджесту, не 32, і віддається малим hex.

    Окрема правда, яку варто знати викликачеві: на телефоні `peerId` не
    перевіряється проти ключа взагалі — він приїжджає рядком усередині
    запрошення PH2 і далі просто носиться. Тобто ця функція описує, як ім'я
    ПОРОДЖУЄТЬСЯ, а не як воно доводиться. Довіра до імені — з каналу, яким
    прийшло запрошення, а не з арифметики.
    """
    if len(ed25519_public_raw) != 32:
        raise ValueError(f"Ed25519 public key має бути 32 байти, дано {len(ed25519_public_raw)}")
    b64 = base64.b64encode(ed25519_public_raw).decode("ascii").rstrip("=")
    digest = sha256(b64.encode("utf-8")).digest()
    return digest[:FINGERPRINT_BYTES].hex()


def is_peer_id(text: str) -> bool:
    return bool(PEER_ID_SHAPE.match(text or ""))


def salt_for(my_id: str, their_id: str) -> bytes:
    """Сіль симетрична — обидві сторони мусять дістати той самий ключ, не
    домовляючись, хто з них «перший».

    Kotlin порівнює РЯДКИ (UTF-16 лексикографічно). Наші імена — 16 символів
    з [0-9a-f], тобто чистий ASCII, де байтове й рядкове впорядкування
    збігаються. Саме тому `is_peer_id` тут не порада, а умова: пусти в ім'я
    щось поза ASCII — і два боки розійдуться, кожен лишившись «правим».
    """
    low, high = (my_id, their_id) if my_id <= their_id else (their_id, my_id)
    return f"{low}{SEP}{high}".encode("utf-8")


def channel_key(
    my_private_raw: bytes,
    their_dh_public_b64: str,
    my_id: str,
    their_id: str,
) -> Optional[bytes]:
    """Ключ пари PH4 — той самий, який телефон подає у сховок як `pairKey`.

    Повертає None на будь-якому непорядку, а не кидає: сюди приходять поля з
    чужого запрошення, і кривий рядок від сусіда не має валити вузол.
    """
    if not their_dh_public_b64 or not their_dh_public_b64.strip():
        return None
    if not my_id.strip() or not their_id.strip():
        return None
    if SEP in my_id or SEP in their_id:
        return None
    if len(my_private_raw) != X25519_KEY_SIZE:
        return None
    try:
        # Телефон декодує СТАНДАРТНИМ алфавітом; набивки може не бути.
        raw = their_dh_public_b64.strip()
        theirs = base64.b64decode(raw + "=" * (-len(raw) % 4))
    except Exception:
        return None
    if len(theirs) != X25519_KEY_SIZE:
        return None
    try:
        shared = X25519PrivateKey.from_private_bytes(my_private_raw).exchange(
            X25519PublicKey.from_public_bytes(theirs)
        )
    except Exception:
        return None
    return HKDF(
        algorithm=hashes.SHA256(),
        length=KEY_SIZE_BYTES,
        salt=salt_for(my_id, their_id),
        info=INFO,
    ).derive(shared)


def public_b64(private_raw: bytes) -> str:
    """Наш публічний X25519 у тому вигляді, в якому його чекає телефон:
    стандартний base64, без набивки, без переносів."""
    public = X25519PrivateKey.from_private_bytes(private_raw).public_key()
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        PublicFormat,
    )

    raw = public.public_bytes(Encoding.Raw, PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii").rstrip("=")


__all__ = [
    "FINGERPRINT_BYTES",
    "INFO",
    "channel_key",
    "is_peer_id",
    "peer_id_of",
    "public_b64",
    "salt_for",
]
