"""Мова листа телефона — конверт PH3 і підпис під ним, з боку ПК.

`peer_relay.py` домовився з телефоном про АДРЕСУ. Цього замало: усередині
скриньки лежить не кадр месенджера ПК, а конверт `PeerEnvelope` v3 з
`PeerMessage` всередині. Доки ПК цієї мови не знав, збіг адрес нічого не давав:
вузол дістав би шифротекст, якого не вміє відчинити, і чесно поклав би у
скриньку кадр, якого не вміє відчинити телефон.

ДЖЕРЕЛО ПРАВДИ — ТЕЛЕФОН. Кожен рядок нижче переписаний з
`core-net/.../peer/PeerEnvelope.kt`, `PeerOutbox.kt` (PeerMessage),
`PeerSealing.kt` і `PeerReceipt.kt`. Розходження тут не дає помилки — лист
просто не відчиняється, і обидва боки лишаються «праві».

Три пастки, названі вголос, бо кожна мовчазна:
  1. kotlinx НЕ пише поля зі значенням за замовчуванням. Тому конверт без
     `sid` — це v3, а `PeerMessage` без `replyToId` — звичайний лист. Дописати
     їх порожніми означало б зламати підпис і AAD.
  2. base64 у телефоні БЕЗ набивки (`withoutPadding`). Python без набивки не
     декодує — треба добивати самому.
  3. `sentAtMs` у канонічному рядку — десяткові цифри Long, не ISO-час.
"""
from __future__ import annotations

import base64
import hmac
import json
import logging
import os
from dataclasses import dataclass, field, replace
from hashlib import sha256
from typing import Any, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

#: PeerEnvelope.kt:47 і PeerSealing.kt:8 — той самий недрукований роздільник.
SEP = "\x1f"

VERSION = 3  # PeerEnvelope.kt:38
AAD_TAG = "PH3"  # PeerEnvelope.kt:48
RECEIPT_TAG = "PH3-ACK"  # PeerReceipt.kt:24

IV_SIZE_BYTES = 12  # AesGcm.kt:33
KEY_SIZE_BYTES = 32

#: PeerWire.MAX_BODY_BYTES — телефон не читає кадру, більшого за це.
MAX_FRAME_BYTES = 65_536

__all__ = [
    "MAX_FRAME_BYTES",
    "PeerLetter",
    "canonical",
    "open_envelope",
    "receipt",
    "seal_envelope",
    "sign",
    "verify",
]


@dataclass(frozen=True)
class PeerLetter:
    """Один лист телефона. Поля названі так, як вони їдуть у JSON."""

    id: str
    from_id: str
    to_id: str
    body: str
    sent_at_ms: int
    reply_to_id: str = ""
    signature: str = ""
    #: Решта полів кадру, які нас не обходять, але мусять доїхати назад
    #: незміненими, якщо лист колись доведеться перепакувати.
    extra: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        """Рівно ті поля, що пише kotlinx: без значень за замовчуванням.

        Порядок теж не косметика — він той самий, що в оголошенні
        `data class PeerMessage`, і саме в такому вигляді кадр читається
        очима поруч із телефонним.
        """
        out: dict[str, Any] = {
            "id": self.id,
            "fromId": self.from_id,
            "toId": self.to_id,
            "body": self.body,
            "sentAtMs": self.sent_at_ms,
        }
        if self.reply_to_id:
            out["replyToId"] = self.reply_to_id
        if self.signature:
            out["signature"] = self.signature
        return json.dumps(out, ensure_ascii=False, separators=(",", ":"))

    @classmethod
    def from_json(cls, text: str) -> Optional["PeerLetter"]:
        try:
            raw = json.loads(text)
        except (ValueError, TypeError):
            return None
        if not isinstance(raw, dict):
            return None
        try:
            return cls(
                id=str(raw["id"]),
                from_id=str(raw["fromId"]),
                to_id=str(raw["toId"]),
                body=str(raw["body"]),
                sent_at_ms=int(raw["sentAtMs"]),
                reply_to_id=str(raw.get("replyToId") or ""),
                signature=str(raw.get("signature") or ""),
                extra={
                    k: v
                    for k, v in raw.items()
                    if k
                    not in {
                        "id",
                        "fromId",
                        "toId",
                        "body",
                        "sentAtMs",
                        "replyToId",
                        "signature",
                    }
                },
            )
        except (KeyError, TypeError, ValueError):
            return None


def _b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii").rstrip("=")


def _b64d(text: str) -> Optional[bytes]:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        return base64.b64decode(raw + "=" * (-len(raw) % 4))
    except Exception:  # noqa: BLE001 — з мережі приходить що завгодно
        return None


def canonical(letter: PeerLetter) -> bytes:
    """Байти, які підписує телефон (PeerSealing.canonical).

    Підпис накриває і адресата, і час — інакше той самий лист можна було б
    переадресувати комусь іншому, не чіпаючи жодного слова.
    """
    text = SEP.join(
        [letter.id, letter.from_id, letter.to_id, str(letter.sent_at_ms), letter.body]
    )
    if letter.reply_to_id:
        text = text + SEP + letter.reply_to_id
    return text.encode("utf-8")


