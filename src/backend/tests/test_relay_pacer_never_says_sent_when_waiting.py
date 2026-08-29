"""Чи тримає розсилання свій темп — і чи каже правду, коли не може слати.

Три вимоги, під які цей модуль писався:
  1. Черга має ВЛАСНИЙ темп, а не «все накопичене одним залпом»: перша ж
     синхронізація після довгого офлайну інакше впреться в стелю сервера
     саме тоді, коли листи найпотрібніші.
  2. `Busy` — не мовчазний повтор. Людині видно, що лист ЧЕКАЄ, а не
     «надіслано».
  3. Найгірший випадок порахований, а не на око: скільки листів = скільки
     хвилин. І це перевіряється тестом, бо число в коментарі застаріває
     першим.

Час сюди подається ззовні, тому тут немає ні сну, ні реального годинника:
темп перевіряється арифметикою, а не очікуванням.
"""
from __future__ import annotations

import pytest

from node.relay_pacer import (
    DEFAULT_SENDS_PER_MINUTE,
    SERVER_LIMIT_PER_MINUTE,
    SERVER_WINDOW_S,
    Go,
    RelayPacer,
    Wait,
)


# ── 1. Власний темп ──────────────────────────────────────────────────────────


def test_a_long_backlog_does_not_go_out_in_one_burst():
    """Головна вимога. 500 листів після офлайну не мають перетворитись на
    500 запитів за секунду."""
    pacer = RelayPacer()
    verdict = pacer.check(now=1_000.0, pending=500)
    assert isinstance(verdict, Go)
    assert verdict.allowance == DEFAULT_SENDS_PER_MINUTE
    assert verdict.allowance < 500


def test_the_window_closes_after_the_allowance_is_spent():
    pacer = RelayPacer(sends_per_minute=5)
    pacer.note_sent(now=1_000.0, count=5)
    verdict = pacer.check(now=1_000.5, pending=10)
    assert isinstance(verdict, Wait)
    assert 59.0 < verdict.seconds <= 60.0


def test_the_window_slides_it_does_not_reset():
    """Ковзне вікно, а не відро, що спорожнюється раз на хвилину: інакше на
    межі хвилини вийшов би подвійний залп."""
    pacer = RelayPacer(sends_per_minute=3)
    pacer.note_sent(now=1_000.0)
    pacer.note_sent(now=1_030.0)
    pacer.note_sent(now=1_050.0)
    assert isinstance(pacer.check(now=1_051.0), Wait)

    # Перше відправлення випало з вікна — звільнилось рівно одне місце.
    verdict = pacer.check(now=1_060.5)
    assert isinstance(verdict, Go) and verdict.allowance == 1


def test_we_stay_well_under_the_server_ceiling():
    """Ліміт рахується НА IP, а телефон і ПК за одним NAT — це одна IP.
    Забравши всю стелю, ПК заглушив би телефон власника."""
    assert DEFAULT_SENDS_PER_MINUTE < SERVER_LIMIT_PER_MINUTE
    assert DEFAULT_SENDS_PER_MINUTE <= SERVER_LIMIT_PER_MINUTE // 4


def test_a_tempo_above_the_ceiling_is_refused_loudly():
    """Такий темп — це гарантовані 429, кожен з яких з'їдає спробу дарма."""
    with pytest.raises(ValueError, match="стелю сервера"):
        RelayPacer(sends_per_minute=SERVER_LIMIT_PER_MINUTE + 1)
    with pytest.raises(ValueError):
        RelayPacer(sends_per_minute=0)


# ── 2. Чекає — значить чекає, а не «надіслано» ───────────────────────────────


def test_waiting_carries_a_reason_a_human_can_read():
    pacer = RelayPacer(sends_per_minute=1)
    pacer.note_sent(now=100.0)
    verdict = pacer.check(now=101.0, pending=7)
    assert isinstance(verdict, Wait)
    assert "черга" in verdict.reason
    assert "7" in verdict.reason, "людині треба бачити, скільки ще лишилось"


def test_a_spent_request_counts_even_when_the_letter_did_not_land():
    """`note_sent` кличеться на БУДЬ-ЯКУ відповідь — включно з Full і Refused.

    Сервер порахував запит у своєму вікні незалежно від того, чи лист ліг.
    Вдавати, що запиту не було, означає впертись у 429 на рівному місці.
    """
    pacer = RelayPacer(sends_per_minute=2)
    pacer.note_sent(now=10.0)  # ліг
    pacer.note_sent(now=10.1)  # дістав 507, але запит витрачено
    assert isinstance(pacer.check(now=10.2), Wait)


def test_a_429_from_the_server_closes_our_window_without_guessing():
    """Сервер сказав «забагато» — отже за тією самою IP шле ще хтось.

    Чуже ми не рахуємо й не вгадуємо: просто вважаємо своє вікно повним.
    """
    pacer = RelayPacer(sends_per_minute=10)
    assert isinstance(pacer.check(now=500.0), Go)
    pacer.note_server_said_busy(now=500.0)
    verdict = pacer.check(now=500.1)
    assert isinstance(verdict, Wait)
    assert verdict.seconds > 0


def test_after_the_full_window_passes_sending_resumes():
    """Стан «чекає» мусить бути тимчасовим. Черга, що застрягла назавжди, —
    той самий мовчазний нуль, лише повільніший."""
    pacer = RelayPacer(sends_per_minute=4)
    pacer.note_sent(now=0.0, count=4)
    assert isinstance(pacer.check(now=1.0), Wait)
    resumed = pacer.check(now=SERVER_WINDOW_S + 0.1)
    assert isinstance(resumed, Go) and resumed.allowance == 4


# ── 3. Найгірший випадок — числом ────────────────────────────────────────────


@pytest.mark.parametrize(
    "pending, minutes",
    [(0, 0), (30, 1), (120, 4), (600, 20), (3_600, 120)],
)
def test_worst_case_matches_the_table_in_the_docstring(pending, minutes):
    """Саме ця таблиця стоїть у шапці модуля. Тест тримає її чесною."""
    assert RelayPacer().minutes_to_drain(pending) == pytest.approx(minutes)


def test_eta_rounds_up_because_promising_less_is_worse():
    pacer = RelayPacer()
    assert pacer.human_eta(0) == "черга порожня"
    assert pacer.human_eta(1) == "близько 1 хв"  # 2 секунди, але кажемо хвилину
    assert pacer.human_eta(31) == "близько 2 хв"
    assert "год" in pacer.human_eta(3_600)


def test_a_faster_tempo_drains_proportionally_faster():
    assert RelayPacer(sends_per_minute=60).minutes_to_drain(600) == pytest.approx(10)
    assert RelayPacer(sends_per_minute=15).minutes_to_drain(600) == pytest.approx(40)
