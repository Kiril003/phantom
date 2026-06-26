# Will Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Will Engine — a slow conductor loop that owns the 7-horizon goal tree (`goals_persistent`) and autonomously advances one goal-step per tick, within a daily budget, reporting post-facto.

**Architecture:** A new `agent/will/` package: typed goal repo + decide-ONE reasoning + daily budget governor + intent mutex + journal, driven by a `WillEngine`/`WillLoop` that dispatches work through the existing `AgentRuntime.start_task`. Existing loops (`ProactiveLoop`, `StandingOrderRunner`) are subordinated via an intent mutex, not rewritten. Shipped behind `will_enabled=false`.

**Tech Stack:** Python 3.11, asyncio, SQLAlchemy 2 async, pytest + pytest-asyncio, Pydantic-settings config. LLM via `ai.hub.ai_hub.dispatch`.

## Global Constraints

- No mocks/stubs/TODO in product code — full implementations only (PHANTOM rule #1).
- Files under 500 lines; one responsibility per file.
- Every config knob must be reachable from the Settings UI allowlist (`api/routes_settings.py`).
- Gemini calls always degrade gracefully; never raise out of a tick (catch + journal).
- The will is the lowest-priority LLM consumer; it must call `_runtime_note_llm_call` before any LLM use and yield to foreground chat.
- New tables created both via ORM models (fresh DBs, `create_all`) AND a numbered migration `db/migrations/025_will_engine.py` (existing DBs).
- Horizon levels: 0=VISION 1=YEAR 2=QUARTER 3=MONTH 4=WEEK 5=DAY 6=ACTION (`agent/cognition/planner/horizons.py:HORIZON_NAMES`).
- Branch: `companion-v2-phase-0`. Tests run with `src/backend/.venv/bin/python -m pytest`.
- Commit message footer: `Co-Authored-By: claude-flow <ruv@ruv.net>`.

---

### Task 1: Shared will types

**Files:**
- Create: `src/backend/agent/will/__init__.py`
- Create: `src/backend/agent/will/types.py`
- Test: `src/backend/tests/test_will_types.py`

**Interfaces:**
- Produces: `Goal` (frozen dataclass), `WillDecision`, `Budget`, `WillTickResult`, `HORIZON_VISION=0 … HORIZON_ACTION=6`.

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_types.py
from agent.will.types import Goal, WillDecision, Budget, WillTickResult

def test_budget_ok_until_caps():
    b = Budget(calls_used=10, tokens_used=100, calls_cap=200, tokens_cap=300_000)
    assert b.ok is True
    spent = Budget(calls_used=200, tokens_used=0, calls_cap=200, tokens_cap=300_000)
    assert spent.ok is False
    toks = Budget(calls_used=0, tokens_used=300_000, calls_cap=200, tokens_cap=300_000)
    assert toks.ok is False

def test_decision_defaults_to_noop():
    d = WillDecision(kind="noop")
    assert d.kind == "noop"
    assert d.goal_id is None and d.rationale == ""

def test_goal_is_immutable():
    g = Goal(id="g1", user_id="u1", parent_id=None, horizon_level=0,
             description="vision", status="pending", kpi=None, deadline=None,
             blockers=[], source="seeded")
    import dataclasses, pytest
    with pytest.raises(dataclasses.FrozenInstanceError):
        g.status = "done"  # type: ignore[misc]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_types.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.will'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/backend/agent/will/__init__.py
"""Will Engine — the unified conductor of PHANTOM's intent."""
```

```python
# src/backend/agent/will/types.py
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

HORIZON_VISION = 0
HORIZON_YEAR = 1
HORIZON_QUARTER = 2
HORIZON_MONTH = 3
HORIZON_WEEK = 4
HORIZON_DAY = 5
HORIZON_ACTION = 6

GoalStatus = Literal["pending", "running", "done", "failed", "snoozed", "cancelled"]
GoalSource = Literal["seeded", "self_generated"]
DecisionKind = Literal["start_task", "standing_order", "proactive_seed", "noop"]


@dataclass(frozen=True)
class Goal:
    id: str
    user_id: str
    parent_id: Optional[str]
    horizon_level: int
    description: str
    status: GoalStatus
    kpi: Optional[str]
    deadline: Optional[datetime]
    blockers: list[str]
    source: GoalSource


@dataclass
class WillDecision:
    kind: DecisionKind
    goal_id: Optional[str] = None
    action_text: str = ""
    rationale: str = ""


@dataclass
class Budget:
    calls_used: int
    tokens_used: int
    calls_cap: int
    tokens_cap: int

    @property
    def ok(self) -> bool:
        return self.calls_used < self.calls_cap and self.tokens_used < self.tokens_cap


@dataclass
class WillTickResult:
    decision: WillDecision
    dispatched: bool = False
    task_id: Optional[str] = None
    note: str = ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_types.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/will/__init__.py src/backend/agent/will/types.py src/backend/tests/test_will_types.py
git commit -m "feat(will): shared will-engine value types

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 2: ORM models + migration 025

**Files:**
- Modify: `src/backend/db/models.py` (append two models; add `source` column to `PersistentGoal`)
- Create: `src/backend/db/migrations/025_will_engine.py`
- Test: `src/backend/tests/test_will_migration.py`

**Interfaces:**
- Produces: tables `will_budget_ledger(user_id, ledger_date, llm_calls, tokens, updated_at)`, `will_journal(id, user_id, ts, decision_json, action, task_id, outcome, budget_delta_json)`; `PersistentGoal.source` column.

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_migration.py
import os, tempfile, importlib
import pytest, pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "test-will-mig")
os.environ.setdefault("AI_GEMINI_API_KEY", "fake-key")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

