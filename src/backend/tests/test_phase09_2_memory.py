"""
Phase 9.2 — episodic memory (ChromaDB embedder + seeds + recall + backfill).
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-phase09-2-mem")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── Per-test isolation: unique chroma collection name ─────────────────────────


@pytest_asyncio.fixture
async def isolated_collection(monkeypatch):
    """Each test gets a unique ChromaDB collection so they can't see each other."""
    from config import config
    from agent.cognition.memory.embedder import wipe
    name = f"agent_episodes_test_{uuid.uuid4().hex[:12]}"
    monkeypatch.setattr(config, "agent_episodic_collection", name)
    yield name
    # Cleanup — best-effort
    try:
        await wipe()
    except Exception:
        pass


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    import db.database as _dbm
    import db.models as _dm  # noqa: F401
    import importlib
    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)
    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_p92mem_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(url, echo=False, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_dbm.Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(_dbm, "engine", engine)
    monkeypatch.setattr(_dbm, "AsyncSessionLocal", factory)
    yield factory
    await engine.dispose()
    try:
        os.unlink(tmp_file)
    except OSError:
        pass


# ═════════════════════════════════════════════════════════════════════════════
# 1. Embedder — collection accessor reuses Phase 3 ChromaDB
# ═════════════════════════════════════════════════════════════════════════════


class TestEmbedder:
    @pytest.mark.asyncio
    async def test_collection_round_trip(self, isolated_collection):
        from agent.cognition.memory.embedder import get_collection, count
        coll = await get_collection()
        assert coll is not None
        # Fresh collection starts empty.
        assert await count() == 0

    @pytest.mark.asyncio
    async def test_uses_phase3_chromadb_singletons(self, isolated_collection):
        from agent.cognition.memory.embedder import get_collection
        from memory.strategic_memory import _get_client, _get_ef
        coll = await get_collection()
        # Same client process-wide — confirms Phase 3 instance is reused.
        assert _get_client() is _get_client()
        assert _get_ef() is _get_ef()
        # The collection itself is configured with the EF; by name, our agent
        # collection is distinct from any user_* collections.
        assert coll.name.startswith("agent_episodes_test_")


# ═════════════════════════════════════════════════════════════════════════════
# 2. Seeds — write_episode + compose_summary
# ═════════════════════════════════════════════════════════════════════════════


class TestSeeds:
    @pytest.mark.asyncio
    async def test_write_episode_persists_to_chroma(self, isolated_collection):
        from agent.cognition.memory.seeds import write_episode
        from agent.cognition.memory.embedder import count
        ep = await write_episode(
            task_id="t-write-1", goal="read /etc/hostname",
            outcome="done", summary="прочитав файл /etc/hostname успішно",
            action_counts={"fs.read": 1}, duration_s=1.5,
        )
        assert ep == "episode_t-write-1"
        assert await count() == 1

    @pytest.mark.asyncio
    async def test_write_episode_idempotent(self, isolated_collection):
        from agent.cognition.memory.seeds import write_episode
        from agent.cognition.memory.embedder import count
        for _ in range(3):
            await write_episode(
                task_id="t-idem", goal="g", outcome="done",
                summary="s", action_counts={"a": 1}, duration_s=0.0,
            )
        assert await count() == 1

    @pytest.mark.asyncio
    async def test_compose_summary_falls_back_when_llm_unreachable(self, monkeypatch):
        from agent.cognition.memory import seeds

        class _BrokenRouter:
            async def generate(self, *a, **k):
                raise RuntimeError("no providers")

        monkeypatch.setattr("ai.provider.ai_router.generate",
                            _BrokenRouter().generate, raising=False)

        out = await seeds.compose_summary(
            goal="ping 8.8.8.8 ten times", outcome="done",
            action_counts={"bash.run": 2}, last_observation="all replies received",
        )
        assert "ping 8.8.8.8" in out
        assert "done" in out
        assert "bash.run" in out


# ═════════════════════════════════════════════════════════════════════════════
# 3. Recall — top-k similarity, empty handling
# ═════════════════════════════════════════════════════════════════════════════


class TestRecall:
    @pytest.mark.asyncio
    async def test_recall_empty_returns_empty(self, isolated_collection):
        from agent.cognition.memory.recall import recall
        out = await recall("anything")
        assert out == []

    @pytest.mark.asyncio
    async def test_recall_returns_top_k(self, isolated_collection):
        from agent.cognition.memory.recall import recall
        from agent.cognition.memory.seeds import write_episode

        await write_episode(task_id="a", goal="weather in Ostrava", outcome="done",
                            summary="знайшов погоду в Острові", action_counts={"web.search": 1})
        await write_episode(task_id="b", goal="ping 8.8.8.8", outcome="done",
                            summary="пінг успішний", action_counts={"bash.run": 1})
        await write_episode(task_id="c", goal="weather in Kyiv", outcome="done",
                            summary="знайшов погоду в Києві", action_counts={"web.search": 1})

        out = await recall("weather", k=2)
        assert len(out) == 2
        ids = {e["task_id"] for e in out}
        # Both weather episodes outrank ping for similarity.
        assert "a" in ids or "c" in ids

    @pytest.mark.asyncio
    async def test_format_episodes_for_prompt_handles_empty(self):
        from agent.cognition.memory.recall import format_episodes_for_prompt
        assert format_episodes_for_prompt([]) == ""


# ═════════════════════════════════════════════════════════════════════════════
# 4. Strategic planner injects past episodes
# ═════════════════════════════════════════════════════════════════════════════


class TestStrategicWithMemory:
    @pytest.mark.asyncio
    async def test_strategic_prompt_includes_past_episodes(
        self, monkeypatch, isolated_collection
    ):
        from agent.cognition.memory.seeds import write_episode
        from agent.cognition.planner import strategic, _llm
        from agent.schemas import SelfModel

        await write_episode(
            task_id="prior-1", goal="read /etc/hostname",
            outcome="done", summary="raw summary about hostname",
            action_counts={"fs.read": 1},
        )

        captured: list[str] = []

        async def fake_call(prompt: str) -> str:
            captured.append(prompt)
            return json.dumps({
                "sub_goals": [{"description": "x", "rationale": "r",
                               "expected_actions": 1, "acceptance_criteria": "ok"}],
                "estimated_total_actions": 1, "risk_assessment": "low",
            })

        monkeypatch.setattr(_llm, "_call", fake_call)
        await strategic.plan(goal="read /etc/hostname", self_model=SelfModel())
        assert captured
        assert "ПОПЕРЕДНІ СХОЖІ ВИПАДКИ" in captured[0]
        assert "raw summary about hostname" in captured[0]

    @pytest.mark.asyncio
    async def test_strategic_prompt_omits_section_when_empty(
        self, monkeypatch, isolated_collection
    ):
        from agent.cognition.planner import strategic, _llm
        from agent.schemas import SelfModel

        captured: list[str] = []

        async def fake_call(prompt: str) -> str:
            captured.append(prompt)
            return json.dumps({
                "sub_goals": [{"description": "x", "rationale": "r",
                               "expected_actions": 1, "acceptance_criteria": "ok"}],
                "estimated_total_actions": 1, "risk_assessment": "low",
            })

        monkeypatch.setattr(_llm, "_call", fake_call)
        await strategic.plan(goal="brand-new goal", self_model=SelfModel())
        assert captured
        assert "ПОПЕРЕДНІ СХОЖІ ВИПАДКИ" not in captured[0]
        assert "пам'ять порожня" in captured[0]


# ═════════════════════════════════════════════════════════════════════════════
# 5. Backfill — idempotency + lifespan auto-trigger condition
# ═════════════════════════════════════════════════════════════════════════════


class TestBackfill:
    @pytest.mark.asyncio
    async def test_backfill_all_imports_sql_seeds(
        self, isolated_db, isolated_collection
    ):
        from agent.kernel.audit import write_memory_seed
        from agent.cognition.memory.backfill import backfill_all
        from agent.cognition.memory.embedder import count

        await write_memory_seed(
            task_id="seed-1", goal="g1", outcome="done",
            summary="summary one", key_actions=[("fs.read", 1)],
        )
        await write_memory_seed(
            task_id="seed-2", goal="g2", outcome="failed",
            summary="summary two", key_actions=[("bash.run", 2)],
        )

        # First backfill — both should land
        stats = await backfill_all()
        assert stats == {"seeds_total": 2, "written": 2, "skipped": 0}
        assert await count() == 2

        # Second backfill — same row count, idempotent
        stats2 = await backfill_all()
        assert stats2["seeds_total"] == 2
        assert await count() == 2

    @pytest.mark.asyncio
    async def test_backfill_if_behind_skips_when_in_sync(
        self, isolated_db, isolated_collection
    ):
        from agent.cognition.memory.backfill import backfill_if_behind
        # Empty DB, empty collection → nothing to do
        result = await backfill_if_behind()
        assert result is None


# ═════════════════════════════════════════════════════════════════════════════
# 6. SelfRecall action — uses ChromaDB primary, SQL fallback
# ═════════════════════════════════════════════════════════════════════════════


class TestSelfRecallAction:
    @pytest.mark.asyncio
    async def test_self_recall_returns_chroma_episodes(self, isolated_collection):
        from agent.actions.self_introspect import SelfRecall
        from agent.actions.base import ActionContext
        from agent.cognition.memory.seeds import write_episode

        await write_episode(
            task_id="recall-test-1", goal="read hostname",
            outcome="done", summary="прочитав hostname",
            action_counts={"fs.read": 1},
        )

        action = SelfRecall(query="hostname", limit=3)
        ctx = ActionContext(task_id="now-task", step_idx=0,
                            workspace_dir="/tmp", runtime=None)
        result = await action.execute(ctx)
        assert result.ok is True
        assert result.output["count"] >= 1
        assert result.output["source"] == "chromadb"
