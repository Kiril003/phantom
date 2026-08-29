"""Чи говорить ПК тією самою мовою, що й телефон.

Розходження в цьому протоколі не падає — воно МОВЧИТЬ. Обидва боки чесно
складають адресу, чесно кладуть і чесно забирають, просто в різні скриньки, і
обидва бачать порожньо. Тому тут перевіряється не «не кинуло виняток», а три
різні речі:

  1. Примітиви — на ОПУБЛІКОВАНИХ векторах RFC. Якщо мій HKDF чи HMAC не той,
     що в BouncyCastle на телефоні, це видно тут, а не в полі.
  2. Форма дроту — рівно ті довжини, які приймає сервер, і рівно та розкладка
     nonce‖шифротекст, яку читає `PeerRelay.unwrap`.
  3. Властивості адрес — симетрія ключа, розділення діб, розділення напрямків.

  4. Сумісність — на числах, які порахував САМ ТЕЛЕФОН. Тести телефона
     (PeerRelayTest.kt) побудовані на властивостях і жодної literal-адреси не
     містять, тому 29.08.2026 у core-net прогнали окремий друкувальний тест
     (`scripts/gate.sh :core-net:testDebugUnitTest`, BUILD_SUCCESSFUL) і
     звірили посимвольно. Усі п'ять значень і розкладка конверта збіглися.
     Таблиця PHONE_VECTORS нижче — ЙОГО вихід, не мій.
"""
from __future__ import annotations

import base64

import pytest

from node import peer_relay as pr

PAIR_KEY = bytes(range(32))
A, B = "node-a", "node-b"


# ── 1. Примітиви на векторах RFC ─────────────────────────────────────────────


def test_hkdf_matches_rfc5869_case1():
    """RFC 5869, Appendix A.1 — той самий HKDF-SHA256, що й BouncyCastle.

    Перевіряється саме бібліотека, якою я виводжу ключ сховка: якщо вона
    розійдеться з телефоном тут, розійдеться і на кожній адресі.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    okm = HKDF(
        algorithm=hashes.SHA256(),
        length=42,
        salt=bytes.fromhex("000102030405060708090a0b0c"),
        info=bytes.fromhex("f0f1f2f3f4f5f6f7f8f9"),
    ).derive(bytes.fromhex("0b" * 22))
    assert okm.hex() == (
        "3cb25f25faacd57a90434f64d0362f2a"
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
        "34007208d5b887185865"
    )


def test_hmac_sha256_matches_rfc4231_case2():
    """RFC 4231, Test Case 2 — HMAC-SHA256, яким складається адреса."""
    import hmac
    from hashlib import sha256

    mac = hmac.new(b"Jefe", b"what do ya want for nothing?", sha256).hexdigest()
    assert mac == "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"


def test_aes_gcm_matches_nist_zero_vector():
    """NIST SP 800-38D — нульовий вектор AES-256-GCM.

    Важливий не сам шифротекст, а те, що бібліотека повертає ct‖tag одним
    шматком, як і JCE на телефоні: саме на цьому припущенні стоїть розкладка
    конверта (nonce‖ct‖tag).
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    out = AESGCM(bytes(32)).encrypt(bytes(12), b"", None)
    assert out.hex() == "530f8afbc74536b9a963b4f1c4cb738b"
    assert len(out) == pr.GCM_TAG_BYTES


# ── 2. Форма дроту ───────────────────────────────────────────────────────────


def test_wire_sizes_are_exactly_what_the_store_accepts():
    """Три довжини, і жодної іншої.

    Сервер (platform-site/server/relay.py) виводить свій перелік тією самою
    арифметикою. Одного разу середню корзину там набрали руками й помилились на
    одну мітку GCM — лист від ~4 до 16 КБ мовчки діставав 400 і після восьми
    спроб лягав у FAILED. Тому число тут теж виведене, а не переписане.
    """
    assert pr.BLOB_SIZES == (4_096 + 28, 16_384 + 28, 69_632 + 28)
    assert pr.OVERHEAD == pr.IV_SIZE_BYTES + pr.GCM_TAG_BYTES


@pytest.mark.parametrize(
    "text, expected_wire",
    [
        ("слово, і кома", 4_124),
        ("х" * 3_000, 16_412),  # 2 байти на символ — 6000 Б, це вже середня
        ("y" * 20_000, 69_660),
    ],
)
def test_envelope_lands_in_the_declared_bucket(text, expected_wire):
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    wrapped = pr.wrap(text, key, tag)
    assert len(wrapped.blob) == expected_wire
    assert len(wrapped.blob) in pr.BLOB_SIZES
    assert pr.unwrap(wrapped.blob, key, tag) == text


