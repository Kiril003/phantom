# Agent Ascension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Spec: `docs/superpowers/specs/2026-05-16-agent-ascension-design.md`.

**Goal:** Make the Агент conversational, limitless, progressively-visible, and self-extending — strictly better than Claude Code, per the spec's 6 verticals.

**Architecture:** 6 independent verticals, executed V1→V6→V2→V3→V5→V4. V1 & V6 fully specified below. V2–V5 get a focused just-in-time plan written immediately before each executes (spec already decomposed them; avoids a wasteful upfront mega-plan and lets each plan use fresh exact context). Every change: TDD, atomic **targeted** `git add` (NEVER `-A` — 196 unrelated refactor files in tree), dense code/minimal comments, no mocks/TODO, config in Settings UI.

**Tech Stack:** Python 3.11/FastAPI/SQLAlchemy-async/pytest; React18/TS/Zustand/vitest; existing agent WS channel; bwrap sandbox.

**Restart caveat:** config/provider/router/personality changes need a backend restart (no `--reload`). Tracked in the morning report.

---

## VERTICAL 1 — Limitless execution (`<=0` ⇒ unbound + Settings UI)

Verified anchors: `config.py:440` `agent_max_actions_per_task=20`,
`:446` `agent_max_llm_calls_per_task=50`, `:453`
`agent_max_llm_calls_per_background_task=10`; enforcement at
`agent/operations/safety/circuit_breakers.py:42`
(`self.actions_run >= config.agent_max_actions_per_task`),
`agent/kernel/runtime.py:829` (`... or 10`), `:832` (`... or 50`);
bash `agent/actions/bash.py:35` `_HARD_TIMEOUT_S=120`, `:36`
`_OUTPUT_LIMIT_BYTES=16*1024`, `:61` `timeout_s ... le=_HARD_TIMEOUT_S`,
`:159` `timeout=min(self.timeout_s,_HARD_TIMEOUT_S)`.

### Task V1.1: config — bash caps + unbound default

**Files:** Modify `src/backend/config.py`; Test `src/backend/tests/test_agent_limitless.py`

- [ ] **Step 1: failing test**

```python
# src/backend/tests/test_agent_limitless.py
from config import config

def test_limitless_config_defaults():
    assert config.agent_bash_timeout_s == 120
    assert config.agent_bash_output_cap_bytes == 16384
    assert config.agent_unbound_default is False
```

- [ ] **Step 2:** `cd src/backend && .venv/bin/python -m pytest tests/test_agent_limitless.py::test_limitless_config_defaults -v -p no:cacheprovider` → FAIL (AttributeError).
- [ ] **Step 3:** in `config.py` next to `agent_max_actions_per_task` (line ~440) add:

```python
    agent_bash_timeout_s: int = 120
    agent_bash_output_cap_bytes: int = 16384
    agent_unbound_default: bool = False
```

- [ ] **Step 4:** rerun → PASS.
- [ ] **Step 5:** `git add src/backend/config.py src/backend/tests/test_agent_limitless.py && git commit -m "feat(agent-limitless): config — bash caps + unbound default

Co-Authored-By: claude-flow <ruv@ruv.net>"`

### Task V1.2: action cap `<=0` ⇒ unbound

**Files:** Modify `src/backend/agent/operations/safety/circuit_breakers.py:42`; Test append `test_agent_limitless.py`

- [ ] **Step 1: failing test** (append)

```python
def test_action_cap_unbound_when_zero(monkeypatch):
    from agent.operations.safety import circuit_breakers as cb
    from config import config
    monkeypatch.setattr(config, "agent_max_actions_per_task", 0)
    b = cb.CircuitBreakers()           # construct per its real signature
    b.actions_run = 9999
    assert b.action_cap_reached() is False
    monkeypatch.setattr(config, "agent_max_actions_per_task", 20)
    b.actions_run = 20
    assert b.action_cap_reached() is True
```

(Implementer: read circuit_breakers.py for the exact class/ctor/method
name around line 42 — the predicate currently is
`return self.actions_run >= config.agent_max_actions_per_task`. Adapt
the test's constructor + method name to the real ones; keep the two
assertions: 0→never reached even at 9999; 20→reached at 20.)

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** change line 42 predicate to:

```python
        cap = config.agent_max_actions_per_task
        return cap > 0 and self.actions_run >= cap
```

- [ ] **Step 4:** run → PASS; also `pytest tests/test_phase_block_b_resource_governor.py -q --no-header -p no:cacheprovider` → PASS (regression on the governor).
- [ ] **Step 5:** `git add src/backend/agent/operations/safety/circuit_breakers.py src/backend/tests/test_agent_limitless.py && git commit -m "feat(agent-limitless): action cap <=0 ⇒ unbound

Co-Authored-By: claude-flow <ruv@ruv.net>"`

