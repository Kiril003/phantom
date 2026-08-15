"""Симбіот — ПК і телефон як один організм, а не два застосунки.

Паринг дав канал і права. Цього мало: канал без спільного стану — це
просто труба. Симбіот стоїть на чотирьох площинах:

  присутність — обидва тіла постійно знають одне про одного: заряд,
                мережа, місце, рух, що зараз на екрані;
  спільний стан — один знімок контексту, зібраний з обох тіл, а не два
                незалежних;
  команди     — будь-яка сторона може попросити іншу зробити те, на що
                має дозвіл, і дізнатись результат;
  тяглість    — розмова, задача й увага переходять з екрана на екран.

Тут живе перша й третя площини та реєстр сесій; друга стоїть на
`core.context_engine`, четверта — на `api/routes_handoff.py`.
"""
from symbiote.presence import PresenceStore, presence_store
from symbiote.commands import (
    SymbioteCommand,
    CommandResult,
    command_registry,
    dispatch_command,
)

__all__ = [
    "PresenceStore",
    "presence_store",
    "SymbioteCommand",
    "CommandResult",
    "command_registry",
    "dispatch_command",
]