def test_nonce_sits_first_and_is_readable_back():
    """`nonceOf` на телефоні читає перші 12 байтів — квитанція чіпляється саме
    до тієї копії, яку віддав сервер."""
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    wrapped = pr.wrap("лист", key, tag)
    assert pr.nonce_of(wrapped.blob) == wrapped.nonce_b64
    assert base64.b64decode(wrapped.nonce_b64 + "==") == wrapped.blob[: pr.IV_SIZE_BYTES]


def test_payload_too_big_is_refused_not_truncated():
    """Мовчазне обрізання тут коштувало б половини листа без жодного сліду."""
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    assert pr.wrap("z" * 70_000, key, tag) is None


# ── 3. Властивості адрес ─────────────────────────────────────────────────────


def test_both_sides_derive_the_same_relay_key():
    """Сіль симетрична — інакше двоє слухали б різні скриньки й обидва мали
    рацію."""
    assert pr.relay_key(PAIR_KEY, A, B) == pr.relay_key(PAIR_KEY, B, A)
    assert len(pr.relay_key(PAIR_KEY, A, B)) == pr.KEY_SIZE_BYTES


def test_a_day_is_a_different_mailbox():
    key = pr.relay_key(PAIR_KEY, A, B)
    assert pr.msg_tag(key, A, B, 20_000) != pr.msg_tag(key, A, B, 20_001)


def test_letter_and_receipt_do_not_share_a_mailbox():
    key = pr.relay_key(PAIR_KEY, A, B)
    assert pr.msg_tag(key, A, B, 20_000) != pr.ack_tag(key, A, B, 20_000)


def test_direction_matters():
    """Скринька «я→він» і «він→я» — різні, інакше сервер бачив би пару як одне
    ребро в обидва боки."""
    key = pr.relay_key(PAIR_KEY, A, B)
    assert pr.msg_tag(key, A, B, 20_000) != pr.msg_tag(key, B, A, 20_000)


def test_tag_shape_is_43_url_safe_chars():
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    assert len(tag) == pr.TAG_CHARS
    assert pr.is_tag(tag)
    assert "=" not in tag  # набивки бути не може — сервер її не прийме


def test_separator_in_an_id_cannot_forge_a_field_boundary():
    """Розділювач недрукований саме тому, що ім'я вузла не має вміти вдати
    межу поля. Спроба — відмова, а не тихо інша адреса."""
    key = pr.relay_key(PAIR_KEY, A, B)
    assert pr.relay_key(PAIR_KEY, f"a{pr.SEP}b", B) is None
    assert pr.msg_tag(key, f"a{pr.SEP}b", B, 20_000) is None


def test_epoch_is_floor_division_like_kotlin():
    """Math.floorDiv, не int(a/b): для часу до 1970 вони розходяться на добу."""
    assert pr.epoch_of(0) == 0
    assert pr.epoch_of(pr.EPOCH_MS - 1) == 0
    assert pr.epoch_of(-1) == -1


# ── 4. Захід за листами ──────────────────────────────────────────────────────


def test_a_fetch_always_names_exactly_64_distinct_mailboxes():
    """Число імен — саме воно тримає анонімність. Вибірка іншої ширини сказала
    б серверові, скільки співрозмовників має цей вузол; сервер таку й не
    прийме (400)."""
    boxes = [pr.Mailbox(f"peer-{i}", pr.relay_key(PAIR_KEY, A, f"peer-{i}")) for i in range(1, 4)]
    plan = pr.plan(A, boxes, 1_800_000_000_000)
    assert len(plan.tags) == pr.FETCH_TAGS
    assert len(set(plan.tags)) == pr.FETCH_TAGS


def test_a_single_mailbox_is_padded_with_indistinguishable_decoys():
    """Одна скринька в запиті означала б «у цього вузла один друг»."""
    boxes = [pr.Mailbox(B, pr.relay_key(PAIR_KEY, A, B))]
    plan = pr.plan(A, boxes, 1_800_000_000_000)
    assert len(plan.tags) == pr.FETCH_TAGS
    assert len(plan.slots) == 6  # три доби × (лист + квитанція)
    for tag in plan.tags:
        assert pr.is_tag(tag)  # вигадані від справжніх не відрізняються формою


def test_three_days_are_asked_because_clocks_drift():
    """Лист, покладений о 23:59 їхнього часу, інакше губився б до ранку."""
    boxes = [pr.Mailbox(B, pr.relay_key(PAIR_KEY, A, B))]
    now = 1_800_000_000_000
    plan = pr.plan(A, boxes, now)
    today = pr.epoch_of(now)
    assert {slot.epoch for slot in plan.slots.values()} == {today - 1, today, today + 1}


def test_a_crowded_crew_rotates_instead_of_starving_one_mailbox():
    """Понад 64 імен не вміщається; вікно їде далі з кожним заходом."""
    boxes = [pr.Mailbox(f"peer-{i}", pr.relay_key(PAIR_KEY, A, f"peer-{i}")) for i in range(1, 21)]
    first = pr.plan(A, boxes, 1_800_000_000_000, round_=0)
    second = pr.plan(A, boxes, 1_800_000_000_000, round_=1)
    assert set(first.slots) != set(second.slots)
    assert len(first.tags) == len(second.tags) == pr.FETCH_TAGS


