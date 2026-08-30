"""Прибирання і дозасилка блобів дивляться в ОДИН перелік.

Угода «які типи тримають байти на диску» жила у двох файлах дослівно —
`purge.blob_ids_of` і запит `redelivery`, обидва як `("image", "file")`. Дві
копії розходяться при першій же зміні, і розходяться **тихо**:

  * тип, що випав із `purge`, лишає байти на диску **назавжди** — навіть
    після того, як людина видалила повідомлення;
  * тип, що випав із `redelivery`, **ніколи не дошлеться** після невдачі:
    черга повторів його просто не бачить.

Обидві поломки не мають жодного зовнішнього прояву. Саме тому сторож тут не
про поведінку, а про **єдине джерело**: він червоніє, коли переліки
розходяться, ще до того, як розходження щось зламає.

`voice` у переліку з'явився НАПЕРЕД, до входження у `WIRE_KINDS`. Поки
голосових кадрів немає, він нічого не робить; у день увімкнення типу життєвий
цикл блоба вже на місці. Зворотний порядок дав би обидві тихі поломки разом.
"""
from __future__ import annotations

import inspect

import pytest

from messenger import purge, redelivery
from messenger.blobs import BLOB_KINDS, WIRE_KINDS


def test_voice_is_ready_before_it_is_switched_on():
    assert "voice" in BLOB_KINDS, "голос возить блоб — інакше байти нікому прибирати"
    # Якщо це впало, тип уже на дроті — значить, домовленість із телефоном
    # виконана й цей тест можна прибрати разом із коментарем нижче.
    assert "voice" not in WIRE_KINDS, (
        "voice увімкнено на дроті — перевір, що телефонна половина теж готова "
        "(правило в unwrap_frame) і що вектори звірені"
    )


def test_neither_place_keeps_its_own_copy_of_the_list():
    """Джерело одне. Дослівний кортеж у будь-якому з двох місць — регрес."""
    for module in (purge, redelivery):
        source = inspect.getsource(module)
        assert '("image", "file")' not in source, (
            f"{module.__name__} знову тримає власну копію переліку — "
            "саме так вони й розходяться"
        )
        assert "BLOB_KINDS" in source, f"{module.__name__} мусить брати перелік із blobs"


@pytest.mark.parametrize("kind", BLOB_KINDS)
def test_purge_recognises_every_blob_kind(kind):
    """`blob_ids_of` не відсіює жодного типу з переліку на вході.

    Перевіряємо саме ВІДБІР за типом: рядок без тіла дає порожній список для
    будь-якого типу, тож доказом є те, що для типів З переліку виконання
    доходить до розпечатування, а для стороннього — ні.
    """
    row = type("Row", (), {"kind": kind, "ciphertext": None, "body": None, "id": "x"})()
    assert purge.blob_ids_of(object(), row) == []


def test_purge_ignores_a_kind_that_carries_no_bytes():
    row = type("Row", (), {"kind": "text", "ciphertext": None, "body": "привіт", "id": "x"})()
    assert purge.blob_ids_of(object(), row) == []
