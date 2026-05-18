"""
Block C-1 — Mission + Phase persistence + Ledger tests.

Covers:
  DB:
    test_create_mission_persists_and_returns_id
    test_get_mission_rejects_cross_user
    test_create_phase_orders_by_idx
    test_list_phases_returns_ordered_list
    test_update_phase_status_running_then_done_sets_timestamps

  Ledger:
    test_ledger_init_writes_header_with_brief_verbatim
    test_ledger_init_is_idempotent
    test_ledger_append_phase_start_creates_in_progress_section
    test_ledger_mark_phase_done_flips_heading_preserves_body
    test_ledger_current_phase_section_returns_only_active
    test_ledger_mission_summary_compresses_done_phases
    test_ledger_atomic_write_does_not_corrupt_on_partial_failure

Uses the same isolated_db fixture pattern as test_phase09_agent.py.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import types
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import patch, AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Ensure env vars are set before any PHANTOM import.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-block-c1")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-api-key-for-tests")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")


# ── DB fixture ────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def isolated_db(monkeypatch):
    """In-memory SQLite with all PHANTOM tables created, session factory
    patched into db.database so all CRUD helpers use the isolated engine."""
    import db.database as _dbm
    import db.models as _dm  # noqa: F401 — registers all tables with Base
    import importlib

    if not _dbm.Base.metadata.tables:
        importlib.reload(_dm)

    fd, tmp_file = tempfile.mkstemp(suffix=".db", prefix="phantom_c1_")
    os.close(fd)
    url = f"sqlite+aiosqlite:///{tmp_file}"
    engine = create_async_engine(
        url, echo=False, connect_args={"check_same_thread": False}
    )
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


def _uid() -> str:
    return str(uuid.uuid4())


# ── Helper: minimal Mission-like stub for ledger tests ────────────────────────


def _make_mission_stub(
    brief: str = "Test brief.",
    success_criteria: str = "The system works.",
    mission_id: str | None = None,
) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        id=mission_id or _uid(),
        brief=brief,
        success_criteria=success_criteria,
    )


def _make_phase_stub(
    idx: int = 0,
    description: str = "scaffold",
    rationale: str = "Because we need it.",
    success_criteria: str = "Files exist.",
    phase_id: str | None = None,
) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        id=phase_id or _uid(),
        idx=idx,
        description=description,
        rationale=rationale,
        success_criteria=success_criteria,
    )


# ══════════════════════════════════════════════════════════════════════════════
# 1. Database CRUD
# ══════════════════════════════════════════════════════════════════════════════


class TestMissionCRUD:

    async def test_create_mission_persists_and_returns_id(self, isolated_db):
        """create_mission must persist a row and return a Mission with a valid id."""
        from agent.missions.store import create_mission
        from agent.schemas import MissionBrief

        user_id = _uid()
        brief = MissionBrief(brief="Build a cyberpunk city in Blender.")
        mission = await create_mission(user_id, brief)

        assert mission.id, "mission.id must not be empty"
        assert mission.user_id == user_id
        assert mission.brief == "Build a cyberpunk city in Blender."
        assert mission.status == "planning"
        assert mission.ledger_path != "", "ledger_path must be set"
        assert "ledger.md" in mission.ledger_path

    async def test_get_mission_rejects_cross_user(self, isolated_db):
        """get_mission must raise PermissionError when user_id does not match."""
        from agent.missions.store import create_mission, get_mission
        from agent.schemas import MissionBrief

        owner_id = _uid()
        intruder_id = _uid()

        brief = MissionBrief(brief="Secret mission.")
        mission = await create_mission(owner_id, brief)

        with pytest.raises(PermissionError):
            await get_mission(intruder_id, mission.id)

    async def test_get_mission_returns_none_for_missing(self, isolated_db):
        """get_mission must return None for a non-existent mission id."""
        from agent.missions.store import get_mission

        result = await get_mission(_uid(), _uid())
        assert result is None

    async def test_list_missions_filters_by_status(self, isolated_db):
        """list_missions must return only rows matching the requested status."""
        from agent.missions.store import create_mission, list_missions, update_mission_status
        from agent.schemas import MissionBrief

        user_id = _uid()
        m1 = await create_mission(user_id, MissionBrief(brief="Mission alpha"))
        m2 = await create_mission(user_id, MissionBrief(brief="Mission beta"))

        await update_mission_status(user_id, m1.id, "done")

        done_list = await list_missions(user_id, status="done")
        planning_list = await list_missions(user_id, status="planning")

        done_ids = {m.id for m in done_list}
        planning_ids = {m.id for m in planning_list}

        assert m1.id in done_ids
        assert m2.id not in done_ids
        assert m2.id in planning_ids
        assert m1.id not in planning_ids

    async def test_update_mission_status_sets_finished_at(self, isolated_db):
        """Transitioning to 'done' must auto-set finished_at."""
        from agent.missions.store import create_mission, update_mission_status, get_mission
        from agent.schemas import MissionBrief

        user_id = _uid()
        mission = await create_mission(user_id, MissionBrief(brief="Finish me."))

        await update_mission_status(user_id, mission.id, "done")
        updated = await get_mission(user_id, mission.id)

        assert updated is not None
        assert updated.status == "done"
        assert updated.finished_at is not None


class TestPhaseCRUD:

    async def test_create_phase_orders_by_idx(self, isolated_db):
        """Phases must store their idx and be retrievable by it."""
        from agent.missions.store import create_mission, create_phase
        from agent.schemas import MissionBrief, PhaseSpec

        user_id = _uid()
        mission = await create_mission(user_id, MissionBrief(brief="Multi-phase mission."))

        spec0 = PhaseSpec(description="terrain", rationale="Foundation layer")
        spec1 = PhaseSpec(description="roads", rationale="Connect terrain")
        spec2 = PhaseSpec(description="buildings", rationale="Fill the city")

        p2 = await create_phase(mission.id, spec2, idx=2)
        p0 = await create_phase(mission.id, spec0, idx=0)
        p1 = await create_phase(mission.id, spec1, idx=1)

        assert p0.idx == 0
        assert p1.idx == 1
        assert p2.idx == 2

    async def test_list_phases_returns_ordered_list(self, isolated_db):
        """list_phases must return phases sorted by idx ascending."""
        from agent.missions.store import create_mission, create_phase, list_phases
        from agent.schemas import MissionBrief, PhaseSpec

        user_id = _uid()
        mission = await create_mission(user_id, MissionBrief(brief="Ordered phases test."))

        specs = [
            PhaseSpec(description=f"phase-{i}", rationale="r")
            for i in range(5)
        ]
        # Insert in reverse order to confirm list_phases always sorts by idx.
        for i in reversed(range(5)):
            await create_phase(mission.id, specs[i], idx=i)

        phases = await list_phases(mission.id)
        assert [p.idx for p in phases] == list(range(5))
        assert [p.description for p in phases] == [f"phase-{i}" for i in range(5)]

    async def test_update_phase_status_running_then_done_sets_timestamps(
        self, isolated_db
    ):
        """Transitioning running→done must set both started_at and finished_at."""
        from agent.missions.store import (
            create_mission, create_phase, update_phase_status, get_phase
        )
        from agent.schemas import MissionBrief, PhaseSpec

        user_id = _uid()
        mission = await create_mission(user_id, MissionBrief(brief="Timestamp test."))
        spec = PhaseSpec(description="test phase", rationale="r")
        phase = await create_phase(mission.id, spec, idx=0)

        # Transition to running.
        await update_phase_status(mission.id, phase.id, "running")
        running = await get_phase(mission.id, phase.id)
        assert running is not None
        assert running.status == "running"
        assert running.started_at is not None, "started_at must be set when running"

        # Transition to done.
        await update_phase_status(mission.id, phase.id, "done")
        done = await get_phase(mission.id, phase.id)
        assert done is not None
        assert done.status == "done"
        assert done.finished_at is not None, "finished_at must be set when done"

    async def test_mark_artifact_produced_flips_flag(self, isolated_db):
        """mark_artifact_produced must flip produced=True for the matching path."""
        from agent.missions.store import (
            create_mission, create_phase, mark_artifact_produced, get_phase
        )
        from agent.schemas import MissionBrief, PhaseSpec
        import json

        user_id = _uid()
        mission = await create_mission(user_id, MissionBrief(brief="Artifact test."))
        spec = PhaseSpec(
            description="render",
            rationale="r",
            artifacts=[
                {"path": "/tmp/terrain.exr", "kind": "render", "produced": False}
            ],
        )
        phase = await create_phase(mission.id, spec, idx=0)

        await mark_artifact_produced(mission.id, phase.id, "/tmp/terrain.exr")
        updated = await get_phase(mission.id, phase.id)

        artifacts = json.loads(updated.artifacts_json)
        match = next(a for a in artifacts if a["path"] == "/tmp/terrain.exr")
        assert match["produced"] is True

    async def test_mark_artifact_produced_appends_undeclared(self, isolated_db):
        """mark_artifact_produced must append an entry for previously undeclared paths."""
        from agent.missions.store import (
            create_mission, create_phase, mark_artifact_produced, get_phase
        )
        from agent.schemas import MissionBrief, PhaseSpec
        import json

        user_id = _uid()
        mission = await create_mission(user_id, MissionBrief(brief="Implicit artifact."))
        spec = PhaseSpec(description="export", rationale="r")
        phase = await create_phase(mission.id, spec, idx=0)

        await mark_artifact_produced(mission.id, phase.id, "/tmp/output.blend")
        updated = await get_phase(mission.id, phase.id)

        artifacts = json.loads(updated.artifacts_json)
        match = next(
            (a for a in artifacts if a["path"] == "/tmp/output.blend"), None
        )
        assert match is not None
        assert match["produced"] is True


# ══════════════════════════════════════════════════════════════════════════════
# 2. Ledger
# ══════════════════════════════════════════════════════════════════════════════


class TestLedgerWriter:

    async def test_ledger_init_writes_header_with_brief_verbatim(self, tmp_path):
        """init() must write the operator's brief verbatim to the ledger."""
        from agent.missions.ledger import LedgerWriter

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-1", ledger_path)

        brief_text = "Build a fully procedural cyberpunk Tokyo block.\nWith neon signs."
        stub = _make_mission_stub(brief=brief_text)
        await writer.init(stub)

        content = (tmp_path / "ledger.md").read_text(encoding="utf-8")

        assert "# Mission:" in content
        assert "## Operator brief (verbatim)" in content
        # Brief must appear verbatim — both lines present.
        assert "Build a fully procedural cyberpunk Tokyo block." in content
        assert "With neon signs." in content

    async def test_ledger_init_is_idempotent(self, tmp_path):
        """Calling init() twice must not duplicate the header block."""
        from agent.missions.ledger import LedgerWriter

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-2", ledger_path)

        stub = _make_mission_stub(brief="Idempotent brief.")
        await writer.init(stub)
        await writer.init(stub)  # second call

        content = (tmp_path / "ledger.md").read_text(encoding="utf-8")
        # Count occurrences of the sentinel.
        assert content.count("# Mission:") == 1, (
            "Header must appear exactly once after double init"
        )
        assert content.count("## Operator brief (verbatim)") == 1

    async def test_ledger_append_phase_start_creates_in_progress_section(
        self, tmp_path
    ):
        """append_phase_start must create a ## Phase N — ... (IN PROGRESS, ...) heading."""
        from agent.missions.ledger import LedgerWriter

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-3", ledger_path)

        stub = _make_mission_stub()
        await writer.init(stub)

        phase = _make_phase_stub(idx=0, description="terrain generation")
        await writer.append_phase_start(phase)

        content = (tmp_path / "ledger.md").read_text(encoding="utf-8")
        assert "## Phase 1 — terrain generation (IN PROGRESS," in content
        assert "- Plan:" in content

    async def test_ledger_append_decision_artifact_lesson(self, tmp_path):
        """append_phase_decision/artifact/lesson must append correct bullets."""
        from agent.missions.ledger import LedgerWriter

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-4", ledger_path)

        stub = _make_mission_stub()
        phase = _make_phase_stub(idx=0, description="roads")
        await writer.init(stub)
        await writer.append_phase_start(phase)
        await writer.append_phase_decision(phase.id, "Use voronoi cells for road layout")
        await writer.append_phase_artifact(phase.id, "/tmp/roads.blend", 5_242_880)
        await writer.append_phase_lesson(phase.id, "voronoi performs better than grid")

        content = (tmp_path / "ledger.md").read_text(encoding="utf-8")
        assert "- Decided: Use voronoi cells for road layout" in content
        assert "- Artifacts: /tmp/roads.blend (5.0 MB)" in content
        assert "- Lessons: voronoi performs better than grid" in content

    async def test_ledger_mark_phase_done_flips_heading_preserves_body(
        self, tmp_path
    ):
        """mark_phase_done must change IN PROGRESS to DONE and keep all body bullets."""
        from agent.missions.ledger import LedgerWriter

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-5", ledger_path)

        stub = _make_mission_stub()
        phase = _make_phase_stub(idx=0, description="texture pass")
        await writer.init(stub)
        await writer.append_phase_start(phase)
        await writer.append_phase_decision(phase.id, "Use PBR materials")
        await writer.append_phase_artifact(phase.id, "/tmp/materials.blend", 1024)

        await writer.mark_phase_done(phase, step_idx_completed=42, wall_duration_s=4983)

        content = (tmp_path / "ledger.md").read_text(encoding="utf-8")

        # Heading must be flipped.
        assert "(IN PROGRESS," not in content
        assert "(DONE @ step 42," in content
        assert "duration" in content

        # Body bullets must be preserved verbatim.
        assert "- Decided: Use PBR materials" in content
        assert "- Artifacts: /tmp/materials.blend (1.0 KB)" in content

    async def test_ledger_current_phase_section_returns_only_active(self, tmp_path):
        """current_phase_section must return only the IN PROGRESS block."""
        from agent.missions.ledger import LedgerWriter, LedgerReader

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-6", ledger_path)
        reader = LedgerReader(ledger_path)

        stub = _make_mission_stub()
        phase0 = _make_phase_stub(idx=0, description="phase zero")
        phase1 = _make_phase_stub(idx=1, description="phase one")

        await writer.init(stub)

        # Phase 0: start, then mark done.
        await writer.append_phase_start(phase0)
        await writer.mark_phase_done(phase0, step_idx_completed=10, wall_duration_s=600)

        # Phase 1: start but leave in progress.
        await writer.append_phase_start(phase1)
        await writer.append_phase_decision(phase1.id, "exploring options")

        section = await reader.current_phase_section()

        # Section must contain phase 1 IN PROGRESS content.
        assert "phase one" in section
        assert "IN PROGRESS" in section
        assert "exploring options" in section

        # Section must NOT contain phase 0 done content.
        assert "phase zero" not in section
        assert "DONE" not in section

    async def test_ledger_mission_summary_compresses_done_phases(self, tmp_path):
        """mission_summary must collapse DONE phases to single lines."""
        from agent.missions.ledger import LedgerWriter, LedgerReader

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-7", ledger_path)
        reader = LedgerReader(ledger_path)

        stub = _make_mission_stub(
            brief="Build city.",
            success_criteria="City complete.",
        )
        await writer.init(stub)

        phase0 = _make_phase_stub(idx=0, description="terrain")
        phase1 = _make_phase_stub(idx=1, description="roads")

        await writer.append_phase_start(phase0)
        await writer.append_phase_decision(phase0.id, "heightmap decision")
        await writer.mark_phase_done(phase0, step_idx_completed=50, wall_duration_s=3600)

        await writer.append_phase_start(phase1)

        summary = await reader.mission_summary(max_chars=4000)

        # Header content preserved.
        assert "Build city." in summary
        assert "City complete." in summary

        # Done phase appears as a summary line, not the full block.
        assert "DONE" in summary
        assert "terrain" in summary

        # In-progress phase appears fully.
        assert "roads" in summary
        assert "IN PROGRESS" in summary

    async def test_ledger_atomic_write_does_not_corrupt_on_partial_failure(
        self, tmp_path
    ):
        """Simulating a write failure mid-way must leave the file in a valid state.

        Strategy: we monkeypatch os.replace to raise on the first call (simulating
        a disk error during the atomic rename). The file must remain at its prior
        valid state — not empty, not truncated.
        """
        from agent.missions.ledger import LedgerWriter

        ledger_path = str(tmp_path / "ledger.md")
        writer = LedgerWriter("test-mission-8", ledger_path)

        stub = _make_mission_stub(brief="Atomic safety test.")
        phase = _make_phase_stub(idx=0, description="safety check")
        await writer.init(stub)
        await writer.append_phase_start(phase)

        # Read the current valid content.
        prior_content = (tmp_path / "ledger.md").read_text(encoding="utf-8")
        assert "(IN PROGRESS," in prior_content

        # Now simulate a failure in os.replace during mark_phase_done.
        original_replace = os.replace
        replace_call_count = 0

        def _failing_replace(src: str, dst: str) -> None:
            nonlocal replace_call_count
            replace_call_count += 1
            if replace_call_count == 1:
                # Clean up the temp file ourselves so we don't leave debris.
                try:
                    os.unlink(src)
                except OSError:
                    pass
                raise OSError("Simulated disk failure during rename")
            return original_replace(src, dst)

        import agent.missions.ledger as ledger_mod
        with patch.object(ledger_mod.os, "replace", side_effect=_failing_replace):
            with pytest.raises(OSError):
                await writer.mark_phase_done(
                    phase, step_idx_completed=5, wall_duration_s=60
                )

        # File must still be the prior valid content (or new valid content if
        # the replace somehow succeeded — but our mock raises before that).
        after_content = (tmp_path / "ledger.md").read_text(encoding="utf-8")

        # Either the original valid state remains, OR (if some code path
        # succeeded) the new valid state is present. Both are acceptable.
        # What must NEVER happen: empty file, or content with no heading.
        assert len(after_content) > 0, "File must not be empty after partial failure"
        assert "# Mission:" in after_content, "File must retain valid header"

        # Specifically: the prior content must be intact because the atomic
        # rename was the operation that failed.
        assert after_content == prior_content, (
            "After rename failure, file must be unchanged from prior valid state"
        )
