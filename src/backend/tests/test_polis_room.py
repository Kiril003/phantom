"""ПОЛІС mission room — chat steering, worker transcripts, artifact safety."""
from __future__ import annotations

import json
import os

import pytest

from agent.fabric.graph import MissionGraph, PlanNode
from agent.fabric.service import ActiveMission, PolisService, _POLIS_HOME


class FakeResp:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeMesh:
    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.calls: list[dict] = []

    async def generate(self, **kw):
        self.calls.append(kw)
        return FakeResp(self.replies.pop(0))

    async def generate_stream(self, *, system_prompt, user_message, on_delta, **kw):
        self.calls.append({"system_prompt": system_prompt, "user_message": user_message})
        text = self.replies.pop(0)
        for i in range(0, len(text), 7):
            await on_delta(text[i : i + 7])
        return text


@pytest.fixture
def svc(monkeypatch):
    service = PolisService()
    graph = MissionGraph(mission_id="a1b2c3d4e5f6")
    graph.add(PlanNode(id="a", title="Архітектура", prompt="спроєктуй", status="done",
                       output_summary="модулі готові"))
    graph.add(PlanNode(id="b", title="Ядро", prompt="реалізуй", depends_on=["a"]))
    m = ActiveMission("a1b2c3d4e5f6", "u1", "Тест", "бриф", "dev_studio", graph)
    service.missions["a1b2c3d4e5f6"] = m

    async def no_emit(*a, **k):
        return None

    async def no_persist(*a, **k):
        return None

    monkeypatch.setattr(service, "_emit", no_emit)
    monkeypatch.setattr(service, "_persist", no_persist)
    return service


def _patch_mesh(monkeypatch, mesh: FakeMesh) -> None:
    import agent.fabric.service as svc_mod
    import ai.provider_mesh as mesh_mod
    monkeypatch.setattr(mesh_mod, "get_mesh", lambda: mesh)


@pytest.mark.asyncio
async def test_chat_answers_and_stores_history(svc, monkeypatch):
    mesh = FakeMesh([json.dumps({"reply": "Ядро в черзі, архітектура готова."})])
    _patch_mesh(monkeypatch, mesh)
    reply = await svc.chat("a1b2c3d4e5f6", "як справи з ядром?")
    assert "черзі" in reply["text"]
    roles = [c["role"] for c in svc.missions["a1b2c3d4e5f6"].chat]
    assert roles == ["operator", "phantom"]
    assert "СТАН:" in mesh.calls[0]["system_prompt"]
    assert "Архітектура" in mesh.calls[0]["system_prompt"]


@pytest.mark.asyncio
async def test_chat_add_node_action_extends_live_graph(svc, monkeypatch):
    mesh = FakeMesh([json.dumps({
        "reply": "Додаю крок безпеки.",
        "actions": [{"type": "add_node", "title": "Аудит безпеки",
                     "prompt": "перевір OWASP", "after": ["b"]}],
    })])
    _patch_mesh(monkeypatch, mesh)
    reply = await svc.chat("a1b2c3d4e5f6", "додай перевірку безпеки після ядра")
    assert any(a.startswith("add_node:") for a in reply["applied"])
    g = svc.missions["a1b2c3d4e5f6"].graph
    added = [n for n in g.nodes.values() if n.title == "Аудит безпеки"]
    assert len(added) == 1 and added[0].depends_on == ["b"]


@pytest.mark.asyncio
async def test_chat_pause_resume_actions(svc, monkeypatch):
    mesh = FakeMesh([
        json.dumps({"reply": "Ставлю на паузу.", "actions": [{"type": "pause"}]}),
        json.dumps({"reply": "Продовжую.", "actions": [{"type": "resume"}]}),
    ])
    _patch_mesh(monkeypatch, mesh)
    await svc.chat("a1b2c3d4e5f6", "зупинись поки що")
    assert svc.missions["a1b2c3d4e5f6"].status == "paused"
    await svc.chat("a1b2c3d4e5f6", "продовжуй")
    assert svc.missions["a1b2c3d4e5f6"].status == "running"


