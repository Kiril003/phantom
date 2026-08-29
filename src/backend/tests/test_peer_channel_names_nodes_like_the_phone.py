"""Чи називає ПК вузли так само, як телефон, і чи виводить той самий ключ пари.

Тут перевіряється ланка, без якої весь сховок PH5 працює «сам із собою».
Адреси скриньок виводяться з ключа ПАРИ, ключ пари — з PeerChannel.derive, а
в його сіль входять ІМЕНА сторін. Помилися в імені — і ключ ще збіжиться (він
від спільного секрету), а кожна адреса розійдеться. Обидва боки чесно кладуть,
обидва чесно забирають, обидва бачать порожньо, і жоден лог про це не скаже.

Пастка, на якій я вже мало не спіймався і яку тут прибито тестами: ПК рахував
своє `node_id` як sha256(СИРІ байти Ed25519)[:32] — 64 hex-символи. Телефон
(DeviceIdentityStore.kt) хешує UTF-8 байти BASE64-РЯДКА того ж ключа, бере
ВІСІМ байтів і віддає 16 малих hex. Три розходження в одній функції.

Сумісність доведена числами з телефона: прогін у core-net 29.08.2026
(`scripts/gate.sh`, BUILD_SUCCESSFUL) на фіксованих входах, узгоджених
заздалегідь. Збіглися всі шість значень — обидва імені, обидві публічні
половини X25519 і ключ каналу в ОБИДВА боки.

Дві заcтороги того прогону, записані тут, а не забуті:
  1. Імена в ньому відтворені ЗА ФОРМУЛОЮ `DeviceIdentityStore.fingerprint`,
     а не викликом самого класу: він живе в `:app` і потребує Context, тож із
     юніт-тесту `core-net` недосяжний. Збіг із нашим числом — сильний доказ,
     що формулу прочитано правильно, але це не те саме, що виклик самого
     коду. Абсолютна певність — тест у `:app`; його візьмуть на етапі 2.
  2. Kotlin-бік ужив `java.util.Base64.getEncoder().withoutPadding()` як
     тотожність до `android.util.Base64 NO_WRAP or NO_PADDING`. Для
     32-байтових ключів це справді те саме; розійтись вони могли б лише на
     довгих даних із переносами, яких тут немає.
"""
from __future__ import annotations

import base64

import pytest

from node import peer_channel as pc

# Входи, узгоджені з Чатом 3 для звірки з Kotlin. Навмисно тривіальні —
# щоб на телефоні їх набрали руками без помилок копіювання.
A_PRIV = bytes(range(1, 33))  # 01 02 … 20
B_PRIV = bytes(range(65, 97))  # 41 42 … 60
A_ED = bytes([7]) * 32
B_ED = bytes([9]) * 32

#: Вихід ТЕЛЕФОНА на цих входах, прогін 29.08.2026. Не мій — його.
#: Якщо колись розійдеться, правий телефон: він у руках у людей.
PHONE_A_ID = "dc4bf80c77473d13"
PHONE_B_ID = "83cd213e468a2fba"
PHONE_A_PUB = "B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw"
PHONE_B_PUB = "ZLEBsdC+WocEvQePmJUAH8A+jp+VIvGI3RKNmEbUhGY"
PHONE_CHANNEL_KEY_HEX = "f1302720bff515a6209da95f9d2d12067d76cbf83635c254df59dbbae58d3f1a"


# ── Еталон із телефона ───────────────────────────────────────────────────────


def test_names_match_the_phone():
    """Ім'я входить у сіль і в канонічний рядок адреси. Розійдись тут — і
    кожна скринька буде іншою, тихо."""
    assert pc.peer_id_of(A_ED) == PHONE_A_ID
    assert pc.peer_id_of(B_ED) == PHONE_B_ID


def test_our_public_halves_match_the_phone():
    """Публічну половину ми ВІДДАЄМО сусідові рядком — байт у байт його."""
    assert pc.public_b64(A_PRIV) == PHONE_A_PUB
    assert pc.public_b64(B_PRIV) == PHONE_B_PUB


def test_channel_key_matches_the_phone_from_both_sides():
    """Останній стик усього ланцюга: ім'я → ключ каналу PH4 → ключ сховка PH5
    → адреси. Тут він зійшовся з обох боків незалежно."""
    assert pc.channel_key(A_PRIV, PHONE_B_PUB, PHONE_A_ID, PHONE_B_ID).hex() == PHONE_CHANNEL_KEY_HEX
    assert pc.channel_key(B_PRIV, PHONE_A_PUB, PHONE_B_ID, PHONE_A_ID).hex() == PHONE_CHANNEL_KEY_HEX