@pytest.mark.asyncio
async def test_create_all_makes_will_tables_and_goal_source():
    import db.database as dbm
    import db.models as dm  # noqa: F401
    importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db"); os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
    async with eng.begin() as conn:
        tabs = (await conn.execute(text(
            "select name from sqlite_master where type='table'"))).scalars().all()
        cols = [r[1] for r in (await conn.execute(text(
            "pragma table_info(goals_persistent)"))).all()]
    assert "will_budget_ledger" in tabs
    assert "will_journal" in tabs
    assert "source" in cols
    await eng.dispose(); os.unlink(tmp)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_migration.py -v`
Expected: FAIL — `assert 'will_budget_ledger' in tabs`

- [ ] **Step 3a: Add `source` column to `PersistentGoal`**

In `src/backend/db/models.py`, inside `class PersistentGoal`, after the `blockers_json` line add:

```python
    source: Mapped[str] = mapped_column(String(16), default="seeded", nullable=False)
```

- [ ] **Step 3b: Append the two new models to `db/models.py`**

```python
class WillBudgetLedger(Base):
    """Daily LLM spend ledger for the Will Engine (per user, per local date)."""
    __tablename__ = "will_budget_ledger"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    ledger_date: Mapped[str] = mapped_column(String(10), primary_key=True)  # YYYY-MM-DD
    llm_calls: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)


class WillJournal(Base):
    """Append-only post-facto record of will decisions and outcomes."""
    __tablename__ = "will_journal"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    ts: Mapped[float] = mapped_column(Float, nullable=False)
    decision_json: Mapped[str] = mapped_column(Text, default="{}")
    action: Mapped[str] = mapped_column(String(64), default="")
    task_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    outcome: Mapped[str] = mapped_column(Text, default="")
    budget_delta_json: Mapped[str] = mapped_column(Text, default="{}")
```

Confirm the file already imports `Float` from sqlalchemy; if not, add `Float` to the existing `from sqlalchemy import (...)` line.

- [ ] **Step 3c: Write the migration**

```python
# src/backend/db/migrations/025_will_engine.py
"""Will Engine — DDL for budget ledger, journal, and goal source column."""
from __future__ import annotations

from sqlalchemy import text

_LEDGER_DDL = """
    CREATE TABLE IF NOT EXISTS will_budget_ledger (
        user_id     TEXT NOT NULL,
        ledger_date TEXT NOT NULL,
        llm_calls   INTEGER NOT NULL DEFAULT 0,
        tokens      INTEGER NOT NULL DEFAULT 0,
        updated_at  REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, ledger_date)
    )
"""

_JOURNAL_DDL = """
    CREATE TABLE IF NOT EXISTS will_journal (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        ts                REAL NOT NULL,
        decision_json     TEXT NOT NULL DEFAULT '{}',
        action            TEXT NOT NULL DEFAULT '',
        task_id           TEXT,
        outcome           TEXT NOT NULL DEFAULT '',
        budget_delta_json TEXT NOT NULL DEFAULT '{}'
    )
"""

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_will_journal_user ON will_journal(user_id, ts)",
]


