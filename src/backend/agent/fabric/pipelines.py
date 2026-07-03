"""Artifact Foundry — declarative pipelines: brief → MissionGraph.

A pipeline owns only the *shape* of the graph (nodes, gates, crew roles,
ETAs). Execution is always the same governor — that is what makes ПОЛІС
a substrate instead of a feature pile.
"""
from __future__ import annotations

import json
import logging
import re
import uuid

from agent.fabric.graph import (
    CrewSpec,
    Domain,
    MissionGraph,
    NodeBudget,
    PlanNode,
)

logger = logging.getLogger(__name__)

PIPELINES: dict[str, Domain] = {
    "dev_studio": "dev",
    "research_library": "research",
    "observatory": "analytics",
    "scriptorium": "document",
    "game_studio": "game",
    "generic": "generic",
}


def _node(
    title: str,
    *,
    kind: str = "workstream",
    domain: Domain,
    deps: list[str],
    prompt: str,
    roles: list[str] | None = None,
    eta: int = 15,
    gate: str | None = None,
    tokens: int = 120_000,
    calls: int = 25,
) -> PlanNode:
    return PlanNode(
        id=uuid.uuid4().hex[:12],
        kind=kind,  # type: ignore[arg-type]
        title=title,
        domain=domain,
        depends_on=deps,
        prompt=prompt,
        crew=CrewSpec(roles=roles or [], size=max(1, len(roles or []))),
        gate_kind=gate,  # type: ignore[arg-type]
        eta_minutes=eta,
        budget=NodeBudget(max_tokens=tokens, max_llm_calls=calls),
    )


def _chain(graph: MissionGraph, specs: list[PlanNode]) -> None:
    for node in specs:
        graph.add(node)


def build_dev_studio(brief: str) -> MissionGraph:
    g = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    arch = _node(
        "Архітектура і план модулів", domain="dev", deps=[],
        roles=["senior_architect"], eta=20,
        prompt=(
            "Ти senior архітектор. Розбий цей застосунок на модулі з чіткими "
            f"інтерфейсами, обери стек, опиши структуру файлів.\nБриф:\n{brief}"
        ),
    )
    g.add(arch)
    core = _node(
        "Ядро: моделі даних + бізнес-логіка", domain="dev", deps=[arch.id],
        roles=["senior_backend"], eta=30,
        prompt="Реалізуй ядро за архітектурою з попереднього кроку. Повний код, без заглушок.",
    )
    ui = _node(
        "Інтерфейс користувача", domain="dev", deps=[arch.id],
        roles=["senior_frontend", "designer"], eta=30,
        prompt="Реалізуй UI за архітектурою. Повний код компонентів.",
    )
    g.add(core); g.add(ui)
    tests = _node(
        "Тести і крайні випадки", domain="dev", deps=[core.id, ui.id],
        roles=["senior_test"], eta=20,
        prompt="Напиши тести для ядра та UI. Знайди крайні випадки і зафіксуй їх тестами.",
    )
    g.add(tests)
    review = _node(
        "Критичне рев'ю збірки", domain="dev", deps=[tests.id],
        kind="gate", gate="quality", roles=["senior_security"], eta=10,
        prompt="Проведи безжальне рев'ю всієї роботи: дірки, суперечності, недороблене. Вердикт: SHIP або список блокерів.",
    )
    g.add(review)
    ship = _node(
        "Фінальна збірка і інструкція запуску", domain="dev", deps=[review.id],
        roles=["documentation_writer"], eta=10,
        prompt="Збери фінальний результат: що зроблено, як запустити, що далі.",
    )
    g.add(ship)
    return g


def build_research_library(brief: str) -> MissionGraph:
    g = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    scope = _node(
        "Мапа дослідження: питання і джерела", domain="research", deps=[],
        roles=["team_lead_research"], eta=15,
        prompt=(
            "Розбий тему на 4-6 дослідницьких питань. Для кожного — де шукати "
            f"(типи джерел, ключові слова UA/EN).\nТема:\n{brief}"
        ),
    )
    g.add(scope)
    streams = []
    for i in range(3):
        s = _node(
            f"Дослідницький потік {i + 1}", domain="research", deps=[scope.id],
            roles=["domain_researcher"], eta=25,
            prompt=(
                f"Візьми питання №{i + 1}-{i + 2} з мапи дослідження. Дай глибокий "
                "розбір з фактами, цифрами, іменами. Кожен факт — з позначкою впевненості."
            ),
        )
        g.add(s); streams.append(s)
    cross = _node(
        "Перехресна перевірка фактів", domain="research", deps=[s.id for s in streams],
        roles=["data_analyst"], eta=15,
        prompt="Знайди суперечності між потоками. Кожну — розв'яжи або познач як відкриту.",
    )
    g.add(cross)
    synth = _node(
        "Синтез: фінальний звіт", domain="research", deps=[cross.id],
        roles=["documentation_writer"], eta=20,
        prompt="Збери все у зв'язний звіт: висновки, докази, відкриті питання, бібліографія.",
    )
    g.add(synth)
    return g