### Task V1.3: LLM-call caps `<=0` ⇒ unbound

**Files:** Modify `src/backend/agent/kernel/runtime.py:~819-835`; Test append

- [ ] **Step 1: failing test** (append) — drive the cap helper directly:

```python
def test_llm_call_caps_unbound(monkeypatch):
    from agent.kernel import runtime as rt
    from config import config
    # foreground
    monkeypatch.setattr(config, "agent_max_llm_calls_per_task", 0)
    assert rt._llm_cap_for(background=False) in (0, None, float("inf"))
    monkeypatch.setattr(config, "agent_max_llm_calls_per_task", 50)
    assert rt._llm_cap_for(background=False) == 50
    monkeypatch.setattr(config, "agent_max_llm_calls_per_background_task", 0)
    assert rt._llm_cap_for(background=True) in (0, None, float("inf"))
```

(Implementer: lines 829/832 currently inline `int(getattr(config,
"...", N) or N)`. Extract a module helper `_llm_cap_for(*, background:
bool) -> int` returning `0` when the config value is `<=0` (meaning
unbound) else the int; replace both call sites to use it; at the
gate that compares `calls >= cap_at`, treat `cap_at <= 0` as never
reached. Adjust the test's expected sentinel to the chosen convention —
recommend `0 == unbound`, and the gate becomes
`cap_at > 0 and calls >= cap_at`.)

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement `_llm_cap_for` + rewire both sites + gate (`cap_at > 0 and calls >= cap_at`). Show final code in the commit.
- [ ] **Step 4:** run → PASS; `pytest tests/test_phase09_2_2_budget_integration.py tests/test_phase_block_b_resource_governor.py -q --no-header -p no:cacheprovider` → PASS.
- [ ] **Step 5:** `git add src/backend/agent/kernel/runtime.py src/backend/tests/test_agent_limitless.py && git commit -m "feat(agent-limitless): LLM-call caps <=0 ⇒ unbound (_llm_cap_for)

Co-Authored-By: claude-flow <ruv@ruv.net>"`

### Task V1.4: bash — config-driven timeout/output, `<=0` ⇒ unbound

**Files:** Modify `src/backend/agent/actions/bash.py`; Test append

- [ ] **Step 1: failing test** (append)

```python
import pytest

@pytest.mark.asyncio
async def test_bash_unbound_timeout_and_output(monkeypatch):
    from config import config
    from agent.actions import bash as bashmod
    monkeypatch.setattr(config, "agent_bash_timeout_s", 0)      # unbound
    monkeypatch.setattr(config, "agent_bash_output_cap_bytes", 0)
    # 64KB stdout must NOT be truncated when cap is 0
    act = bashmod.BashRun(command="printf 'x%.0s' {1..65536}")
    res = await act.run(user_id="u")            # adapt to real run() sig
    out = (res.get("stdout") if isinstance(res, dict) else getattr(res, "stdout", ""))
    assert len(out) >= 65536
```

(Implementer: read bash.py — replace module constants
`_HARD_TIMEOUT_S`/`_OUTPUT_LIMIT_BYTES` usage with
`config.agent_bash_timeout_s`/`config.agent_bash_output_cap_bytes`;
where `<=0`, skip `asyncio.wait_for` timeout entirely and skip output
truncation; relax the `timeout_s` Field `le=` bound (drop the upper
bound or set to a large constant) so callers can request long runs;
keep `ge=1`. Adapt the test to BashRun's real constructor/run
signature and result shape.)

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; show final code.
- [ ] **Step 4:** run → PASS; `pytest tests/test_phase_y1_sandbox_bwrap.py tests/test_phase_y5_sandbox_settings.py -q --no-header -p no:cacheprovider` → PASS.
- [ ] **Step 5:** `git add src/backend/agent/actions/bash.py src/backend/tests/test_agent_limitless.py && git commit -m "feat(agent-limitless): bash timeout/output config-driven, <=0 ⇒ unbound

Co-Authored-By: claude-flow <ruv@ruv.net>"`

### Task V1.5: Settings UI — "Агент / Межі" group + unbound master toggle

**Files:** Modify `src/frontend/src/components/settings/SettingsPanel.tsx` (+ settings store/schema as the existing pattern dictates); Test `src/frontend/src/__tests__/AgentLimitsSettings.test.tsx`