def test_the_whole_chain_lands_on_a_mailbox():
    """Наскрізь: ключ каналу телефона → ключ сховка → адреса → конверт.

    Це не повторення попередніх тестів — це доказ, що ланки СТИКУЮТЬСЯ:
    ключ, що вийшов із PH4, справді годиться на вхід PH5.
    """
    from node import peer_relay as pr

    pair_key = pc.channel_key(A_PRIV, PHONE_B_PUB, PHONE_A_ID, PHONE_B_ID)
    relay_key = pr.relay_key(pair_key, PHONE_A_ID, PHONE_B_ID)
    assert relay_key is not None

    tag = pr.msg_tag(relay_key, PHONE_A_ID, PHONE_B_ID, 20_000)
    assert pr.is_tag(tag)

    wrapped = pr.wrap("наскрізний лист", relay_key, tag)
    assert len(wrapped.blob) in pr.BLOB_SIZES
    assert pr.unwrap(wrapped.blob, relay_key, tag) == "наскрізний лист"

    # Сусід виводить ту саму скриньку зі свого боку, не домовляючись.
    their_pair = pc.channel_key(B_PRIV, PHONE_A_PUB, PHONE_B_ID, PHONE_A_ID)
    their_relay = pr.relay_key(their_pair, PHONE_B_ID, PHONE_A_ID)
    assert pr.msg_tag(their_relay, PHONE_A_ID, PHONE_B_ID, 20_000) == tag


# ── Ім'я вузла ───────────────────────────────────────────────────────────────


def test_peer_id_is_sixteen_lowercase_hex():
    """Форма — не косметика: ім'я їде в сіль і в канонічний рядок адреси."""
    peer_id = pc.peer_id_of(A_ED)
    assert len(peer_id) == 16
    assert pc.is_peer_id(peer_id)
    assert peer_id == peer_id.lower()


def test_peer_id_hashes_the_base64_string_not_the_raw_key():
    """Головне розходження з ПК, і його не видно очима.

    Телефон хешує UTF-8 байти base64-РЯДКА. Якби він хешував сирі байти,
    вийшло б інше число — і саме його ПК і рахував би «за здоровим глуздом».
    """
    from hashlib import sha256

    b64 = base64.b64encode(A_ED).decode("ascii").rstrip("=")
    expected = sha256(b64.encode("utf-8")).digest()[:8].hex()
    naive_raw = sha256(A_ED).digest()[:8].hex()

    assert pc.peer_id_of(A_ED) == expected
    assert pc.peer_id_of(A_ED) != naive_raw, "хешується рядок, а не сирий ключ"


def test_peer_id_uses_base64_without_padding():
    """`NO_PADDING` — не дрібниця: зайвий '=' змінює дайджест повністю."""
    from hashlib import sha256

    padded = base64.b64encode(A_ED).decode("ascii")  # з '='
    assert padded.endswith("=")
    with_padding = sha256(padded.encode("utf-8")).digest()[:8].hex()
    assert pc.peer_id_of(A_ED) != with_padding


def test_peer_id_takes_eight_bytes_not_thirtytwo():
    from hashlib import sha256

    b64 = base64.b64encode(A_ED).decode("ascii").rstrip("=")
    full = sha256(b64.encode("utf-8")).hexdigest()
    assert pc.peer_id_of(A_ED) == full[:16]
    assert len(full) == 64  # ПК брав би все — 64 символи замість 16


def test_different_keys_give_different_names():
    assert pc.peer_id_of(A_ED) != pc.peer_id_of(B_ED)


def test_a_key_of_the_wrong_size_is_refused_loudly():
    """Тихо порахувати ім'я від огризка ключа — гірше, ніж упасти."""
    with pytest.raises(ValueError):
        pc.peer_id_of(b"\x01" * 31)


def test_non_ascii_names_are_rejected_by_shape():
    """Сіль порівнює РЯДКИ. Kotlin робить це по UTF-16, Python по кодових
    точках; для ASCII вони збігаються, поза ASCII — ні. Тому форма імені є
    умовою сумісності, а не оздобленням."""
    assert not pc.is_peer_id("вузол-один")
    assert not pc.is_peer_id("DC4BF80C77473D13")  # верхній регістр — інший рядок
    assert not pc.is_peer_id("dc4bf80c")  # 8 символів, не 16