async def apply(conn) -> None:
    await conn.execute(text(_LEDGER_DDL))
    await conn.execute(text(_JOURNAL_DDL))
    for ddl in _INDEXES:
        await conn.execute(text(ddl))
    # Idempotent ADD COLUMN — SQLite has no IF NOT EXISTS for columns.
    cols = [r[1] for r in (await conn.execute(text("pragma table_info(goals_persistent)"))).all()]
    if "source" not in cols:
        await conn.execute(text(
            "ALTER TABLE goals_persistent ADD COLUMN source TEXT NOT NULL DEFAULT 'seeded'"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_migration.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend/db/models.py src/backend/db/migrations/025_will_engine.py src/backend/tests/test_will_migration.py
git commit -m "feat(will): budget-ledger + journal tables, goal source column

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 3: Config knobs + Settings exposure

**Files:**
- Modify: `src/backend/config.py` (add will_* fields near the agent config block)
- Modify: `src/backend/api/routes_settings.py` (add keys to the editable allowlist + labels)
- Test: `src/backend/tests/test_will_config.py`

**Interfaces:**
- Produces: `config.will_enabled`, `config.will_tick_interval_s`, `config.will_daily_llm_calls`, `config.will_daily_token_cap`, `config.will_reflect_hour_local`, `config.will_max_active_day_goals`.

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_config.py
import os
os.environ.setdefault("JWT_SECRET_KEY", "t"); os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

def test_will_defaults():
    from config import config
    assert config.will_enabled is False
    assert config.will_tick_interval_s == 300
    assert config.will_daily_llm_calls == 200
    assert config.will_daily_token_cap == 300_000
    assert config.will_reflect_hour_local == 4
    assert config.will_max_active_day_goals == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'will_enabled'`

- [ ] **Step 3a: Add fields to `config.py`**

In `src/backend/config.py`, after the `agent_*` block (search for `agent_proactive_enabled`), add:

```python
    # ── Will Engine (sub-project A) ───────────────────────────────────────────
    will_enabled: bool = False                 # master kill switch
    will_tick_interval_s: int = 300            # 5-min deliberation cadence
    will_daily_llm_calls: int = 200            # daily budget — LLM calls
    will_daily_token_cap: int = 300_000        # daily budget — tokens
    will_reflect_hour_local: int = 4           # daily self-generation hour (local)
    will_max_active_day_goals: int = 3         # anti-sprawl on the DAY horizon
```

- [ ] **Step 3b: Expose in Settings allowlist**

In `src/backend/api/routes_settings.py`, find the editable-keys list (search for `"ai_gemini_model",` around line 209) and add within the same list literal:

```python
            "will_enabled",
            "will_tick_interval_s",
            "will_daily_llm_calls",
            "will_daily_token_cap",
```

Then find the label map (search for `"ai_gemini_model": "Gemini модель",` ~line 411) and add:

```python
    "will_enabled": "Воля активна",
    "will_tick_interval_s": "Інтервал тіку волі (с)",
    "will_daily_llm_calls": "Денний бюджет викликів",
    "will_daily_token_cap": "Денний бюджет токенів",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_config.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend/config.py src/backend/api/routes_settings.py src/backend/tests/test_will_config.py
git commit -m "feat(will): config knobs + Settings exposure (default off)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 4: Goals repository

**Files:**
- Create: `src/backend/agent/will/goals.py`
- Test: `src/backend/tests/test_will_goals.py`

**Interfaces:**
- Consumes: `Goal` from Task 1; `PersistentGoal` model.
- Produces:
  - `async def seed(db, user_id, description, horizon_level, *, parent_id=None, kpi=None, source="seeded") -> str` (returns goal id)
  - `async def list_active(db, user_id) -> list[Goal]`
  - `async def children(db, user_id, parent_id) -> list[Goal]`
  - `async def set_status(db, goal_id, status) -> None`
  - `async def add_blocker(db, goal_id, text) -> None`
  - `async def pick_next_action(db, user_id) -> Goal | None` (lowest-horizon pending leaf, earliest deadline first)

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_goals.py
import os, tempfile, importlib
import pytest, pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t"); os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm, db.models as dm  # noqa: F401
    importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db"); os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
        from db.models import User
    factory = async_sessionmaker(eng, expire_on_commit=False)
    async with factory() as s:
        s.add(User(id="u1", username="u1", role="root", password_hash="x"))
        await s.commit()
    yield factory
    await eng.dispose(); os.unlink(tmp)

@pytest.mark.asyncio
async def test_seed_and_pick_next_action(db_factory):
    from agent.will import goals
    async with db_factory() as db:
        vid = await goals.seed(db, "u1", "Стати незрівнянним", 0)
        aid = await goals.seed(db, "u1", "Написати модуль", 6, parent_id=vid)
        await db.commit()
    async with db_factory() as db:
        nxt = await goals.pick_next_action(db, "u1")
        assert nxt is not None
        assert nxt.id == aid
        assert nxt.horizon_level == 6

@pytest.mark.asyncio
async def test_set_status_removes_from_active(db_factory):
    from agent.will import goals
    async with db_factory() as db:
        gid = await goals.seed(db, "u1", "ціль", 6)
        await db.commit()
    async with db_factory() as db:
        await goals.set_status(db, gid, "done"); await db.commit()
    async with db_factory() as db:
        assert await goals.pick_next_action(db, "u1") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_goals.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.will.goals'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/backend/agent/will/goals.py
from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PersistentGoal
from agent.will.types import Goal

_ACTIVE = ("pending", "running", "snoozed")


def _to_goal(row: PersistentGoal) -> Goal:
    import json
    return Goal(
        id=row.id, user_id=row.user_id, parent_id=row.parent_id,
        horizon_level=row.horizon_level, description=row.description,
        status=row.status, kpi=row.kpi, deadline=row.deadline,
        blockers=json.loads(row.blockers_json or "[]"),
        source=getattr(row, "source", "seeded"),
    )


async def seed(db: AsyncSession, user_id: str, description: str, horizon_level: int,
               *, parent_id: str | None = None, kpi: str | None = None,
               source: str = "seeded") -> str:
    gid = str(uuid.uuid4())
    db.add(PersistentGoal(
        id=gid, user_id=user_id, parent_id=parent_id, horizon_level=horizon_level,
        description=description, kpi=kpi, status="pending", source=source,
    ))
    await db.flush()
    return gid


async def list_active(db: AsyncSession, user_id: str) -> list[Goal]:
    res = await db.execute(
        select(PersistentGoal)
        .where(PersistentGoal.user_id == user_id, PersistentGoal.status.in_(_ACTIVE))
        .order_by(PersistentGoal.horizon_level.asc())
    )
    return [_to_goal(r) for r in res.scalars().all()]


async def children(db: AsyncSession, user_id: str, parent_id: str) -> list[Goal]:
    res = await db.execute(
        select(PersistentGoal).where(
            PersistentGoal.user_id == user_id, PersistentGoal.parent_id == parent_id)
    )
    return [_to_goal(r) for r in res.scalars().all()]


async def set_status(db: AsyncSession, goal_id: str, status: str) -> None:
    res = await db.execute(select(PersistentGoal).where(PersistentGoal.id == goal_id))
    row = res.scalar_one_or_none()
    if row is not None:
        row.status = status


async def add_blocker(db: AsyncSession, goal_id: str, text: str) -> None:
    import json
    res = await db.execute(select(PersistentGoal).where(PersistentGoal.id == goal_id))
    row = res.scalar_one_or_none()
    if row is not None:
        blockers = json.loads(row.blockers_json or "[]")
        blockers.append(text)
        row.blockers_json = json.dumps(blockers, ensure_ascii=False)


async def pick_next_action(db: AsyncSession, user_id: str) -> Goal | None:
    res = await db.execute(
        select(PersistentGoal)
        .where(PersistentGoal.user_id == user_id, PersistentGoal.status.in_(_ACTIVE))
        .order_by(PersistentGoal.horizon_level.desc(), PersistentGoal.deadline.asc().nullslast())
    )
    row = res.scalars().first()
    return _to_goal(row) if row is not None else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_goals.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/will/goals.py src/backend/tests/test_will_goals.py
git commit -m "feat(will): typed goal repository over goals_persistent

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 5: Budget governor

**Files:**
- Create: `src/backend/agent/will/budget.py`
- Test: `src/backend/tests/test_will_budget.py`

**Interfaces:**
- Consumes: `Budget` from Task 1; `WillBudgetLedger` model; `config`.
- Produces: `class BudgetGovernor` with
  - `async def remaining(db, user_id, *, today=None) -> Budget`
  - `async def note_spend(db, user_id, calls, tokens, *, today=None) -> None`
  - `async def can_spend(db, user_id, *, today=None) -> bool`

`today` is an injectable `str` (YYYY-MM-DD) for deterministic tests; defaults to local date.

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_budget.py
import os, tempfile, importlib
import pytest, pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t"); os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm, db.models as dm  # noqa: F401
    importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db"); os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
    factory = async_sessionmaker(eng, expire_on_commit=False)
    yield factory
    await eng.dispose(); os.unlink(tmp)

@pytest.mark.asyncio
async def test_spend_accumulates_and_gate_closes(db_factory):
    from agent.will.budget import BudgetGovernor
    from config import config
    gov = BudgetGovernor()
    async with db_factory() as db:
        assert await gov.can_spend(db, "u1", today="2026-06-26") is True
        await gov.note_spend(db, "u1", calls=config.will_daily_llm_calls, tokens=0, today="2026-06-26")
        await db.commit()
    async with db_factory() as db:
        assert await gov.can_spend(db, "u1", today="2026-06-26") is False
        # next day resets
        assert await gov.can_spend(db, "u1", today="2026-06-27") is True

@pytest.mark.asyncio
async def test_remaining_reports_caps(db_factory):
    from agent.will.budget import BudgetGovernor
    gov = BudgetGovernor()
    async with db_factory() as db:
        await gov.note_spend(db, "u1", calls=5, tokens=1000, today="2026-06-26")
        await db.commit()
    async with db_factory() as db:
        b = await gov.remaining(db, "u1", today="2026-06-26")
        assert b.calls_used == 5 and b.tokens_used == 1000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_budget.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.will.budget'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/backend/agent/will/budget.py
from __future__ import annotations

import time
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import WillBudgetLedger
from agent.will.types import Budget
from config import config


def _today() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d")


class BudgetGovernor:
    async def _row(self, db: AsyncSession, user_id: str, day: str) -> WillBudgetLedger:
        res = await db.execute(
            select(WillBudgetLedger).where(
                WillBudgetLedger.user_id == user_id,
                WillBudgetLedger.ledger_date == day,
            )
        )
        row = res.scalar_one_or_none()
        if row is None:
            row = WillBudgetLedger(user_id=user_id, ledger_date=day,
                                   llm_calls=0, tokens=0, updated_at=time.time())
            db.add(row)
            await db.flush()
        return row

    async def remaining(self, db: AsyncSession, user_id: str, *, today: str | None = None) -> Budget:
        row = await self._row(db, user_id, today or _today())
        return Budget(
            calls_used=row.llm_calls, tokens_used=row.tokens,
            calls_cap=config.will_daily_llm_calls, tokens_cap=config.will_daily_token_cap,
        )

    async def note_spend(self, db: AsyncSession, user_id: str, calls: int, tokens: int,
                         *, today: str | None = None) -> None:
        row = await self._row(db, user_id, today or _today())
        row.llm_calls += int(calls)
        row.tokens += int(tokens)
        row.updated_at = time.time()

    async def can_spend(self, db: AsyncSession, user_id: str, *, today: str | None = None) -> bool:
        return (await self.remaining(db, user_id, today=today)).ok
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_budget.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/will/budget.py src/backend/tests/test_will_budget.py
git commit -m "feat(will): daily budget governor with midnight reset

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 6: Intent mutex

**Files:**
- Create: `src/backend/agent/will/arbitration.py`
- Test: `src/backend/tests/test_will_arbitration.py`

**Interfaces:**
- Produces: module-singleton `intent_mutex` with
  - `def try_acquire(holder: str) -> bool`
  - `def release(holder: str) -> None`
  - `@property held_by -> str | None`
  - `async def hold(holder: str)` (async context manager; raises `IntentBusy` if already held)

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_arbitration.py
import pytest
from agent.will.arbitration import intent_mutex, IntentBusy

def test_try_acquire_blocks_second_holder():
    assert intent_mutex.try_acquire("will") is True
    assert intent_mutex.held_by == "will"
    assert intent_mutex.try_acquire("proactive") is False
    intent_mutex.release("will")
    assert intent_mutex.held_by is None

@pytest.mark.asyncio
async def test_hold_context_manager_releases():
    async with intent_mutex.hold("will"):
        assert intent_mutex.held_by == "will"
    assert intent_mutex.held_by is None

@pytest.mark.asyncio
async def test_hold_raises_when_busy():
    assert intent_mutex.try_acquire("proactive") is True
    with pytest.raises(IntentBusy):
        async with intent_mutex.hold("will"):
            pass
    intent_mutex.release("proactive")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_arbitration.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.will.arbitration'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/backend/agent/will/arbitration.py
from __future__ import annotations

from contextlib import asynccontextmanager


class IntentBusy(Exception):
    """Raised when an intent holder is requested but the mutex is held."""


class IntentMutex:
    def __init__(self) -> None:
        self._holder: str | None = None

    @property
    def held_by(self) -> str | None:
        return self._holder

    def try_acquire(self, holder: str) -> bool:
        if self._holder is not None:
            return False
        self._holder = holder
        return True

    def release(self, holder: str) -> None:
        if self._holder == holder:
            self._holder = None

    @asynccontextmanager
    async def hold(self, holder: str):
        if not self.try_acquire(holder):
            raise IntentBusy(f"intent held by {self._holder!r}")
        try:
            yield
        finally:
            self.release(holder)


intent_mutex = IntentMutex()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_arbitration.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/will/arbitration.py src/backend/tests/test_will_arbitration.py
git commit -m "feat(will): intent mutex for will/proactive arbitration

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 7: Will journal

**Files:**
- Create: `src/backend/agent/will/journal.py`
- Test: `src/backend/tests/test_will_journal.py`

**Interfaces:**
- Consumes: `WillJournal` model; `WillDecision` from Task 1.
- Produces: `class WillJournalWriter` with
  - `async def record(db, user_id, decision, *, task_id=None, outcome="", budget_delta=None) -> None`
  - `async def recent(db, user_id, n=10) -> list[dict]`

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_journal.py
import os, tempfile, importlib
import pytest, pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t"); os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm, db.models as dm  # noqa: F401
    importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db"); os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
    factory = async_sessionmaker(eng, expire_on_commit=False)
    yield factory
    await eng.dispose(); os.unlink(tmp)

@pytest.mark.asyncio
async def test_record_and_recent(db_factory):
    from agent.will.journal import WillJournalWriter
    from agent.will.types import WillDecision
    w = WillJournalWriter()
    async with db_factory() as db:
        await w.record(db, "u1", WillDecision(kind="start_task", goal_id="g1",
                       action_text="підготувати маршрут", rationale="бо deadline"),
                       task_id="t1", outcome="dispatched", budget_delta={"calls": 1})
        await db.commit()
    async with db_factory() as db:
        rows = await w.recent(db, "u1", n=5)
    assert len(rows) == 1
    assert rows[0]["action"] == "start_task"
    assert rows[0]["task_id"] == "t1"
    assert "маршрут" in rows[0]["decision"]["action_text"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_journal.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.will.journal'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/backend/agent/will/journal.py
from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import WillJournal
from agent.will.types import WillDecision


class WillJournalWriter:
    async def record(self, db: AsyncSession, user_id: str, decision: WillDecision,
                     *, task_id: str | None = None, outcome: str = "",
                     budget_delta: dict | None = None) -> None:
        db.add(WillJournal(
            id=str(uuid.uuid4()), user_id=user_id, ts=time.time(),
            decision_json=json.dumps(asdict(decision), ensure_ascii=False),
            action=decision.kind, task_id=task_id, outcome=outcome,
            budget_delta_json=json.dumps(budget_delta or {}, ensure_ascii=False),
        ))
        await db.flush()

    async def recent(self, db: AsyncSession, user_id: str, n: int = 10) -> list[dict]:
        res = await db.execute(
            select(WillJournal)
            .where(WillJournal.user_id == user_id)
            .order_by(WillJournal.ts.desc())
            .limit(n)
        )
        out = []
        for r in res.scalars().all():
            out.append({
                "ts": r.ts, "action": r.action, "task_id": r.task_id,
                "outcome": r.outcome,
                "decision": json.loads(r.decision_json or "{}"),
                "budget_delta": json.loads(r.budget_delta_json or "{}"),
            })
        return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_journal.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/will/journal.py src/backend/tests/test_will_journal.py
git commit -m "feat(will): append-only will journal writer + reader

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 8: Decide-ONE reasoning

**Files:**
- Create: `src/backend/agent/will/decide.py`
- Test: `src/backend/tests/test_will_decide.py`

**Interfaces:**
- Consumes: `Goal`, `Budget`, `WillDecision` from Task 1.
- Produces: `async def decide_next(snapshot: dict, goals: list[Goal], budget: Budget, *, dispatch_llm) -> WillDecision`. `dispatch_llm` is an async callable `(prompt: str, system: str) -> str` injected for testability (production passes a thin wrapper over `ai_hub.dispatch`).

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_decide.py
import pytest
from agent.will.types import Goal, Budget
from agent.will.decide import decide_next

def _g(gid, lvl, desc):
    return Goal(id=gid, user_id="u1", parent_id=None, horizon_level=lvl,
                description=desc, status="pending", kpi=None, deadline=None,
                blockers=[], source="seeded")

@pytest.mark.asyncio
async def test_decide_returns_single_action():
    async def fake_llm(prompt, system):
        return '{"kind":"start_task","goal_id":"a1","action_text":"написати тест","rationale":"перший крок"}'
    d = await decide_next({"when": {"time": "10:00"}},
                          [_g("a1", 6, "написати тест")],
                          Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "start_task"
    assert d.goal_id == "a1"
    assert d.action_text == "написати тест"

@pytest.mark.asyncio
async def test_decide_noop_on_empty_goals():
    called = False
    async def fake_llm(prompt, system):
        nonlocal called; called = True; return "{}"
    d = await decide_next({}, [], Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "noop"
    assert called is False  # no goals → no LLM spend

@pytest.mark.asyncio
async def test_decide_tolerates_fenced_json():
    async def fake_llm(prompt, system):
        return '```json\n{"kind":"proactive_seed","action_text":"нагадати про воду"}\n```'
    d = await decide_next({}, [_g("a1", 5, "здоровʼя")], Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "proactive_seed"
    assert d.action_text == "нагадати про воду"

@pytest.mark.asyncio
async def test_decide_noop_on_garbage():
    async def fake_llm(prompt, system):
        return "not json at all"
    d = await decide_next({}, [_g("a1", 6, "x")], Budget(0, 0, 200, 300_000), dispatch_llm=fake_llm)
    assert d.kind == "noop"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_decide.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.will.decide'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/backend/agent/will/decide.py
from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from agent.will.types import Goal, Budget, WillDecision
from agent.cognition.planner.horizons import HORIZON_NAMES

logger = logging.getLogger(__name__)

_SYSTEM = ("Ти — воля PHANTOM. Обери РІВНО ОДНУ найцінніщу наступну дію до цілей. "
           "Поверни ЛИШЕ JSON, без прози.")

_PROMPT = """\
[ЧАС/КОНТЕКСТ]
{ctx}

[АКТИВНІ ЦІЛІ ПО ГОРИЗОНТАХ]
{goals}

[БЮДЖЕТ НА СЬОГОДНІ]
викликів лишилось: {calls_left}, токенів: {tokens_left}

Обери ОДНУ дію, що найбільше просуває найважливішу ціль зараз. Види дій:
- start_task: запустити фонову задачу (велика робота)
- standing_order: створити повторюване правило
- proactive_seed: підготувати репліку користувачу
- noop: зараз діяти не варто

Поверни ЛИШЕ JSON:
{{"kind": "...", "goal_id": "<id або null>", "action_text": "...", "rationale": "..."}}"""


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


async def decide_next(
    snapshot: dict,
    goals: list[Goal],
    budget: Budget,
    *,
    dispatch_llm: Callable[[str, str], Awaitable[str]],
) -> WillDecision:
    if not goals:
        return WillDecision(kind="noop", rationale="no active goals")

    goal_lines = "\n".join(
        f"- [{HORIZON_NAMES[g.horizon_level] if g.horizon_level < len(HORIZON_NAMES) else g.horizon_level}] "
        f"{g.description} (id={g.id}, status={g.status})"
        for g in goals
    )
    prompt = _PROMPT.format(
        ctx=json.dumps(snapshot.get("when", {}), ensure_ascii=False),
        goals=goal_lines,
        calls_left=budget.calls_cap - budget.calls_used,
        tokens_left=budget.tokens_cap - budget.tokens_used,
    )
    try:
        raw = await dispatch_llm(prompt, _SYSTEM)
        parsed = json.loads(_strip_fence(raw))
        kind = str(parsed.get("kind", "noop"))
        if kind not in ("start_task", "standing_order", "proactive_seed", "noop"):
            kind = "noop"
        return WillDecision(
            kind=kind,  # type: ignore[arg-type]
            goal_id=parsed.get("goal_id") or None,
            action_text=str(parsed.get("action_text", ""))[:500],
            rationale=str(parsed.get("rationale", ""))[:500],
        )
    except Exception as exc:
        logger.debug("decide_next parse failed: %s", exc)
        return WillDecision(kind="noop", rationale="decide parse failure")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_decide.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/will/decide.py src/backend/tests/test_will_decide.py
git commit -m "feat(will): decide-ONE reasoning step (injectable LLM)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 9: Will engine (tick orchestration)

**Files:**
- Create: `src/backend/agent/will/engine.py`
- Test: `src/backend/tests/test_will_engine.py`

**Interfaces:**
- Consumes: everything from Tasks 1, 4–8; `AgentRuntime.start_task`; `intent_mutex`.
- Produces: module-singleton `will_engine` (`WillEngine`) with
  - `async def run_once(db, user_id, *, snapshot, now=None) -> WillTickResult`
  - `async def start() -> None` / `async def stop() -> None`
  - injectable seams: `self.dispatch_llm`, `self.start_task` (default wired to production).

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_engine.py
import os, tempfile, importlib
import pytest, pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t"); os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm, db.models as dm  # noqa: F401
    importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db"); os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
        from db.models import User
    factory = async_sessionmaker(eng, expire_on_commit=False)
    async with factory() as s:
        s.add(User(id="u1", username="u1", role="root", password_hash="x"))
        await s.commit()
    yield factory
    await eng.dispose(); os.unlink(tmp)

@pytest.mark.asyncio
async def test_tick_dispatches_start_task_and_journals(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    async with db_factory() as db:
        await goals.seed(db, "u1", "написати модуль", 6); await db.commit()

    eng = WillEngine()
    async def fake_llm(prompt, system):
        gid = None
        for line in prompt.splitlines():
            if "id=" in line:
                gid = line.split("id=")[1].split(",")[0]
        return f'{{"kind":"start_task","goal_id":"{gid}","action_text":"крок","rationale":"r"}}'
    started = {}
    async def fake_start_task(**kwargs):
        started.update(kwargs); return ("task-123", True)
    eng.dispatch_llm = fake_llm
    eng.start_task = fake_start_task

    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={"when": {"time": "10:00"}})
        await db.commit()
    assert res.dispatched is True
    assert res.task_id == "task-123"
    assert started["origin"] == "will"
    assert started["track"] == "background"

    from agent.will.journal import WillJournalWriter
    async with db_factory() as db:
        rows = await WillJournalWriter().recent(db, "u1")
    assert rows and rows[0]["action"] == "start_task"

@pytest.mark.asyncio
async def test_tick_noops_when_disabled(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from config import config
    monkeypatch.setattr(config, "will_enabled", False, raising=False)
    eng = WillEngine()
    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
    assert res.dispatched is False
    assert res.note == "disabled"

@pytest.mark.asyncio
async def test_tick_stops_when_budget_spent(db_factory, monkeypatch):
    from agent.will.engine import WillEngine
    from agent.will import goals
    from agent.will.budget import BudgetGovernor
    from config import config
    monkeypatch.setattr(config, "will_enabled", True, raising=False)
    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль", 6)
        await BudgetGovernor().note_spend(db, "u1", calls=config.will_daily_llm_calls, tokens=0)
        await db.commit()
    eng = WillEngine()
    async with db_factory() as db:
        res = await eng.run_once(db, "u1", snapshot={})
    assert res.dispatched is False
    assert res.note == "budget_exhausted"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.will.engine'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/backend/agent/will/engine.py
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from agent.will import goals as goals_repo
from agent.will.budget import BudgetGovernor
from agent.will.journal import WillJournalWriter
from agent.will.decide import decide_next
from agent.will.arbitration import intent_mutex, IntentBusy
from agent.will.types import WillTickResult, WillDecision

logger = logging.getLogger(__name__)


async def _default_dispatch_llm(prompt: str, system: str) -> str:
    from ai.hub import ai_hub
    resp = await ai_hub.dispatch(
        "chat",
        {"user_message": prompt, "system_prompt": system, "history": [],
         "user_id": "will", "model_override": config.ai_reasoning_model},
        provider_hint=config.ai_primary_provider,
    )
    return resp.content or ""


async def _default_start_task(**kwargs) -> tuple[str, bool]:
    from agent.kernel.runtime import agent_runtime
    return await agent_runtime.start_task(**kwargs)


class WillEngine:
    def __init__(self) -> None:
        self.governor = BudgetGovernor()
        self.journal = WillJournalWriter()
        self.dispatch_llm: Callable[[str, str], Awaitable[str]] = _default_dispatch_llm
        self.start_task: Callable[..., Awaitable[tuple[str, bool]]] = _default_start_task
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def run_once(self, db: AsyncSession, user_id: str, *, snapshot: dict,
                       now=None) -> WillTickResult:
        if not config.will_enabled:
            return WillTickResult(WillDecision(kind="noop"), note="disabled")

        if not await self.governor.can_spend(db, user_id):
            return WillTickResult(WillDecision(kind="noop"), note="budget_exhausted")

        active = await goals_repo.list_active(db, user_id)
        budget = await self.governor.remaining(db, user_id)
        decision = await decide_next(snapshot, active, budget, dispatch_llm=self.dispatch_llm)
        await self.governor.note_spend(db, user_id, calls=1, tokens=0)

        if decision.kind == "noop":
            return WillTickResult(decision, note="noop")

        dispatched = False
        task_id = None
        try:
            async with intent_mutex.hold("will"):
                if decision.kind == "start_task":
                    task_id, started = await self.start_task(
                        user_id=user_id, goal=decision.action_text,
                        origin="will", track="background",
                    )
                    dispatched = bool(started or task_id)
                    if decision.goal_id:
                        await goals_repo.set_status(db, decision.goal_id, "running")
                elif decision.kind == "proactive_seed":
                    try:
                        from agent.consciousness_stream import consciousness_stream
                        consciousness_stream._pending_insights.setdefault(user_id, []).append(
                            decision.action_text)
                        dispatched = True
                    except Exception as exc:
                        logger.debug("proactive_seed failed: %s", exc)
                elif decision.kind == "standing_order":
                    # Executive arm handled in a later sub-project; record intent now.
                    dispatched = False
        except IntentBusy:
            return WillTickResult(decision, dispatched=False, note="intent_busy")

        await self.journal.record(
            db, user_id, decision, task_id=task_id,
            outcome="dispatched" if dispatched else decision.kind,
            budget_delta={"calls": 1},
        )
        return WillTickResult(decision, dispatched=dispatched, task_id=task_id,
                              note="dispatched" if dispatched else decision.kind)

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="will_engine")
        logger.info("Will engine started (enabled=%s)", config.will_enabled)

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _run(self) -> None:
        from db.database import get_session
        from core.context_engine import context_engine
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=config.will_tick_interval_s)
                break
            except asyncio.TimeoutError:
                pass
            if not config.will_enabled:
                continue
            try:
                snapshot = context_engine.get_snapshot()
                async with get_session() as db:
                    from db.models import User
                    from sqlalchemy import select
                    uid_rows = (await db.execute(select(User.id))).scalars().all()
                for uid in uid_rows:
                    async with get_session() as db:
                        await self.run_once(db, uid, snapshot=snapshot)
                        await db.commit()
            except Exception as exc:
                logger.debug("will tick error: %s", exc)


will_engine = WillEngine()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_engine.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/will/engine.py src/backend/tests/test_will_engine.py
git commit -m "feat(will): WillEngine tick orchestration + loop

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 10: Proactive arbitration + lifespan wiring

**Files:**
- Modify: `src/backend/agent/cognition/proactive/loop.py` (acquire intent mutex before interjecting)
- Modify: `src/backend/main.py` (start/stop `will_engine` in lifespan, next to proactive loop)
- Test: `src/backend/tests/test_will_arbitration_integration.py`

**Interfaces:**
- Consumes: `intent_mutex` from Task 6; `will_engine` from Task 9.
- Produces: ProactiveLoop defers while the will holds the mutex; engine started in lifespan.

- [ ] **Step 1: Write the failing test**

```python
# src/backend/tests/test_will_arbitration_integration.py
import pytest
from agent.will.arbitration import intent_mutex

def test_proactive_helper_defers_when_will_holds():
    from agent.cognition.proactive.loop import _intent_available_for_proactive
    assert intent_mutex.try_acquire("will") is True
    assert _intent_available_for_proactive() is False
    intent_mutex.release("will")
    assert _intent_available_for_proactive() is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_arbitration_integration.py -v`
Expected: FAIL — `ImportError: cannot import name '_intent_available_for_proactive'`

- [ ] **Step 3a: Add the helper + guard in `proactive/loop.py`**

Near the top-level helpers of `src/backend/agent/cognition/proactive/loop.py` (after the `_utcnow` definition), add:

```python
def _intent_available_for_proactive() -> bool:
    """Proactive interjection is allowed only when the will isn't acting."""
    from agent.will.arbitration import intent_mutex
    return intent_mutex.held_by is None
```

Then in `_release_deferred_thoughts`, immediately after `if not deferred: return`, add:

```python
        if not _intent_available_for_proactive():
            return
```

- [ ] **Step 3b: Wire the engine into `main.py` lifespan**

In `src/backend/main.py`, find where the proactive loop is started (search for `proactive_loop_obj`). After the proactive loop `.start()` block, add:

```python
        try:
            from agent.will.engine import will_engine
            await will_engine.start()
        except Exception as exc:
            logger.warning("will engine start failed: %s", exc)
```

In the shutdown section of the same lifespan (search for where `proactive_loop_obj` is stopped, or the symmetric teardown), add:

```python
        try:
            from agent.will.engine import will_engine
            await will_engine.stop()
        except Exception:
            pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_arbitration_integration.py -v`
Expected: PASS

Then verify nothing imports broke:
Run: `cd src/backend && .venv/bin/python -c "import main; import api.routes_chat; print('import ok')"`
Expected: `import ok`

- [ ] **Step 5: Commit**

```bash
git add src/backend/agent/cognition/proactive/loop.py src/backend/main.py src/backend/tests/test_will_arbitration_integration.py
git commit -m "feat(will): proactive defers to will via mutex; lifespan wiring

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 11: Will actions (seed_goal + status) and chat reachability

**Files:**
- Create: `src/backend/agent/actions/will_seed.py`
- Create: `src/backend/agent/actions/will_status.py`
- Modify: `src/backend/agent/actions/registry.py` (register the two actions)
- Test: `src/backend/tests/test_will_actions.py`

**Interfaces:**
- Consumes: `goals` repo (Task 4); `WillJournalWriter` (Task 7); existing action `base`/`registry` patterns.
- Produces: actions `will.seed_goal(description, horizon_level)` and `will.status()` callable via the agent action registry.

- [ ] **Step 1: Read the action pattern first**

Run: `cd src/backend && sed -n '1,60p' agent/actions/time_.py`
Expected: shows the minimal action module shape (class/handler + how `registry.py` registers it). Mirror this exact shape in steps below; if the project uses a decorator or a base class, match it rather than the skeleton here.

- [ ] **Step 2: Write the failing test**

```python
# src/backend/tests/test_will_actions.py
import os, tempfile, importlib
import pytest, pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("JWT_SECRET_KEY", "t"); os.environ.setdefault("AI_GEMINI_API_KEY", "k")
os.environ.setdefault("PHANTOM_SERIAL_ENABLED", "false")

@pytest_asyncio.fixture
async def db_factory():
    import db.database as dbm, db.models as dm  # noqa: F401
    importlib.reload(dm)
    fd, tmp = tempfile.mkstemp(suffix=".db"); os.close(fd)
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp}", echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(dbm.Base.metadata.create_all)
        from db.models import User
    factory = async_sessionmaker(eng, expire_on_commit=False)
    async with factory() as s:
        s.add(User(id="u1", username="u1", role="root", password_hash="x")); await s.commit()
    yield factory
    await eng.dispose(); os.unlink(tmp)

@pytest.mark.asyncio
async def test_seed_goal_action_persists(db_factory):
    from agent.actions.will_seed import seed_goal
    async with db_factory() as db:
        out = await seed_goal(db, "u1", description="Стати незрівнянним", horizon_level=0)
        await db.commit()
    assert out["ok"] is True
    from agent.will import goals
    async with db_factory() as db:
        active = await goals.list_active(db, "u1")
    assert any(g.description == "Стати незрівнянним" for g in active)

@pytest.mark.asyncio
async def test_status_action_reads_tree_and_journal(db_factory):
    from agent.actions.will_status import will_status
    from agent.will import goals
    async with db_factory() as db:
        await goals.seed(db, "u1", "ціль дня", 5); await db.commit()
    async with db_factory() as db:
        out = await will_status(db, "u1")
    assert out["ok"] is True
    assert out["active_goals"] >= 1
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_actions.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.actions.will_seed'`

- [ ] **Step 4: Write minimal implementation**

```python
# src/backend/agent/actions/will_seed.py
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from agent.will import goals


async def seed_goal(db: AsyncSession, user_id: str, *, description: str,
                    horizon_level: int = 0, kpi: str | None = None) -> dict:
    """Operator seeds a top-horizon goal for the will to pursue."""
    gid = await goals.seed(db, user_id, description, int(horizon_level),
                           kpi=kpi, source="seeded")
    return {"ok": True, "goal_id": gid, "horizon_level": int(horizon_level)}
```

```python
# src/backend/agent/actions/will_status.py
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from agent.will import goals
from agent.will.journal import WillJournalWriter


async def will_status(db: AsyncSession, user_id: str) -> dict:
    """Report what the will is pursuing and what it recently did."""
    active = await goals.list_active(db, user_id)
    recent = await WillJournalWriter().recent(db, user_id, n=5)
    return {
        "ok": True,
        "active_goals": len(active),
        "goals": [{"description": g.description, "horizon_level": g.horizon_level,
                   "status": g.status} for g in active],
        "recent_actions": [{"action": r["action"], "outcome": r["outcome"]} for r in recent],
    }
```

Register both in `agent/actions/registry.py` following the existing registration pattern observed in Step 1 (e.g., add to the registry dict/list with verbs `will.seed_goal` and `will.status`). If registration is via a decorator, decorate the two functions instead; keep names `will.seed_goal` / `will.status`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_actions.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add src/backend/agent/actions/will_seed.py src/backend/agent/actions/will_status.py src/backend/agent/actions/registry.py src/backend/tests/test_will_actions.py
git commit -m "feat(will): will.seed_goal + will.status agent actions

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 12: Full-suite green + smoke

**Files:** none (verification task)

- [ ] **Step 1: Run the whole will suite**

Run: `cd src/backend && .venv/bin/python -m pytest tests/test_will_*.py -v`
Expected: all PASS.

- [ ] **Step 2: Import smoke (no board load)**

Run: `cd src/backend && .venv/bin/python -c "import agent.will.engine, main, api.routes_chat; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Confirm default-off**

Run: `cd src/backend && .venv/bin/python -c "from config import config; print('will_enabled', config.will_enabled)"`
Expected: `will_enabled False`

- [ ] **Step 4: Commit (if any lint/format touched files)**

```bash
git add -A && git commit -m "test(will): full will-suite green; engine ships default-off

Co-Authored-By: claude-flow <ruv@ruv.net>" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Conductor architecture → Tasks 9, 10. ✔
- Owns goals_persistent (single source of intent) → Task 4. ✔
- Decide-ONE / anti-bifurcation → Task 8 + engine dispatches one thing/tick. ✔
- Daily budget governor + midnight reset + survives restart (DB-backed) → Task 5. ✔
- Goal seeding + (self-generation) → Task 11 seeds; **self-generation reflective sub-step is specified in the design but deferred to a follow-up task** — see Gap below. 
- Reporting / Will Journal + chat query → Tasks 7, 11. ✔
- Arbitration with proactive/standing orders → Tasks 6, 10. ✔
- Kill switch default-off → Tasks 3, 9, 12. ✔
- Tables via models + migration → Task 2. ✔
- Config reachable from Settings → Task 3. ✔

**Gap (intentional, called out):** the once/day *reflective self-generation* of new goals (Orient step) is not yet a task — it needs the mind_state/narrative/ToM read wiring and is best implemented after the core loop is proven live. Add as **Task 13 (follow-up)**: a `reflect_and_propose(db, user_id)` in `agent/will/reflect.py` that, gated by `will_reflect_hour_local`, reads mind_state + recent ToM episodes and seeds `source="self_generated"` pending goals; unit-tested with mocked LLM. This keeps the first plan shippable and the riskier generative step isolated.

**Placeholder scan:** no TBD/TODO in product code steps; every code step shows full code. Action-registry registration (Task 11) intentionally defers to the observed pattern via a read-first step rather than guessing the registry API — this is a read instruction, not a placeholder.

**Type consistency:** `Goal`, `WillDecision`, `Budget`, `WillTickResult` defined in Task 1 and used unchanged in Tasks 4–9. `dispatch_llm` signature `(prompt, system) -> str` consistent between Task 8 and Task 9. `start_task(**kwargs) -> (task_id, started)` matches `AgentRuntime.start_task`'s `(str, bool)` return.