def build_observatory(brief: str) -> MissionGraph:
    g = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    frame = _node(
        "Постановка: що прогнозуємо і чому", domain="analytics", deps=[],
        roles=["data_analyst"], eta=10,
        prompt=f"Сформулюй прогнозні питання, метрики, горизонти, необхідні дані.\nЗапит:\n{brief}",
    )
    g.add(frame)
    base = _node(
        "Базові сценарії", domain="analytics", deps=[frame.id],
        roles=["data_analyst"], eta=20,
        prompt="Побудуй 3 сценарії (оптимістичний/базовий/песимістичний) з рушійними факторами.",
    )
    contra = _node(
        "Червона команда: що зламає прогноз", domain="analytics", deps=[frame.id],
        roles=["osint"], eta=15,
        prompt="Знайди фактори, які всі ігнорують. Чорні лебеді, слабкі сигнали.",
    )
    g.add(base); g.add(contra)
    final = _node(
        "Прогноз з довірчими інтервалами", domain="analytics", deps=[base.id, contra.id],
        roles=["team_lead_research"], eta=15,
        prompt="Зведи сценарії і контраргументи у фінальний прогноз: ймовірності, інтервали, тригери перегляду.",
    )
    g.add(final)
    return g


def build_scriptorium(brief: str) -> MissionGraph:
    g = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    outline = _node(
        "Скелет документа + канон", domain="document", deps=[],
        roles=["documentation_writer"], eta=15,
        prompt=(
            "Побудуй повний зміст документа (розділи, підрозділи) + канон: "
            f"глосарій, тон, наскрізні сутності.\nЗамовлення:\n{brief}"
        ),
    )
    g.add(outline)
    parts = []
    for i in range(4):
        p = _node(
            f"Розділи, чверть {i + 1}", domain="document", deps=[outline.id],
            roles=["documentation_writer"], eta=25,
            prompt=(
                f"Напиши чверть №{i + 1} документа за скелетом, строго тримаючись "
                "канону і глосарію. Повний текст, без конспектів."
            ),
        )
        g.add(p); parts.append(p)
    style = _node(
        "Прохід консистентності", domain="document", deps=[p.id for p in parts],
        roles=["translator"], eta=20,
        prompt="Пройди всі чверті: єдиний тон, терміни за глосарієм, шви між чвертями невидимі.",
    )
    g.add(style)
    return g


def build_game_studio(brief: str) -> MissionGraph:
    g = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    gdd = _node(
        "GDD: дизайн-документ гри", domain="game", deps=[],
        roles=["product_manager", "designer"], eta=20,
        prompt=f"Створи стислий GDD: core loop, механіки, прогресія, стиль.\nІдея:\n{brief}",
    )
    g.add(gdd)
    engine = _node(
        "Рушій: сцена + core loop", domain="game", deps=[gdd.id],
        roles=["senior_frontend"], eta=35,
        prompt="Реалізуй ігровий цикл на canvas: сцена, ввід, фізика, стан. Повний код.",
    )
    art = _node(
        "Арт-напрям і асети", domain="game", deps=[gdd.id],
        roles=["designer"], eta=20,
        prompt="Опиши/згенеруй асети: палітра, спрайти (SVG/CSS), звукові тригери.",
    )
    g.add(engine); g.add(art)
    play = _node(
        "Playable milestone", domain="game", deps=[engine.id, art.id],
        kind="gate", gate="quality", roles=["manual_qa"], eta=15,
        prompt="Перевір збірку як гравець: чи весело, що зламано, що ріже око. Вердикт + список.",
    )
    g.add(play)
    polish = _node(
        "Полірування і релізна збірка", domain="game", deps=[play.id],
        roles=["senior_frontend"], eta=20,
        prompt="Виправ знайдене, з'єднай все в один робочий файл гри.",
    )
    g.add(polish)
    return g


_JSON_BLOCK = re.compile(r"\{.*\}", re.S)


async def build_generic(brief: str) -> MissionGraph:
    """LLM decomposes the brief into a graph; single-node fallback on any failure."""
    g = MissionGraph(mission_id=uuid.uuid4().hex[:12])
    try:
        from ai.provider_mesh import get_mesh
        resp = await get_mesh().generate(
            system_prompt=(
                "Ти стратегічний планувальник. Розбий завдання на 2-7 кроків. "
                "Відповідай ТІЛЬКИ JSON: {\"steps\": [{\"title\": str, "
                "\"prompt\": str, \"role\": str, \"eta_minutes\": int, "
                "\"depends_on\": [індекси попередніх кроків]}]}"
            ),
            user_message=brief,
        )
        match = _JSON_BLOCK.search(getattr(resp, "text", "") or "")
        steps = json.loads(match.group(0))["steps"] if match else []
        ids: list[str] = []
        for step in steps[:7]:
            deps = [ids[i] for i in step.get("depends_on", []) if 0 <= i < len(ids)]
            node = _node(
                str(step.get("title", "Крок"))[:120],
                domain="generic",
                deps=deps,
                roles=[str(step.get("role", "domain_researcher"))],
                eta=int(step.get("eta_minutes", 15)),
                prompt=str(step.get("prompt", brief)),
            )
            g.add(node)
            ids.append(node.id)
        if ids:
            return g
    except Exception as exc:
        logger.warning("generic planner failed (%s) — single-node fallback", exc)
    g.add(_node("Виконати завдання", domain="generic", deps=[], prompt=brief, eta=20))
    return g


async def plan_mission(brief: str, pipeline: str) -> MissionGraph:
    builders = {
        "dev_studio": build_dev_studio,
        "research_library": build_research_library,
        "observatory": build_observatory,
        "scriptorium": build_scriptorium,
        "game_studio": build_game_studio,
    }
    if pipeline in builders:
        graph = builders[pipeline](brief)
    else:
        graph = await build_generic(brief)
    graph.validate_acyclic()
    return graph
