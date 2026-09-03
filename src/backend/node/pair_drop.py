"""Спарований телефон як адресат у сховку PH5.

Найбільша структурна діра бети до 03.09.2026: ПК і телефон мали спільну мову
адрес (`peer_channel` + `peer_relay`, звірені з Kotlin), але жодної розмови —
`mobile-pair-v1` не обмінював X25519, тож спільного ключа каналу не існувало.
Кожен бік чесно рахував адресу зі своїх ключів, адреси не збігались, і обидва
бачили порожню скриньку.

Тут — єдине місце, де запис пристрою перетворюється на скриньку. Формула та
сама, якою вузол говорить з ІНШИМ ВУЗЛОМ (`transport._pair_key`), і це
навмисно: телефон не заслуговує окремої арифметики, бо друга арифметика — це
другий спосіб розійтись.

Чого тут немає: мережі. Дорога — у `relay_courier.py`; тут лише адреси, щоб їх
можна було звіряти з Kotlin без жодного сокета.
"""
from __future__ import annotations

import base64
import logging
from typing import Any, Optional

from cryptography.hazmat.primitives import serialization
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PairedDevice
from node import peer_channel
from node import peer_relay as pr
from security.pair_crypto import MeshBlock

logger = logging.getLogger(__name__)

__all__ = [
    "drop_ready",
    "phone_by_peer_id",
    "mailbox_of",
    "node_mesh",
    "pair_key_of",
    "paired_phones",
    "phone_mailboxes",
]


def node_mesh(keys: Any) -> MeshBlock:
    """Сітьова особа ЦЬОГО вузла — те, що їде телефону у відповіді на claim.

    `node_id` береться з того самого місця, що й у месенджері: розійшлись би
    імена — розійшлась би сіль, а з нею й адреса, без жодного сліду.
    """
    return MeshBlock(
        peer_id=keys.node_id,
        pub_ed25519_b64=base64.b64encode(keys.identity_ed_public).decode("ascii"),
        dh_x25519_b64=base64.b64encode(keys.identity_dh_public).decode("ascii"),
    )


def drop_ready(device: Any) -> bool:
    """Чи є з чого скласти адресу. False — пара наведена до обміну ключами."""
    return bool(
        (getattr(device, "peer_id", None) or "").strip()
        and (getattr(device, "peer_dh_x25519", None) or "").strip()
    )


def pair_key_of(keys: Any, device: Any) -> bytes:
    """Ключ каналу ПК↔телефон; b"" — ключа не скласти, дороги немає.

    Один і той самий `peer_channel.channel_key`, що й для вузол↔вузол. Аргументи
    з НАШОГО боку: наш приватний X25519 і наше ім'я; з їхнього — те, що телефон
    сам поклав у claim.
    """
    if not drop_ready(device):
        return b""
    my_raw = keys.identity_dh_private.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    key = peer_channel.channel_key(
        my_raw,
        (device.peer_dh_x25519 or "").strip(),
        keys.node_id,
        (device.peer_id or "").strip(),
    )
    if key is None:
        # Гучно: без цього ключа дороги просто «немає», і ніхто не дізнався б,
        # чому листи саме цьому телефону не їдуть у сховок.
        logger.warning(
            "ключ каналу з телефоном %s не склався", (device.peer_id or "")[:8]
        )
        return b""
    return key


def mailbox_of(keys: Any, device: Any) -> Optional[pr.Mailbox]:
    """Скринька пари з цим телефоном; None — складати нема з чого."""
    pair = pair_key_of(keys, device)
    if not pair:
        return None
    peer_id = (device.peer_id or "").strip()
    relay_key = pr.relay_key(pair, keys.node_id, peer_id)
    if relay_key is None:
        return None
    return pr.Mailbox(peer_id=peer_id, relay_key=relay_key)


async def paired_phones(session: AsyncSession, owner_user_id: str) -> list[PairedDevice]:
    """Живі пари власника. Відкликаний пристрій не має скриньки за побудовою:
    відкликання, після якого лист усе ще їде, — не відкликання."""
    rows = (
        await session.execute(
            select(PairedDevice).where(
                PairedDevice.user_id == owner_user_id,
                PairedDevice.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    return list(rows)


async def phone_by_peer_id(
    session: AsyncSession, owner_user_id: str, peer_id: str
) -> Optional[PairedDevice]:
    """Спарований телефон під цим сітьовим ім'ям; None — такого немає.

    Обмеження власником не косметичне: без нього чужа пара давала б дорогу до
    телефона, якого цей власник ніколи не бачив.
    """
    name = (peer_id or "").strip()
    if not name:
        return None
    for device in await paired_phones(session, owner_user_id):
        if (device.peer_id or "").strip() == name and drop_ready(device):
            return device
    return None


async def phone_mailboxes(
    session: AsyncSession, keys: Any, owner_user_id: str
) -> list[pr.Mailbox]:
    """Скринька на кожен спарований телефон, з яким є ключ каналу."""
    boxes: list[pr.Mailbox] = []
    seen: set[str] = set()
    for device in await paired_phones(session, owner_user_id):
        box = mailbox_of(keys, device)
        if box is None or box.peer_id in seen:
            continue
        seen.add(box.peer_id)
        boxes.append(box)
    return boxes