def test_real_names_are_not_first_in_the_request():
    """Порядок у запиті — теж підпис. Якщо справжні завжди стоять спереду,
    перемішування декоїв не варте нічого."""
    boxes = [pr.Mailbox(B, pr.relay_key(PAIR_KEY, A, B))]
    positions = []
    for _ in range(40):
        plan = pr.plan(A, boxes, 1_800_000_000_000)
        positions.append(min(plan.tags.index(t) for t in plan.slots))
    assert len(set(positions)) > 1, "справжні імена щоразу на тому самому місці"


# ── 5. Конверт не мандрує між скриньками ─────────────────────────────────────


def test_envelope_moved_to_another_mailbox_does_not_open():
    """Адреса входить у автентифікацію, а не лише в маршрут."""
    key = pr.relay_key(PAIR_KEY, A, B)
    mine = pr.msg_tag(key, A, B, 20_000)
    other = pr.msg_tag(key, A, B, 20_001)
    wrapped = pr.wrap("таємниця", key, mine)
    assert pr.unwrap(wrapped.blob, key, other) is None


def test_a_stranger_key_does_not_open_it():
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    wrapped = pr.wrap("таємниця", key, tag)
    assert pr.unwrap(wrapped.blob, pr.relay_key(b"\x01" * 32, A, B), tag) is None


def test_garbage_from_the_wire_is_a_state_not_an_exception():
    """Чужий сміттєвий байт не має валити весь захід за листами."""
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    assert pr.unwrap(b"", key, tag) is None
    assert pr.unwrap(b"\x00" * 4_124, key, tag) is None
    assert pr.unwrap(b"\x00" * 100, key, tag) is None


# ── 6. Еталон із телефона ────────────────────────────────────────────────────
#
# Джерело: прогін на телефоні 29.08.2026, pairKey = ByteArray(32){it.toByte()},
# тобто байти 00 01 02 … 1f. Це ВИХІД KOTLIN, а не мій. Якщо колись
# розійдеться — правий телефон: він у руках у людей.

PHONE_RELAY_KEY_HEX = "333858fd43674889820cf1144c708730958edc8a9a3af9149a7ede5292c2c0e3"

PHONE_VECTORS = [
    ("mbox", "node-a", "node-b", 20_000, "RFMYwYxSYialHuC9yU8weJDOVhBoLEbu_SvWV7VooeQ"),
    ("ack", "node-a", "node-b", 20_000, "LhSfhlMfFUTkc7CKhzqfvpzpeyWyRgXdB0B3d7yLuuk"),
    ("mbox", "node-b", "node-a", 20_000, "V4XlCiMPNwcU9gqwHymW4cFI6XlMiVggROkSWWaMzT4"),
    ("mbox", "node-a", "node-b", 20_001, "39I_CVB5AQbjZGEvDmQ4PJcfB_cTQy8_SU68aQTEVOI"),
]

#: Конверт із ФІКСОВАНИМ nonce 00 01 … 0b — інакше звірити його неможливо.
PHONE_BLOB_HEAD_HEX = "000102030405060708090a0b9d6e274e52d8bef6d9e6200484b0cb5b1f046afa"
PHONE_NONCE_B64 = "AAECAwQFBgcICQoL"


def test_relay_key_matches_the_phone():
    """Розійдись тут — і розійдеться КОЖНА адреса, мовчки."""
    assert pr.relay_key(PAIR_KEY, A, B).hex() == PHONE_RELAY_KEY_HEX


@pytest.mark.parametrize("verb, sender, recipient, epoch, expected", PHONE_VECTORS)
def test_tag_matches_the_phone(verb, sender, recipient, epoch, expected):
    """Адреса скриньки, порахована телефоном, і наша — один рядок.

    Це і є вся сумісність: сервер лише порівнює рядки, тож розбіжність в
    одному символі означає дві різні скриньки, дві чесні сторони й порожньо в
    обох.
    """
    key = pr.relay_key(PAIR_KEY, A, B)
    fn = pr.msg_tag if verb == "mbox" else pr.ack_tag
    assert fn(key, sender, recipient, epoch) == expected


def test_envelope_matches_the_phone_byte_for_byte():
    """Розкладка конверта: nonce‖шифротекст, AAD з адресою, добивка до корзини."""
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    wrapped = pr.wrap("слово, і кома", key, tag, nonce=bytes(range(12)))
    assert len(wrapped.blob) == 4_124
    assert wrapped.blob[:32].hex() == PHONE_BLOB_HEAD_HEX
    assert wrapped.nonce_b64 == PHONE_NONCE_B64
