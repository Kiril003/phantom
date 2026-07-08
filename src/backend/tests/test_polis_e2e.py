"""ПОЛІС e2e — a full mission lives and dies inside the real engine:
create → waves → streams → artifacts → chat steering → done. Only the
LLM is fake; graph, governor, persistence, files are all real."""
from __future__ import annotations

import asyncio
import json

import pytest

from agent.fabric.service import PolisService


async def _seed_user_id() -> str:
    from sqlalchemy import select
    from db.database import get_session
    from db.models import User
    async with get_session() as db:
        row = (await db.execute(select(User).limit(1))).scalars().first()
        assert row is not None, "conftest seed user missing"
        return row.id


class ScriptedMesh:
    """Returns role-flavoured text for any node prompt; supports chat JSON."""

    def __init__(self) -> None:
        self.stream_calls = 0

    async def generate(self, *, system_prompt="", user_message="", **kw):
        class R:
            text = json.dumps({
                "reply": "Курс тримаю.",
                "actions": [],
            }) if "оператор" in system_prompt.lower() or "Полісі" in system_prompt else "ok"
        return R()

    async def generate_stream(self, *, system_prompt, user_message, on_delta, **kw):
        self.stream_calls += 1
        text = f"Результат кроку #{self.stream_calls}: зроблено повно і чесно."
        for i in range(0, len(text), 11):
            await on_delta(text[i : i + 11])
        return text


@pytest.mark.asyncio
async def test_full_mission_lifecycle(tmp_path, monkeypatch):
    from db.database import init_db
    await init_db()
    user_id = await _seed_user_id()

    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))
    mesh = ScriptedMesh()
    import ai.provider_mesh as mesh_mod
    monkeypatch.setattr(mesh_mod, "get_mesh", lambda: mesh)

    events: list[tuple[str, dict]] = []
    svc = PolisService()

    async def capture(type_, data):
        events.append((type_, data))

    monkeypatch.setattr(svc, "_emit", capture)

    m = await svc.create_mission(
        user_id, "Дослідити ринок дронів і скласти звіт", "research_library"
    )
    assert m.task is not None
    await asyncio.wait_for(m.task, timeout=30)

    assert m.status == "done"
    assert m.graph.is_complete()
    assert m.graph.progress() == 1.0

    # every workstream produced a real artifact file
    arts = svc.list_artifacts(m.id)
    workstreams = [n for n in m.graph.nodes.values() if n.kind == "workstream"]
    assert len(arts) == len(m.graph.nodes) == 6
    assert len(workstreams) == 6
    for a in arts:
        content = svc.read_artifact(m.id, a["name"])
        assert content and "зроблено повно" in content

    # streams flowed and completion landed in the mission chat
    types_seen = {t for t, _ in events}
    assert "worker_delta" in types_seen
    assert "chat_message" in types_seen
    done_msgs = [c for c in m.chat if c["role"] == "system" and c["text"].startswith("✓")]
    assert len(done_msgs) == 6

    # waves never exceeded the Radxa ceiling
    wave_sizes = [d["size"] for t, d in events if t == "wave"]
    assert wave_sizes and max(wave_sizes) <= 4

    # mission survived into SQLite with chat
    from db.database import get_session
    from db.models import PolisMissionRow
    async with get_session() as db:
        row = await db.get(PolisMissionRow, m.id)
    assert row is not None and row.status == "done"
    assert "✓" in row.chat_json

    # post-mortem chat still answers with state
    reply = await svc.chat(m.id, "підсумуй")
    assert reply["role"] == "phantom" and reply["text"]

    # cleanup row
    async with get_session() as db:
        row = await db.get(PolisMissionRow, m.id)
        await db.delete(row)
        await db.commit()