@pytest.mark.asyncio
async def test_chat_survives_llm_failure_with_state_fallback(svc, monkeypatch):
    class DeadMesh:
        async def generate(self, **kw):
            raise RuntimeError("429 quota")

    _patch_mesh(monkeypatch, DeadMesh())
    reply = await svc.chat("a1b2c3d4e5f6", "статус?")
    assert "Тест" in reply["text"]  # state brief embedded
    assert svc.missions["a1b2c3d4e5f6"].chat[-1]["role"] == "phantom"


@pytest.mark.asyncio
async def test_execute_streams_transcript(svc, monkeypatch, tmp_path):
    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))
    deltas: list[dict] = []

    async def capture(type_, data):
        if type_ == "worker_delta":
            deltas.append(data)

    monkeypatch.setattr(svc, "_emit", capture)
    mesh = FakeMesh(["Повна реалізація ядра з усіма модулями і тестами."])
    _patch_mesh(monkeypatch, mesh)
    m = svc.missions["a1b2c3d4e5f6"]
    node = m.graph.nodes["b"]
    m.graph.mark_running("b")
    await svc._execute(m, node)
    assert node.status == "done"
    assert m.transcripts["b"].startswith("Повна реалізація")
    assert deltas and deltas[-1]["total_chars"] == len(m.transcripts["b"])
    assert svc.workers("a1b2c3d4e5f6")[-1]["tail"].endswith("тестами.")


def test_artifact_path_traversal_blocked(svc, tmp_path, monkeypatch):
    """Ідентифікатор місії тут ШІСТНАДЦЯТКОВИЙ, і це не косметика.

    `read_artifact` першим рядком відкидає id, що не збігається з
    `^[0-9a-f]{6,40}$`. Доки тест передавав "mroom", виклик повертав None
    ще ДО будь-якої роботи зі шляхом — і перевірка «../secret.txt дає None»
    проходила, не дійшовши ані до `_safe_rel`, ані до `_contained`. Тобто
    сторож обходу шляху був ЗЕЛЕНИЙ і не стеріг нічого: він однаково
    пройшов би при повністю відкритому обході.

    З валідним id виклик доходить до захисту, і твердження нарешті
    означає те, що написано в імені тесту.
    """
    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))
    # Принада мусить лежати РІВНО там, куди веде один `..` від теки місії
    # (`<POLIS_HOME>/<id>/..` = сам POLIS_HOME). Доти вона лежала на рівень
    # вище, тобто «../secret.txt» не діставав її НАВІТЬ БЕЗ ЗАХИСТУ — і
    # твердження не могло почервоніти ні за яких умов. Доведено 04.09:
    # знімаю обидва шари (`_safe_rel` і `_contained`) — тест усе одно
    # зелений. Сторож безпеки, який не вміє впасти, не стереже нічого.
    secret = tmp_path / "secret.txt"
    secret.write_text("топсекрет")
    os.makedirs(tmp_path / "a1b2c3d4e5f6", exist_ok=True)
    (tmp_path / "a1b2c3d4e5f6" / "a.md").write_text("# Архітектура\nмодулі")

    assert svc.read_artifact("a1b2c3d4e5f6", "../secret.txt") is None
    assert svc.read_artifact("a1b2c3d4e5f6", "a.md") == "# Архітектура\nмодулі"
    arts = svc.list_artifacts("a1b2c3d4e5f6")
    assert [a["name"] for a in arts] == ["a.md"]
    assert arts[0]["title"] == "Архітектура"
    assert arts[0]["node_id"] == "a"


