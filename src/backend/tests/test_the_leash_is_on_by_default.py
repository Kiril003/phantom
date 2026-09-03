"""Замки агента ввімкнені, доки їх не зняли свідомо — на КОЖНОМУ вході.

Що сталося. Коміт `dfe4f77 «Emergency restore: clearing corrupted objects»`
(591 файл, +70402/−10737) приніс `unsafe_mode = True` у шість місць бекенда.
Пʼять із них згодом полагодили поодинці — `agent/actions/base.py` (Ctx),
`agent/kernel/executor.py`, `agent/kernel/rehydrate.py` і три літерали
`Ctx(..., unsafe_mode=True)` у петлі. Шосте — `agent/kernel/runtime.py`, тобто
місце, де задачі НАРОДЖУЮТЬСЯ, — простояло до 03.09.2026.

Чому це найгірше з можливих місць. Кожні ворота в петлі написані як
`if (not state.unsafe_mode) and …`: поріг ризику, згода людини, автозапуск
ради на високому ризику, пісочниця bwrap для bash.run і fs.*. При `True` не
працює жодні. Доведено тестом: `git.rollback` — це `git reset --hard HEAD~1` —
виконувався, нікого не спитавши й не лишивши рядка аудиту, тобто схвалення,
якого не давала жодна людина, було не відрізнити від справжнього.

Чому це прожило непоміченим. HTTP-двері чесні (`routes_agent.py` має False),
тож вхід, у який усі дивляться, виглядав правильно — а кожен внутрішній шлях
ні. Коментар прямо над полем казав «Defaults False (current behaviour)»,
тобто код суперечив власному опису. Сторож, що це ловить, стояв червоним
усередині скрині, яка не вміла навіть зібратись через два зламані модулі.

Тому цей файл пінить не поведінку однієї гілки, а САМЕ ЗАМОВЧУВАННЯ — на всіх
входах одразу, включно з тими, куди HTTP не заходить: черга, делегування,
місії, відновлення з контрольної точки. Одного разу пропущений вхід — і замки
знову зняті мовчки.
"""
from __future__ import annotations

import dataclasses
import inspect
import os
import re
from pathlib import Path

import pytest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-leash")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

LOOP_PATH = Path(__file__).resolve().parent.parent / "agent" / "kernel" / "loop.py"


def _default_of(cls, field_name: str):
    """Половина цих типів — dataclass, половина — pydantic-модель. Питаємо
    той механізм, який у класу справді є, а не той, який ми припустили."""
    fields = getattr(cls, "model_fields", None)
    if fields is not None:  # pydantic BaseModel
        assert field_name in fields, (
            f"{cls.__name__} більше не має поля {field_name}"
        )
        return fields[field_name].default
    for field in dataclasses.fields(cls):
        if field.name == field_name:
            return field.default
    raise AssertionError(f"{cls.__name__} більше не має поля {field_name}")


def test_task_state_is_leashed_at_birth():
    """Джерело всіх інших замовчувань: конструктори в spawn.py, rehydrate.py
    і runtime.py створюють TaskState, НЕ передаючи unsafe_mode."""
    from agent.kernel.runtime import TaskState

    assert _default_of(TaskState, "unsafe_mode") is False


def test_queued_task_is_leashed():
    from agent.kernel.runtime import QueuedTask

    assert _default_of(QueuedTask, "unsafe_mode") is False


def test_action_context_is_leashed():
    """Контекст їде в КОЖНУ дію — саме він вирішує, чи буде пісочниця.
    Петля будує його як `Ctx(...)` через локальний псевдонім, але клас
    називається ActionContext; шукати треба справжнє імʼя, інакше сторож
    падає на власному імпорті замість того, щоб щось довести."""
    from agent.actions.base import ActionContext

    assert _default_of(ActionContext, "unsafe_mode") is False


@pytest.mark.parametrize(
    "module_path, func_name",
    [
        ("agent.kernel.runtime", "start_task"),
        ("agent.kernel.runtime", "_spawn_task"),
        ("agent.kernel.runtime", "start_mission"),
    ],
)
def test_every_entry_point_is_leashed(module_path, func_name):
    """Входи, куди HTTP не заходить: делегування підагентів, місії, черга.
    `routes_agent.py` завжди передає значення явно — саме тому дефект і був
    невидимий з боку API."""
    import importlib

    module = importlib.import_module(module_path)
    func = getattr(getattr(module, "AgentRuntime"), func_name)
    param = inspect.signature(func).parameters.get("unsafe_mode")
    assert param is not None, f"{func_name} більше не приймає unsafe_mode"
    assert param.default is False, (
        f"{func_name}: замовчування {param.default!r} — задача народжується "
        "без замків, і жодні ворота петлі до неї не застосуються"
    )


def test_a_checkpoint_without_the_field_comes_back_leashed():
    """Відновлення з контрольної точки — окремий вхід: старий blob поля не
    має взагалі, і `.get(key, True)` тихо повернув би задачу без замків."""
    source = (
        Path(__file__).resolve().parent.parent
        / "agent" / "kernel" / "rehydrate.py"
    ).read_text(encoding="utf-8")
    assert 'blob.get("unsafe_mode", False)' in source, (
        "відновлення з контрольної точки мусить типово ЗАМИКАТИ задачу"
    )


def test_every_gate_reads_the_flag_the_same_way():
    """Усі ворота написані як `not …unsafe_mode`. Одні ворота, написані
    навпаки, зняли б замки лише для себе — і це помітили б не скоро."""
    source = LOOP_PATH.read_text(encoding="utf-8")
    mentions = [
        line.strip()
        for line in source.splitlines()
        if re.search(r"\bunsafe_mode\b", line)
        and line.strip().startswith(("if ", "elif "))
    ]
    assert mentions, "у петлі не лишилось жодних воріт на unsafe_mode"
    for line in mentions:
        assert "not " in line, (
            f"ворота читають прапорець не через `not`: {line!r} — "
            "інвертована умова знімає замки саме там, де їх чекають"
        )


def test_the_loop_never_hardcodes_the_flag():
    """У петлі стояли три літерали `Ctx(..., unsafe_mode=True)` — задача
    могла бути замкнена, а дія все одно їхала без пісочниці."""
    source = LOOP_PATH.read_text(encoding="utf-8")
    assert "unsafe_mode=True" not in source, (
        "петля знову зашила прапорець літералом замість state.unsafe_mode"
    )