- [ ] **Step 1:** read how SettingsPanel groups + persist (existing settings groups pattern; the project rule "every config has a Settings UI"). Identify the settings schema/store and the PUT endpoint.
- [ ] **Step 2: failing test** — render the panel, assert an "Агент / Межі" / "Безмежний режим" control exists and toggling "Безмежний" sets the three caps to 0 in the store.

```tsx
// adapt selectors to the real SettingsPanel structure found in Step 1
import { render, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../components/settings/SettingsPanel';
it('unbound toggle zeroes agent caps', () => {
  const { getByLabelText } = render(<SettingsPanel />);
  fireEvent.click(getByLabelText(/безмежний режим/i));
  // assert store/state: agent_max_actions_per_task === 0 etc.
});
```

- [ ] **Step 3:** run → FAIL.
- [ ] **Step 4:** add an "Агент / Межі" group: numeric inputs for the 5 caps + a "Безмежний режим" toggle that sets the 3 LLM/action caps to 0; wire to the existing settings persistence (same pattern as other groups). Dense, 44px touch targets, 1024×600 safe.
- [ ] **Step 5:** run → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 6:** `git add src/frontend/src/components/settings/SettingsPanel.tsx src/frontend/src/__tests__/AgentLimitsSettings.test.tsx <any settings store/schema file touched> && git commit -m "feat(agent-limitless): Settings — Агент/Межі group + unbound toggle

Co-Authored-By: claude-flow <ruv@ruv.net>"`

### Task V1.6: V1 regression sweep

- [ ] `cd src/backend && .venv/bin/python -m pytest tests/test_agent_limitless.py tests/test_phase_block_b_resource_governor.py tests/test_phase09_2_2_budget_integration.py tests/test_phase_y1_sandbox_bwrap.py -q --no-header -p no:cacheprovider` → all green; `cd src/frontend && npx vitest run src/__tests__/AgentLimitsSettings.test.tsx && npx tsc --noEmit` → green. No commit (verification only).

---

## VERTICAL 6 — AGENT_INTERNALS.md doc-drift fix

**Files:** Modify `docs/AGENT_INTERNALS.md`

- [ ] **Step 1:** `grep -nE "agent/orchestrator/|agent/planner/|agent/safety/|agent/runtime\.py|agent/loop\.py|agent/executor\.py|agent/checkpoints\.py" docs/AGENT_INTERNALS.md` — list every stale path.
- [ ] **Step 2:** rewrite each to the real post-reorg path: `agent/orchestrator/`→`agent/operations/orchestrator/`; `agent/safety/`→`agent/operations/safety/`; `agent/planner/`→`agent/cognition/planner/`; `agent/runtime.py`→`agent/kernel/runtime.py`; `agent/loop.py`→`agent/kernel/loop.py`; `agent/executor.py`→`agent/kernel/executor.py`; `agent/checkpoints.py`→`agent/kernel/checkpoints.py`. Verify each new path exists (`ls`).
- [ ] **Step 3:** append two short sections: "Conversational Mode" (V2) and "Self-Synthesis" (V4) — placeholders are FORBIDDEN; write them after V2/V4 land (this task runs in the final sweep, not now — see execution order). For the doc-paths fix specifically, do Steps 1-2 now.
- [ ] **Step 4:** `grep` again → zero stale paths. `git add docs/AGENT_INTERNALS.md && git commit -m "docs(agent): fix AGENT_INTERNALS path drift (cognition/kernel/operations)

Co-Authored-By: claude-flow <ruv@ruv.net>"`

---

## VERTICALS 2–5 — just-in-time plans

Per the spec decomposition, each of V2 (conversational agent mode),
V3 (progressive artifact render), V5 (PlanEditor wire + declutter),
V4 (self-synthesizing capability) gets a focused, no-placeholder,
full-code plan written to this file (appended) **immediately before
that vertical executes**, using fresh exact codebase context (routes_
agent.py, agentStore.ts, ParallelChatDrawer.tsx, artifact_studio.py,
ActionRegistry/BaseAction, OperatorLayout.tsx). This keeps each plan
accurate against the real code at execution time rather than guessing
now. Execution order: V1 → V6(paths) → V2 → V3 → V5 → V4 → V6(doc
sections) → final sweep + morning report.

## Final Verification

- Per-vertical suites green + `tsc` clean + atomic commits.
- Cross-sweep: `pytest tests/test_agent_limitless.py tests/test_agent_conversation*.py tests/test_artifact_studio.py tests/test_artifact_widgets.py tests/test_phase27_chat_pipeline_widgets.py -q` + agent frontend vitest + tsc.
- Morning report: per-vertical status, commit SHAs, exact restart list, honest partials.