def test_worker_transcript_falls_back_to_artifact(svc, tmp_path, monkeypatch):
    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))
    path = tmp_path / "a1b2c3d4e5f6" / "a.md"
    os.makedirs(path.parent, exist_ok=True)
    path.write_text("збережений результат")
    svc.missions["a1b2c3d4e5f6"].graph.nodes["a"].artifact_paths = [str(path)]
    assert svc.worker_transcript("a1b2c3d4e5f6", "a") == "збережений результат"
    assert svc.worker_transcript("a1b2c3d4e5f6", "ghost") == ""


@pytest.mark.asyncio
async def test_forge_writes_real_file_tree(svc, tmp_path, monkeypatch):
    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))
    code = (
        "Ось збірка:\n"
        "```file:src/app.py\nprint('polis')\n```\n"
        "і стилі\n"
        "```file:web/style.css\nbody{color:#fff}\n```\n"
        "спроба втечі\n"
        "```file:../evil.sh\nrm -rf\n```\n"
    )
    mesh = FakeMesh([code])
    _patch_mesh(monkeypatch, mesh)
    m = svc.missions["a1b2c3d4e5f6"]
    node = m.graph.nodes["b"]
    m.graph.mark_running("b")
    await svc._execute(m, node)

    ws = tmp_path / "a1b2c3d4e5f6" / "workspace"
    assert (ws / "src" / "app.py").read_text() == "print('polis')\n"
    assert (ws / "web" / "style.css").read_text() == "body{color:#fff}\n"
    assert not (tmp_path / "evil.sh").exists()
    assert not (tmp_path.parent / "evil.sh").exists()

    names = [a["name"] for a in svc.list_artifacts("a1b2c3d4e5f6")]
    assert "workspace/src/app.py" in names and "workspace/web/style.css" in names
    assert svc.read_artifact("a1b2c3d4e5f6", "workspace/src/app.py") == "print('polis')\n"
    assert svc.read_artifact("a1b2c3d4e5f6", "workspace/../../etc/passwd") is None
    forged_msgs = [c for c in m.chat if c["role"] == "system" and "викував" in c["text"]]
    assert len(forged_msgs) == 1 and "2 файл" in forged_msgs[0]["text"]


@pytest.mark.asyncio
async def test_research_node_grounds_in_live_sources(svc, tmp_path, monkeypatch):
    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))

    async def fake_harvest(query, **kw):
        assert "Ядро" in query
        return [{"title": "Джерело", "url": "https://ex.ua/a", "extract": "факт 42"}]

    import agent.fabric.harvest as h
    monkeypatch.setattr(h, "harvest", fake_harvest)

    mesh = FakeMesh(["Звіт на основі джерел."])
    _patch_mesh(monkeypatch, mesh)
    m = svc.missions["a1b2c3d4e5f6"]
    node = m.graph.nodes["b"]
    node.domain = "research"
    m.graph.mark_running("b")
    await svc._execute(m, node)

    # harvested extract + citation instruction reached the worker prompt
    sent = mesh.calls[0]["user_message"]
    assert "факт 42" in sent and "https://ex.ua/a" in sent
    assert "цитуй" in sent
    assert node.status == "done"
    web_msgs = [c for c in m.chat if c["role"] == "system" and "🌐" in c["text"]]
    assert len(web_msgs) == 1 and "1 живих джерел" in web_msgs[0]["text"]


@pytest.mark.asyncio
async def test_harvest_renders_capped_sources():
    from agent.fabric.harvest import render_sources
    sources = [
        {"title": "A", "url": "https://a", "extract": "x" * 10_000},
        {"title": "B", "url": "https://b", "extract": "y" * 10_000},
    ]
    text = render_sources(sources, cap_chars=12_000)
    assert "[1] A" in text and "https://a" in text
    assert len(text) < 13_000
    assert render_sources([]) == ""


@pytest.mark.asyncio
async def test_system_events_recorded_into_chat(svc):
    m = svc.missions["a1b2c3d4e5f6"]
    await svc._chat_system(m, "✓ «Архітектура» виконано", node_id="a")
    assert m.chat[-1]["role"] == "system"
    assert m.chat[-1]["node_id"] == "a"