def sign(letter: PeerLetter, private: Ed25519PrivateKey) -> PeerLetter:
    """Той самий лист із підписом. Без підпису телефон його не прийме."""
    return replace(letter, signature=_b64e(private.sign(canonical(letter))))


def verify(letter: PeerLetter, public_raw: bytes, expected_from: Optional[str] = None) -> bool:
    """True лише коли ЦЕЙ телефон справді це сказав — і саме нам.

    `expected_from` звіряється з іменем зі скриньки: чинний підпис одного
    співрозмовника не має проходити під іменем іншого.
    """
    if not letter.signature:
        return False
    if expected_from is not None and letter.from_id != expected_from:
        return False
    sig = _b64d(letter.signature)
    if sig is None or len(public_raw) != 32:
        return False
    try:
        Ed25519PublicKey.from_public_bytes(public_raw).verify(sig, canonical(letter))
    except Exception:  # noqa: BLE001 — і кривий підпис, і кривий ключ — те саме «ні»
        return False
    return True


def _aad(from_id: str, to_id: str) -> bytes:
    return f"{AAD_TAG}{SEP}{from_id}{SEP}{to_id}".encode("utf-8")


def seal_envelope(
    letter: PeerLetter, pair_key: bytes, nonce: Optional[bytes] = None
) -> Optional[tuple[str, str]]:
    """Конверт v3 під довічним ключем пари; (кадр, nonce_b64) або None.

    Саме v3, а не v4: ключ зустрічі живе, лише поки обидва на зв'язку, а весь
    сенс сховка в тому, що адресата зараз немає.
    """
    if len(pair_key) != KEY_SIZE_BYTES:
        return None
    if not letter.from_id.strip() or not letter.to_id.strip():
        return None
    if SEP in letter.from_id or SEP in letter.to_id:
        return None
    iv = nonce if nonce is not None else os.urandom(IV_SIZE_BYTES)
    if len(iv) != IV_SIZE_BYTES:
        return None
    ct = AESGCM(pair_key).encrypt(
        iv, letter.to_json().encode("utf-8"), _aad(letter.from_id, letter.to_id)
    )
    nonce_b64 = _b64e(iv)
    frame = json.dumps(
        {
            "v": VERSION,
            "from": letter.from_id,
            "to": letter.to_id,
            "n": nonce_b64,
            "ct": _b64e(ct),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if len(frame.encode("utf-8")) > MAX_FRAME_BYTES:
        # Телефон такий кадр не читає взагалі. Чесніше не нести, ніж покласти
        # у скриньку те, що адресат мовчки відкине.
        return None
    return frame, nonce_b64


def open_envelope(frame: str, pair_key: bytes) -> Optional[PeerLetter]:
    """Лист усередині конверта, або None — і None ніколи не пояснює себе.

    v4 сюди не проходить: кадр зустрічі у сховку означав би, що ключ пережив
    зустріч, а відчинити його довічним ключем — саме те, від чого v4 захищає.
    """
    try:
        env = json.loads(frame)
    except (ValueError, TypeError):
        return None
    if not isinstance(env, dict) or env.get("v") != VERSION:
        return None
    if env.get("sid"):
        return None
    sender = str(env.get("from") or "")
    recipient = str(env.get("to") or "")
    if not sender or not recipient or SEP in sender or SEP in recipient:
        return None
    nonce = _b64d(str(env.get("n") or ""))
    ct = _b64d(str(env.get("ct") or ""))
    if nonce is None or ct is None or len(nonce) != IV_SIZE_BYTES:
        return None
    if len(pair_key) != KEY_SIZE_BYTES:
        return None
    try:
        plain = AESGCM(pair_key).decrypt(nonce, ct, _aad(sender, recipient))
    except Exception:  # noqa: BLE001 — не наш конверт: нормальний стан
        return None
    letter = PeerLetter.from_json(plain.decode("utf-8", errors="strict"))
    if letter is None:
        return None
    # Зовнішня заява і внутрішня мусять бути ОДНІЄЮ заявою: інакше чинний
    # кадр можна переадресувати на конверті й повірити в нього як у чужий.
    if letter.from_id != sender or letter.to_id != recipient:
        return None
    return letter


def receipt(
    pair_key: bytes, message_id: str, from_id: str, to_id: str, nonce_b64: str
) -> Optional[str]:
    """Квитанція, яку автор упізнає (PeerReceipt.of).

    Прив'язана до nonce ТІЄЇ копії, яку віддав сховок: без цього будь-хто, хто
    бачив ідентифікатор, міг би відповісти «доставлено» замість адресата — а
    хибне «доставлено» гірше за чесне «чекає», бо його ніхто не переперевіряє.
    """
    if not pair_key:
        return None
    parts = [message_id, from_id, to_id, nonce_b64]
    if any(not p or not p.strip() for p in parts):
        return None
    if any(SEP in p for p in parts):
        return None
    text = SEP.join([RECEIPT_TAG, *parts])
    tag = hmac.new(pair_key, text.encode("utf-8"), sha256).digest()
    return _b64e(tag)
