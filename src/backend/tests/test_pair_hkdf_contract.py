"""Рядок HKDF мусить бути байт-у-байт таким, як у телефоні.

Він розійшовся регістром і дефісом — сервер рахував один спільний ключ,
апарат інший, і кожен claim падав у bad_proof. Помилка мовчазна: обидві
сторони «працюють», а паринг просто не відбувається. Тому значення
прибите тут і звірене з константою в Kotlin.
"""
from pathlib import Path

from security.pair_crypto import _HKDF_INFO

KOTLIN_SOURCE = (
    Path(__file__).resolve().parents[3]
    / "phantom-companion"
    / "core-net/src/main/java/local/phantom/companion/core/net/pair/PairProofs.kt"
)


def test_hkdf_info_is_pinned():
    assert _HKDF_INFO == b"PHANTOM OS/mobile-pair-v1"


def test_hkdf_info_matches_companion_constant():
    if not KOTLIN_SOURCE.is_file():
        return  # телефонного репозиторію поруч немає — звіряти нічого
    text = KOTLIN_SOURCE.read_text(encoding="utf-8")
    quoted = f'"{_HKDF_INFO.decode()}".toByteArray'
    assert quoted in text, (
        "HKDF info розійшовся з телефоном — паринг падатиме в bad_proof"
    )
