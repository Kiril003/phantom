"""Числа живої розмови, спільні для ПК і телефона.

Джерело правди — phantom-companion/docs/live-dialogue-contract.md. Розбіжність
у будь-якому з цих значень люди чують як двох різних співрозмовників, тому
змінювати їх можна лише на обох поверхнях одночасно.
"""
from __future__ import annotations

# ── Черга: коли репліка вважається закінченою ────────────────────────────────
PROVISIONAL_AFTER_QUESTION_MS = 250
PROVISIONAL_MS = 350
COMMIT_AFTER_QUESTION_MS = 450
COMMIT_MS = 700
COMMIT_INCOMPLETE_MS = 1200
PATIENCE_MS = 2500
# Стеля однієї паузи. Репліка з самих вагань не закривається ніколи — без цієї
# межі цикл закриття крутився б до кінця світу.
ENDPOINT_MAX_MS = 8000
ENDPOINT_TICK_MS = 50
STABLE_TICKS_FOR_PROVISIONAL = 2

# ── Підтвердження ────────────────────────────────────────────────────────────
ACK_LINES = ("зараз", "секунду", "думаю")
ACK_RULE = (
    "Підтвердження каже про СТАН PHANTOM і ніколи — про відповідь. "
    "Жодних дієслів минулого часу; «так» заборонене. "
    "Черга по колу, не випадковий вибір."
)
ACK_AFTER_MS = 900
ACK_SUPPRESS_MS = 250
NEVER_SILENT_MS = 1500
TOOL_CHECKPOINT_MS = 8000
TOOL_CHECKPOINT_LINE = "ще секунду"

# ── Перехоплення ─────────────────────────────────────────────────────────────
BARGE_IN_CONFIRM_MS = 700
BARGE_IN_DUCK_GAIN = 0.25  # −12 дБ
STOP_WORDS = ("стоп", "фантом")

# Позначка обриву: в історію лягає те, що людина СПРАВДІ почула.
INTERRUPT_MARK_PREFIX = "⟦перервано після: «"
INTERRUPT_MARK_SUFFIX = "»⟧"
INTERRUPT_HEARD_TAIL_CHARS = 60


def interrupt_mark(heard: str) -> str:
    tail = (heard or "").strip()[-INTERRUPT_HEARD_TAIL_CHARS:]
    return f"{INTERRUPT_MARK_PREFIX}{tail}{INTERRUPT_MARK_SUFFIX}"


__all__ = [
    "ACK_AFTER_MS",
    "ACK_LINES",
    "ACK_RULE",
    "ACK_SUPPRESS_MS",
    "BARGE_IN_CONFIRM_MS",
    "BARGE_IN_DUCK_GAIN",
    "COMMIT_AFTER_QUESTION_MS",
    "COMMIT_INCOMPLETE_MS",
    "COMMIT_MS",
    "ENDPOINT_MAX_MS",
    "ENDPOINT_TICK_MS",
    "INTERRUPT_HEARD_TAIL_CHARS",
    "INTERRUPT_MARK_PREFIX",
    "INTERRUPT_MARK_SUFFIX",
    "NEVER_SILENT_MS",
    "PATIENCE_MS",
    "PROVISIONAL_AFTER_QUESTION_MS",
    "PROVISIONAL_MS",
    "STABLE_TICKS_FOR_PROVISIONAL",
    "STOP_WORDS",
    "TOOL_CHECKPOINT_LINE",
    "TOOL_CHECKPOINT_MS",
    "interrupt_mark",
]
