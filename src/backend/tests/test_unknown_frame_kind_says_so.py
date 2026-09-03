"""Кадр невідомого типу мусить назвати себе, а не виглядати поломкою.

Знайдено 29.08.2026, коли з'ясувалось, що дріт ніс ТОДІ рівно сім типів
(`WIRE_KINDS`), а месенджерний «хаб дій» уміє створювати дев'ять. Сьогодні у
`WIRE_KINDS` теж дев'ять — 31.08.2026 додались `edit` і `reaction`. Число тут
історичне: сторож рахує не його, а сам перелік. Було так:

    if kind not in WIRE_KINDS:
        return "text", plaintext, "", ""

Тобто співрозмовникові на екран лягав СИРИЙ КАДР — у кращому разі JSON. Для
людини різниця величезна: «ця версія не вміє показати» вона розуміє і йде
оновлюватись, а сире тіло читає як «продукт зламався».

І це не косметика, а ПЕРЕДУМОВА розширення протоколу: у день, коли новий тип
додадуть у `WIRE_KINDS`, кожен на старій збірці побачить сміття — і це
виглядатиме нашою поломкою, а не його старою версією. Тому правило, записане
і в коді: **перш ніж додавати тип у `WIRE_KINDS`, обидва боки мусять уміти
чесно сказати «не вмію показати»**.

Друга половина — відправник. `wrap_frame` брав що завгодно і спокійно
випускав чужий тип на дріт. Тепер відмовляється явно: невідповідність видно в
розробника, а не в чужій стрічці.
"""
from __future__ import annotations

import pytest

from messenger.blobs import WIRE_KINDS, unwrap_frame, wrap_frame


def test_a_known_kind_still_travels_untouched():
    """Спершу — що нічого не зламано для справжніх типів, скільки б їх не було."""
    for kind in WIRE_KINDS:
        wire = wrap_frame(kind, "тіло")
        got_kind, body, _, _ = unwrap_frame(wire)
        assert got_kind == kind
        assert body == "тіло"


def test_plain_text_without_a_header_is_still_plain_text():
    """Старий кадр без префікса розбирається як раніше — сумісність із
    вузлом, який про типи ще не знає."""
    assert unwrap_frame("просто рядок") == ("text", "просто рядок", "", "")


def test_an_unknown_kind_explains_itself_instead_of_showing_json():
    """Головне: людина бачить пояснення, а не тіло кадру."""
    payload = '{"question":"Коли виїжджаємо?","options":["зараз","на світанку"]}'
    wire = f"\x01phantom-kind:poll\n{payload}"

    kind, body, origin, group = unwrap_frame(wire)

    assert kind == "text"
    assert "poll" in body
    assert "не вміє" in body and "Оновіть" in body
    # Найважливіше: сирого тіла на екрані немає.
    assert payload not in body
    assert "options" not in body
    assert (origin, group) == ("", "")


def test_the_name_of_the_unknown_kind_cannot_smuggle_anything():
    """Ім'я типу приїхало ззовні, тож у текст воно потрапляє очищеним."""
    wire = "\x01phantom-kind:<img src=x>\nтіло"
    _, body, _, _ = unwrap_frame(wire)
    assert "<" not in body and ">" not in body


def test_a_nameless_unknown_kind_still_reads_like_a_sentence():
    wire = "\x01phantom-kind:!!!\nтіло"
    _, body, _, _ = unwrap_frame(wire)
    assert "невідомий" in body


def test_the_sender_refuses_an_unknown_kind_out_loud():
    """Відправник не покладається на дисципліну викликача.

    Доти `wrap_frame` випускав будь-що, і помилка спливала на ЧУЖОМУ екрані.
    Тепер вона спливає тут.
    """
    with pytest.raises(ValueError, match="WIRE_KINDS"):
        wrap_frame("poll", '{"question":"…"}')


def test_the_refusal_names_the_rule_not_just_the_fact():
    """Повідомлення помилки має вести до правила, інакше наступний просто
    допише тип у перелік і зламає сумісність тихо."""
    with pytest.raises(ValueError) as err:
        wrap_frame("task-list", "тіло")
    text = str(err.value)
    assert "обома боками" in text or "обома" in text or "unwrap_frame" in text