# ── Ключ каналу ──────────────────────────────────────────────────────────────


def test_both_sides_derive_the_same_channel_key():
    """Симетрія солі — інакше двоє слухали б різні скриньки й обидва мали
    рацію."""
    a_id, b_id = pc.peer_id_of(A_ED), pc.peer_id_of(B_ED)
    key_a = pc.channel_key(A_PRIV, pc.public_b64(B_PRIV), a_id, b_id)
    key_b = pc.channel_key(B_PRIV, pc.public_b64(A_PRIV), b_id, a_id)
    assert key_a is not None and key_a == key_b
    assert len(key_a) == pc.KEY_SIZE_BYTES


def test_the_salt_is_order_independent():
    a_id, b_id = pc.peer_id_of(A_ED), pc.peer_id_of(B_ED)
    assert pc.salt_for(a_id, b_id) == pc.salt_for(b_id, a_id)
    assert pc.SEP.encode() in pc.salt_for(a_id, b_id)


def test_the_context_is_peer_msg_v2_not_the_relay_one():
    """Два РІЗНІ контексти: цей виводить ключ пари, той робить із нього
    адреси. Переплутати — значить мовчки розійтись із телефоном."""
    from node import peer_relay as pr

    assert pc.INFO == b"PHANTOM OS/peer-msg-v2"
    assert pc.INFO != pr.INFO


def test_a_different_peer_gives_a_different_key():
    """Ключ прив'язаний до пари, а не лише до спільного секрету."""
    a_id, b_id = pc.peer_id_of(A_ED), pc.peer_id_of(B_ED)
    theirs = pc.public_b64(B_PRIV)
    assert pc.channel_key(A_PRIV, theirs, a_id, b_id) != pc.channel_key(
        A_PRIV, theirs, a_id, "ffffffffffffffff"
    )


def test_channel_key_is_reproducible():
    a_id, b_id = pc.peer_id_of(A_ED), pc.peer_id_of(B_ED)
    theirs = pc.public_b64(B_PRIV)
    assert pc.channel_key(A_PRIV, theirs, a_id, b_id) == pc.channel_key(
        A_PRIV, theirs, a_id, b_id
    )


# ── Кривий вхід із чужого запрошення ─────────────────────────────────────────


@pytest.mark.parametrize(
    "their_pub, why",
    [
        ("", "порожній рядок"),
        ("   ", "самі пробіли"),
        ("не-base64!!!", "не декодується"),
        (base64.b64encode(b"\x01" * 31).decode(), "31 байт замість 32"),
        (base64.b64encode(b"\x01" * 33).decode(), "33 байти замість 32"),
    ],
)
def test_a_broken_invite_returns_none_and_does_not_raise(their_pub, why):
    """Сюди приходять поля з ЧУЖОГО запрошення. Кривий рядок від сусіда не
    має валити вузол — це стан, а не виняток."""
    a_id, b_id = pc.peer_id_of(A_ED), pc.peer_id_of(B_ED)
    assert pc.channel_key(A_PRIV, their_pub, a_id, b_id) is None, why


def test_padding_in_their_public_key_is_tolerated():
    """Телефон шле без набивки, але чужа реалізація могла її лишити — і це не
    привід не порозумітися."""
    a_id, b_id = pc.peer_id_of(A_ED), pc.peer_id_of(B_ED)
    bare = pc.public_b64(B_PRIV)
    padded = bare + "=" * (-len(bare) % 4)
    assert pc.channel_key(A_PRIV, padded, a_id, b_id) == pc.channel_key(
        A_PRIV, bare, a_id, b_id
    )


def test_a_separator_inside_a_name_cannot_forge_the_salt():
    """Роздільник недрукований саме тому, що ім'я не має вміти вдати межу."""
    a_id = pc.peer_id_of(A_ED)
    assert pc.channel_key(A_PRIV, pc.public_b64(B_PRIV), a_id, f"a{pc.SEP}b") is None


def test_our_public_key_is_base64_without_padding():
    """Телефон декодує стандартним алфавітом; зайвий '=' він стерпить, але
    надсилати його не треба — контракт каже NO_PADDING."""
    pub = pc.public_b64(A_PRIV)
    assert "=" not in pub
    assert "\n" not in pub
    assert len(base64.b64decode(pub + "==")) == 32