class DecomposingMesh:
    """Planner yields one oversized node; its worker splits into two children,
    then the parent re-runs to integrate them — real recursion in one loop."""

    def __init__(self) -> None:
        self.stream_calls = 0
        self.did_spawn = False

    async def generate(self, *, system_prompt="", user_message="", **kw):
        class R:
            content = json.dumps({"steps": [
                {"title": "Велике завдання", "prompt": "зроби багато",
                 "role": "domain_researcher", "eta_minutes": 15},
            ]})
            text = content
        return R()

    async def generate_stream(self, *, system_prompt, user_message, on_delta, **kw):
        self.stream_calls += 1
        if "```spawn" in system_prompt and not self.did_spawn:
            self.did_spawn = True
            text = "Завелике.\n```spawn\n" + json.dumps([
                {"title": "Підзадача 1", "prompt": "частина 1", "role": "domain_researcher"},
                {"title": "Підзадача 2", "prompt": "частина 2", "role": "data_analyst"},
            ]) + "\n```"
        else:
            text = f"Результат #{self.stream_calls}: зроблено повно і чесно."
        for i in range(0, len(text), 13):
            await on_delta(text[i : i + 13])
        return text


@pytest.mark.asyncio
async def test_worker_decomposes_graph_grows_itself(tmp_path, monkeypatch):
    from db.database import init_db
    await init_db()
    user_id = await _seed_user_id()
    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))

    mesh = DecomposingMesh()
    import ai.provider_mesh as mesh_mod
    monkeypatch.setattr(mesh_mod, "get_mesh", lambda: mesh)

    svc = PolisService()
    branchings: list[str] = []

    async def capture(type_, data):
        if type_ == "chat_message":
            branchings.append(data["message"].get("text", ""))

    monkeypatch.setattr(svc, "_emit", capture)

    m = await svc.create_mission(user_id, "Велике завдання", "generic")
    await asyncio.wait_for(m.task, timeout=30)

    assert m.status == "done" and m.graph.is_complete()
    # graph grew 1 → 3: the parent split itself into two children in place
    assert len(m.graph.nodes) == 3
    parents = [n for n in m.graph.nodes.values() if n.decomposed]
    children = [n for n in m.graph.nodes.values() if n.depth == 1]
    assert len(parents) == 1 and parents[0].status == "done"
    assert len(children) == 2 and all(c.status == "done" for c in children)
    assert parents[0].depends_on == [c.id for c in children]
    # the branching was announced in the mission chat
    assert any("розгалужено" in t for t in branchings)

    from db.database import get_session
    from db.models import PolisMissionRow
    async with get_session() as db:
        row = await db.get(PolisMissionRow, m.id)
        await db.delete(row)
        await db.commit()


@pytest.mark.asyncio
async def test_failed_provider_marks_nodes_and_mission(tmp_path, monkeypatch):
    from db.database import init_db
    await init_db()
    user_id = await _seed_user_id()
    monkeypatch.setattr("agent.fabric.service._POLIS_HOME", str(tmp_path))

    class DeadMesh:
        async def generate_stream(self, *, on_delta, **kw):
            raise RuntimeError("429 rate limit")

        async def generate(self, **kw):
            raise RuntimeError("429 rate limit")

    import ai.provider_mesh as mesh_mod
    monkeypatch.setattr(mesh_mod, "get_mesh", lambda: DeadMesh())

    svc = PolisService()

    async def no_emit(*a, **k):
        return None

    monkeypatch.setattr(svc, "_emit", no_emit)

    m = await svc.create_mission(user_id, "щось просте", "observatory")
    await asyncio.wait_for(m.task, timeout=30)

    assert m.status == "failed"
    root_like = [n for n in m.graph.nodes.values() if not n.depends_on]
    assert all(n.status == "failed" and n.attempts == n.max_attempts for n in root_like)
    blocked = [n for n in m.graph.nodes.values() if n.depends_on]
    assert all(n.status == "blocked" for n in blocked)

    from db.database import get_session
    from db.models import PolisMissionRow
    async with get_session() as db:
        row = await db.get(PolisMissionRow, m.id)
        assert row is not None and row.status == "failed"
        await db.delete(row)
        await db.commit()
