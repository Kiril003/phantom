"""Число для звірки — те, що двоє читають одне одному вголос.

Раніше в налаштуваннях стояв рядок AURA:P2P:SHA256:7B:4E:91:FA:33:C9, вписаний
руками. Його можна було звірити зі співрозмовником, отримати «збіг» і повірити,
що канал захищений, — при тому що ключів не існувало взагалі.

Тут число рахується з обох довготривалих ідентичностей. Воно однакове з обох
боків (ключі сортуються), і якщо між вами хтось став — воно розійдеться.
"""
from __future__ import annotations

import hashlib

__all__ = ["SAFETY_GROUPS", "safety_number", "format_safety_number"]

SAFETY_GROUPS = 12
_GROUP_LEN = 5
_ITERATIONS = 5200


def _fingerprint(identity_ed: bytes, identity_dh: bytes) -> bytes:
    """Повільне хешування: підбір ключа під бажане число має коштувати дорого."""
    digest = b"\x00" + identity_ed + identity_dh
    for _ in range(_ITERATIONS):
        digest = hashlib.sha512(digest + identity_ed + identity_dh).digest()
    return digest[:30]


def safety_number(
    own_ed: bytes, own_dh: bytes, peer_ed: bytes, peer_dh: bytes
) -> str:
    """60 цифр. Обидві сторони бачать те саме число."""
    mine = _fingerprint(own_ed, own_dh)
    theirs = _fingerprint(peer_ed, peer_dh)
    first, second = sorted((mine, theirs))
    out = []
    for chunk in (first, second):
        for i in range(0, len(chunk), 5):
            block = int.from_bytes(chunk[i : i + 5], "big") % 100000
            out.append(f"{block:0{_GROUP_LEN}d}")
    return "".join(out)


def format_safety_number(number: str) -> str:
    """Розбивка по п'ять цифр — щоб читати вголос без помилок."""
    return " ".join(number[i : i + _GROUP_LEN] for i in range(0, len(number), _GROUP_LEN))
