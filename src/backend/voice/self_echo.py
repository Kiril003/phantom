"""Фільтр самопрослуховування в текстовій області.

ПК чує власний динамік. Скасувати ехо в сигналі ми не можемо — відлік
відтворення живе у браузері з невідомою затримкою. Але ми точно знаємо, ЩО
саме зараз промовляємо, і цього досить: партіал, який є впорядкованою
підмножиною щойно сказаного, — це не людина, а ми самі.

Ціна помилки несиметрична, і фільтр нахилений навмисне. Пропустити ехо —
PHANTOM перебиває сам себе (те, заради чого модуль існує). Відкинути справжню
репліку — гучність повертається за 700 мс і людина говорить ще раз.
"""
from __future__ import annotations

_APOSTROPHES = str.maketrans({"’": "'", "ʼ": "'", "`": "'"})
_KEEP = "'-"
_MAX_SPOKEN_TOKENS = 240


def normalize_tokens(text: str) -> list[str]:
    if not text:
        return []
    lowered = text.lower().translate(_APOSTROPHES)
    cleaned = "".join(
        ch if (ch.isalnum() or ch in _KEEP) else " " for ch in lowered
    )
    return [t for t in (w.strip(_KEEP) for w in cleaned.split()) if t]


def _ordered_match_len(heard: list[str], spoken: list[str]) -> int:
    prev = [0] * (len(spoken) + 1)
    for word in heard:
        cur = [0] * (len(spoken) + 1)
        for j, other in enumerate(spoken, 1):
            cur[j] = (
                prev[j - 1] + 1 if word == other else max(prev[j], cur[j - 1])
            )
        prev = cur
    return prev[-1]


def is_probable_echo(
    partial_text: str,
    spoken_recent: list[str] | tuple[str, ...] | None,
    *,
    min_coverage: float = 0.75,
) -> bool:
    """Чи є партіал луною того, що PHANTOM щойно сказав.

    `spoken_recent` — тексти останніх озвучених речень цього ходу.
    """
    if not 0.0 < min_coverage <= 1.0:
        # Нуль зробив би машину глухою назавжди, і мовчки.
        raise ValueError(f"min_coverage must be in (0, 1] (got {min_coverage})")

    heard = normalize_tokens(partial_text)
    if not heard:
        return False

    spoken: list[str] = []
    for sentence in spoken_recent or ():
        spoken.extend(normalize_tokens(sentence))
    if not spoken:
        return False
    spoken = spoken[-_MAX_SPOKEN_TOKENS:]

    # Порядок має значення: витік ехо приходить послідовністю наших же слів,
    # а перебудована з тих самих слів фраза — це людина.
    return _ordered_match_len(heard, spoken) / len(heard) >= min_coverage


__all__ = ["is_probable_echo", "normalize_tokens"]
