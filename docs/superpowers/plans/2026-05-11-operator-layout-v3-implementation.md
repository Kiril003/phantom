# OperatorLayout v3 — Roster + Focus + Tape + Chrome Collapse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Замінити нинішній перевантажений `OperatorLayout` на трисмугову модель (AgentRoster + FocusPanel + Tape), додати системно колапс chrome (StatusBar / Roster / HUD / FloatingToolbar) через `<ChromeHandle>`, дати оператору видимі помилки toast, дедуплікувати loop-spam у FE, і додати auto-pause guard у backend orchestrator, щоб петля revise_strategy не палила квоту.

**Architecture:** Frontend — нові компоненти `AgentRoster`, `FocusPanel`, `Tape`, `ChromeHandle`, `ToastRail`; новий hook `useChromeCollapse` (persist у localStorage `phantom.chrome.v1`); розширення `useUIStore` (focusedAgent + toast + chrome). OperatorLayout повністю переписаний у body. Backend — 1 хірургічна правка в `agent/loop.py` (~15 LOC) + 1 новий test-файл.

**Tech Stack:** React 18 + TypeScript strict + Zustand 4 + Framer Motion + Tailwind / vitest + testing-library. Python 3.11 / pytest для backend.

**Spec:** `docs/superpowers/specs/2026-05-11-operator-layout-v3-design.md` (revision 2). Прочитай перед стартом — кожен з нижче-перерахованих файлів і назв збігається зі спекою.

---

## File Structure

| Дія | Шлях | Відповідальність |
|-----|------|------------------|
| CREATE | `src/frontend/src/hooks/useChromeCollapse.ts` | Hook: `(key, defaultCollapsed?) => [collapsed, toggle]` + persist у `localStorage.phantom.chrome.v1`. |
| CREATE | `src/frontend/src/hooks/useStandingOrdersHeartbeat.ts` | Polling GET `/agent/standing_orders` раз/10s, повертає `{ enabled, fired24h, lastFireAt }`. |
| CREATE | `src/frontend/src/components/core/ChromeHandle.tsx` | Спільний стрілочко-toggle 44×24 для chrome elements. |
| CREATE | `src/frontend/src/components/core/ToastRail.tsx` | Глобальний контейнер тостів. Читає `useUIStore.toasts`. |
| CREATE | `src/frontend/src/components/agent/AgentRoster.tsx` | 5-section chip-row. Селектор focusedAgent. |
| CREATE | `src/frontend/src/components/agent/FocusPanel.tsx` | Multi-pivot view обраного агента. |
| CREATE | `src/frontend/src/components/agent/Tape.tsx` | 120px права колонка з дедупом подій. |
| CREATE | `src/frontend/src/components/agent/tape-utils.ts` | Pure `collapseRepeats(items)` + `sameSignature`. |
| MODIFY | `src/frontend/src/stores/uiStore.ts` | Додаємо `focusedAgent`, `toasts`, `chrome` slices. |
| MODIFY | `src/frontend/src/components/core/StatusBar.tsx` | Compact-mode + handle. |
| MODIFY | `src/frontend/src/components/core/FloatingToolbar.tsx` | Collapsed-mode + handle. |
| MODIFY | `src/frontend/src/components/agent/AgentCommandCenter.tsx` | Error toast, collapsed handle, auto-policies. |
| MODIFY | `src/frontend/src/layouts/OperatorLayout.tsx` | Rewrite body: Roster + Focus + Tape + chrome wiring. |
| MODIFY | `src/frontend/src/layouts/ShadowLayout.tsx` | Wire `useChromeCollapse('statusBar','toolbar')`. |
| MODIFY | `src/frontend/src/layouts/FocusLayout.tsx` | Wire `useChromeCollapse('statusBar','toolbar')`. |
| MODIFY | `src/frontend/src/layouts/DialogueLayout.tsx` | Wire `useChromeCollapse('statusBar','toolbar')`. |
| MODIFY | `src/frontend/src/layouts/SentinelLayout.tsx` | Wire `useChromeCollapse('statusBar','toolbar')`. |
| MODIFY | `src/frontend/src/layouts/GhostLayout.tsx` | Wire `useChromeCollapse('statusBar','toolbar')`. |
| MODIFY | `src/backend/agent/loop.py` | Reflection-cap guard ~15 LOC. |
| CREATE | `src/frontend/src/__tests__/useChromeCollapse.test.ts` | Hook tests. |
| CREATE | `src/frontend/src/__tests__/ChromeHandle.test.tsx` | Handle component tests. |
| CREATE | `src/frontend/src/__tests__/ToastRail.test.tsx` | Toast container tests. |
| CREATE | `src/frontend/src/__tests__/AgentRoster.test.tsx` | Roster tests. |
| CREATE | `src/frontend/src/__tests__/Tape.test.tsx` | Tape dedup + render tests. |
| CREATE | `src/frontend/src/__tests__/tape-utils.test.ts` | `collapseRepeats` unit tests. |
| CREATE | `src/frontend/src/__tests__/FocusPanel.test.tsx` | FocusPanel pivot tests. |
| CREATE | `src/frontend/src/__tests__/useStandingOrdersHeartbeat.test.ts` | Polling hook tests. |
| UPDATE | `src/frontend/src/__tests__/OperatorLayout.test.tsx` | e2e composition check. |
| CREATE | `src/backend/tests/agent/test_loop_revise_cap.py` | Reflection-cap pytest. |

---

## Order of Execution

1. Backend reflection-cap (Task 1) — спочатку, бо саме він рятує від quota-burn, поки FE-частина рухається.
2. uiStore (Task 2) — foundation; блокує більшість FE-задач.
3. Шари за залежностями: chrome (3,4), toast (5), tape utility+component (6,7), heartbeat hook (8), roster (9), focus (10).
4. Чомні-зони існуючих компонентів (11,12,13).
5. OperatorLayout rewrite (14) — мерж усього.
6. Інші layout’и (15).
7. Smoke + e2e (16).

Кожна задача → один atomic commit. Зеленило `npx vitest`/`pytest` після кожної.

---

## Task 1: Backend reflection-cap

**Why:** Поточний `agent/loop.py:419` при verdict `revise_strategy` йде в `_ensure_strategic_plan` → reflect → revise → нескінченно. Кошмар з 2026-05-11 спалив ~30 LLM-викликів за хвилину. Cap зупиняє після 5 поспіль на тому ж step_idx.

**Files:**
- Modify: `src/backend/agent/loop.py` (вставка у блок `if ref.verdict == "revise_strategy"`, поточно ~line 419 і ~line 458 — є два сайти)
- Create: `src/backend/tests/agent/test_loop_revise_cap.py`

**Pre-check (read before coding):**
- `src/backend/agent/loop.py` блок навколо `if ref.verdict == "revise_strategy":` (line 419 і line 458, обидва треба).
- `src/backend/agent/runtime.py` — переконатися, що `agent_runtime.pause(task_id, reason=...)` існує і допускає custom reason.

- [ ] **Step 1: Подивитись runtime.pause()**

```bash
grep -n "async def pause" src/backend/agent/runtime.py | head -3
```

Очікувано: знайдеш `async def pause(self, task_id: str, *, reason: str | None = None)` або подібне. Якщо параметр reason не існує — задача 1.1 (нижче) додає його.

- [ ] **Step 1.1 (CONDITIONAL — лише якщо `runtime.pause` без `reason`):**

Розшир сигнатуру `agent_runtime.pause(task_id, *, reason=None)`, прокинь `reason` далі в `update_task_status / state.paused_reason`. Поправ існуючі виклики (вони мають передавати `reason=None` за замовчуванням → змін немає у викликах). Запусти `pytest src/backend/tests/agent/ -x` — має лишитись зелене.

- [ ] **Step 2: Створити failing test**

`src/backend/tests/agent/test_loop_revise_cap.py`:

```python
"""Reflection-cap guard — auto-pause when revise_strategy repeats."""
from __future__ import annotations

import pytest

from agent.loop import RevisionLoopGuard


def test_increments_on_same_step_same_verdict():
    g = RevisionLoopGuard()
    assert g.observe(step_idx=0, verdict="revise_strategy") == 1
    assert g.observe(step_idx=0, verdict="revise_strategy") == 2
    assert g.observe(step_idx=0, verdict="revise_strategy") == 3


def test_resets_on_different_verdict():
    g = RevisionLoopGuard()
    g.observe(step_idx=0, verdict="revise_strategy")
    g.observe(step_idx=0, verdict="revise_strategy")
    assert g.observe(step_idx=0, verdict="continue") == 0
    assert g.observe(step_idx=0, verdict="revise_strategy") == 1


def test_resets_on_different_step():
    g = RevisionLoopGuard()
    g.observe(step_idx=0, verdict="revise_strategy")
    g.observe(step_idx=0, verdict="revise_strategy")
    assert g.observe(step_idx=1, verdict="revise_strategy") == 1


def test_should_pause_threshold_5():
    g = RevisionLoopGuard(threshold=5)
    for _ in range(4):
        assert not g.should_pause(g.observe(step_idx=0, verdict="revise_strategy"))
    n = g.observe(step_idx=0, verdict="revise_strategy")
    assert g.should_pause(n) is True
```

Запусти: `cd src/backend && pytest tests/agent/test_loop_revise_cap.py -v`
Очікувано: FAIL з `ImportError: cannot import name 'RevisionLoopGuard'`.

- [ ] **Step 3: Імплементувати RevisionLoopGuard у `src/backend/agent/loop.py`**

На початку файлу (після імпортів):

```python
class RevisionLoopGuard:
    """Per-task counter that detects identical revise_strategy verdicts on
    the same step_idx. Used by the main loop to auto-pause a task that
    cannot make forward progress (commonly: provider returns 400 on every
    tool call, reflector keeps recommending revise_strategy)."""

    def __init__(self, threshold: int = 5) -> None:
        self.threshold = threshold
        self._count = 0
        self._last_step: int | None = None
        self._last_verdict: str | None = None

    def observe(self, *, step_idx: int, verdict: str) -> int:
        """Record a verdict. Returns current consecutive-count (0 if reset)."""
        if (
            verdict == "revise_strategy"
            and step_idx == self._last_step
            and verdict == self._last_verdict
        ):
            self._count += 1
        elif verdict == "revise_strategy":
            self._count = 1
        else:
            self._count = 0
        self._last_step = step_idx
        self._last_verdict = verdict
        return self._count

    def should_pause(self, count: int) -> bool:
        return count >= self.threshold

    def reset(self) -> None:
        self._count = 0
        self._last_step = None
        self._last_verdict = None
```

Запусти знову: `cd src/backend && pytest tests/agent/test_loop_revise_cap.py -v`
Очікувано: 4 passed.

- [ ] **Step 4: Підключити guard у головну петлю**

У `src/backend/agent/loop.py`, у класі що тримає `state` головну loop-функцію (зараз `_agent_loop` приблизно), створи інстанс guard перед циклом:

```python
revise_guard = RevisionLoopGuard(threshold=5)
```

Потім у ДВОХ місцях де `if ref.verdict == "revise_strategy":` (line 419 та line 458 — обидва треба):

ПЕРЕД викликом `await _ensure_strategic_plan(...)` вставити:

```python
count = revise_guard.observe(step_idx=actions_in_subgoal, verdict=ref.verdict)
if revise_guard.should_pause(count):
    logger.warning(
        "agent.loop: auto-pause after %d consecutive revise_strategy "
        "at step %d for task %s — likely provider error loop",
        count, actions_in_subgoal, state.id,
    )
    await runtime.pause(state.id, reason="auto_reflect_loop")
    await runtime._broadcast(
        "task.paused",
        {"task_id": state.id, "reason": "auto_reflect_loop", "count": count},
    )
    return
```

ТАКОЖ після успішного advance до іншого `verdict` (e.g. `continue`, `revise_subgoal`) — guard зробить reset автоматично через `observe`, бо verdict ≠ revise_strategy. Не треба окремих викликів.

- [ ] **Step 5: Запустити повний backend test suite**

```bash
cd src/backend && pytest tests/agent/ -x -q
```

Очікувано: усе зелене (новий test_loop_revise_cap.py: 4 passed + інше без регресій).

- [ ] **Step 6: Commit**

```bash
git add src/backend/agent/loop.py src/backend/tests/agent/test_loop_revise_cap.py
git commit -m "$(cat <<'EOF'
fix(agent): auto-pause on consecutive revise_strategy loop

RevisionLoopGuard observes (step_idx, verdict) pairs. After 5 identical
revise_strategy verdicts on the same step the loop pauses the task with
paused_reason='auto_reflect_loop' instead of continuing to burn LLM
quota.

Real-world trigger: gemini-2.5-pro responding 400 INVALID_ARGUMENT to
the agent's tool-call schema, reflector keeps recommending strategy
revision, original 22+ identical reflections in 2 minutes before
operator intervention.

This is a quota-burn safety net, NOT the root-cause fix for the Pro 2.5
tool-schema mismatch (separate ticket).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 2: Extend `useUIStore` — focusedAgent, toasts, chrome state

**Files:**
- Modify: `src/frontend/src/stores/uiStore.ts`
- Create: `src/frontend/src/__tests__/uiStore.test.ts`

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/uiStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../stores/uiStore';

describe('useUIStore — v3 extensions', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({
      focusedAgent: 'foreground',
      toasts: [],
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
  });

  it('focusedAgent defaults to "foreground"', () => {
    expect(useUIStore.getState().focusedAgent).toBe('foreground');
  });

  it('setFocusedAgent updates store', () => {
    useUIStore.getState().setFocusedAgent('background');
    expect(useUIStore.getState().focusedAgent).toBe('background');
  });

  it('toast() appends with auto-generated id', () => {
    useUIStore.getState().toast({ kind: 'error', message: 'boom' });
    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'error', message: 'boom' });
    expect(toasts[0].id).toBeTypeOf('string');
  });

  it('dismissToast removes by id', () => {
    useUIStore.getState().toast({ kind: 'info', message: 'hi' });
    const id = useUIStore.getState().toasts[0].id;
    useUIStore.getState().dismissToast(id);
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it('setChromeCollapsed flips single key', () => {
    useUIStore.getState().setChromeCollapsed('hud', false);
    expect(useUIStore.getState().chrome.hud).toBe(false);
    expect(useUIStore.getState().chrome.toolbar).toBe(true);
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/uiStore.test.ts`
Очікувано: FAIL (focusedAgent/toast/chrome не існують).

- [ ] **Step 2: Розширити `uiStore.ts`**

Відкрий `src/frontend/src/stores/uiStore.ts`. У `interface UIStoreState` (line 70) додай:

```ts
export type FocusedAgent =
  | 'foreground'
  | 'background'
  | 'standing_orders'
  | 'proactive'
  | 'council';

export type ToastKind = 'error' | 'warn' | 'info' | 'success';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  ts: number;
}

export type ChromeKey = 'statusBar' | 'roster' | 'hud' | 'toolbar';

export interface ChromeState {
  statusBar: boolean;  // true = compact
  roster:    boolean;  // true = compact
  hud:       boolean;  // true = collapsed
  toolbar:   boolean;  // true = collapsed
}
```

У `interface UIStoreState` додай поля та методи:

```ts
  focusedAgent: FocusedAgent;
  setFocusedAgent: (a: FocusedAgent) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, 'id' | 'ts'>) => string;
  dismissToast: (id: string) => void;

  chrome: ChromeState;
  setChromeCollapsed: (key: ChromeKey, collapsed: boolean) => void;
  toggleChrome: (key: ChromeKey) => void;
```

У `create<UIStoreState>(...)` (line 203) додай initial state і дії:

```ts
  focusedAgent: 'foreground',
  setFocusedAgent: (a) => set({ focusedAgent: a }),

  toasts: [],
  toast: (t) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id, ts: Date.now() }] }));
    return id;
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),

  chrome: loadChromePersisted(),
  setChromeCollapsed: (key, collapsed) =>
    set((s) => {
      const next = { ...s.chrome, [key]: collapsed };
      persistChrome(next);
      return { chrome: next };
    }),
  toggleChrome: (key) =>
    set((s) => {
      const next = { ...s.chrome, [key]: !s.chrome[key] };
      persistChrome(next);
      return { chrome: next };
    }),
```

На початок файлу (після імпортів) додай persist helpers:

```ts
const CHROME_KEY = 'phantom.chrome.v1';
const CHROME_DEFAULT: ChromeState = {
  statusBar: true, roster: true, hud: true, toolbar: true,
};

function loadChromePersisted(): ChromeState {
  if (typeof localStorage === 'undefined') return CHROME_DEFAULT;
  try {
    const raw = localStorage.getItem(CHROME_KEY);
    if (!raw) return CHROME_DEFAULT;
    const parsed = JSON.parse(raw);
    return { ...CHROME_DEFAULT, ...parsed };
  } catch {
    return CHROME_DEFAULT;
  }
}

function persistChrome(state: ChromeState): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(CHROME_KEY, JSON.stringify(state)); } catch {}
}
```

- [ ] **Step 3: Run test green**

```bash
cd src/frontend && npx vitest run src/__tests__/uiStore.test.ts
```

Очікувано: 5 passed.

- [ ] **Step 4: Run full frontend test suite — check no regressions**

```bash
cd src/frontend && npx vitest run
```

Очікувано: усе зелене.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/stores/uiStore.ts src/frontend/src/__tests__/uiStore.test.ts
git commit -m "feat(ui-store): focusedAgent, toasts, chrome collapse state

Foundation for OperatorLayout v3:
- focusedAgent selector (foreground|background|standing_orders|proactive|council)
- toast() / dismissToast() API
- chrome state persisted to localStorage phantom.chrome.v1

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3: `useChromeCollapse` hook

**Files:**
- Create: `src/frontend/src/hooks/useChromeCollapse.ts`
- Create: `src/frontend/src/__tests__/useChromeCollapse.test.ts`

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/useChromeCollapse.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChromeCollapse } from '../hooks/useChromeCollapse';
import { useUIStore } from '../stores/uiStore';

describe('useChromeCollapse', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
  });

  it('returns current collapsed state', () => {
    const { result } = renderHook(() => useChromeCollapse('hud'));
    expect(result.current[0]).toBe(true);
  });

  it('toggles collapsed flag', () => {
    const { result } = renderHook(() => useChromeCollapse('hud'));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
  });

  it('does not affect other keys', () => {
    const { result: hud } = renderHook(() => useChromeCollapse('hud'));
    const { result: tb } = renderHook(() => useChromeCollapse('toolbar'));
    act(() => hud.current[1]());
    expect(hud.current[0]).toBe(false);
    expect(tb.current[0]).toBe(true);
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/useChromeCollapse.test.ts`
Очікувано: FAIL (hook не існує).

- [ ] **Step 2: Імплементувати hook**

`src/frontend/src/hooks/useChromeCollapse.ts`:

```ts
/**
 * useChromeCollapse — спільний hook для chrome-elements
 * (StatusBar, Roster, HUD, FloatingToolbar) які можуть бути compact
 * або full. Стан персистується в localStorage через useUIStore.
 */
import { useCallback } from 'react';
import { useUIStore, type ChromeKey } from '../stores/uiStore';

export function useChromeCollapse(key: ChromeKey): [boolean, () => void] {
  const collapsed = useUIStore((s) => s.chrome[key]);
  const toggleChrome = useUIStore((s) => s.toggleChrome);
  const toggle = useCallback(() => toggleChrome(key), [toggleChrome, key]);
  return [collapsed, toggle];
}
```

- [ ] **Step 3: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/useChromeCollapse.test.ts
```

Очікувано: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/hooks/useChromeCollapse.ts src/frontend/src/__tests__/useChromeCollapse.test.ts
git commit -m "feat(chrome): useChromeCollapse hook over uiStore.chrome

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 4: `ChromeHandle` component

**Files:**
- Create: `src/frontend/src/components/core/ChromeHandle.tsx`
- Create: `src/frontend/src/__tests__/ChromeHandle.test.tsx`

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/ChromeHandle.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ChromeHandle } from '../components/core/ChromeHandle';

describe('ChromeHandle', () => {
  it('renders chevron-down when collapsed=true (top position)', () => {
    const { container } = render(
      <ChromeHandle position="top" collapsed={true} onToggle={() => {}} label="StatusBar" />
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-expanded')).toBe('false');
  });

  it('fires onToggle on click', () => {
    const cb = vi.fn();
    const { container } = render(
      <ChromeHandle position="top" collapsed={false} onToggle={cb} label="HUD" />
    );
    fireEvent.click(container.querySelector('button')!);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('aria-label includes Розгорнути when collapsed', () => {
    const { container } = render(
      <ChromeHandle position="top" collapsed={true} onToggle={() => {}} label="Roster" />
    );
    expect(container.querySelector('button')?.getAttribute('aria-label')).toMatch(/Розгорнути/);
  });

  it('aria-label includes Згорнути when expanded', () => {
    const { container } = render(
      <ChromeHandle position="bottom" collapsed={false} onToggle={() => {}} label="Toolbar" />
    );
    expect(container.querySelector('button')?.getAttribute('aria-label')).toMatch(/Згорнути/);
  });

  it('has min 44px touch target via padding', () => {
    const { container } = render(
      <ChromeHandle position="top" collapsed={true} onToggle={() => {}} label="x" />
    );
    const btn = container.querySelector('button')! as HTMLElement;
    const style = btn.style;
    expect(parseInt(style.minWidth)).toBeGreaterThanOrEqual(44);
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/ChromeHandle.test.tsx`
Очікувано: FAIL.

- [ ] **Step 2: Імплементувати компонент**

`src/frontend/src/components/core/ChromeHandle.tsx`:

```tsx
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  position: 'top' | 'bottom';
  collapsed: boolean;
  onToggle: () => void;
  label: string;
}

export function ChromeHandle({ position, collapsed, onToggle, label }: Props) {
  // Top-mounted chrome: collapsed = "compact" → chevron down (expand to full).
  // Bottom-mounted chrome: collapsed = "hidden behind handle" → chevron up.
  const showChevronDown =
    (position === 'top' && collapsed) || (position === 'bottom' && !collapsed);
  const Icon = showChevronDown ? ChevronDown : ChevronUp;
  const aria = collapsed ? `Розгорнути ${label}` : `Згорнути ${label}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={aria}
      aria-expanded={!collapsed}
      style={{
        minWidth: 44,
        minHeight: 24,
        padding: '2px 12px',
        border: 'none',
        background: 'transparent',
        color: 'var(--ink-muted, #8a7f72)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
      }}
      className="hover:bg-black/5 active:scale-95 transition-transform"
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}
```

- [ ] **Step 3: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/ChromeHandle.test.tsx
```

Очікувано: 5 passed.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/components/core/ChromeHandle.tsx src/frontend/src/__tests__/ChromeHandle.test.tsx
git commit -m "feat(chrome): ChromeHandle component (44x24 toggle button)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 5: `ToastRail` component

**Files:**
- Create: `src/frontend/src/components/core/ToastRail.tsx`
- Create: `src/frontend/src/__tests__/ToastRail.test.tsx`

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/ToastRail.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ToastRail } from '../components/core/ToastRail';
import { useUIStore } from '../stores/uiStore';

describe('ToastRail', () => {
  beforeEach(() => {
    useUIStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing when no toasts', () => {
    const { container } = render(<ToastRail />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders toast with role=alert', () => {
    act(() => {
      useUIStore.getState().toast({ kind: 'error', message: 'boom' });
    });
    const { container } = render(<ToastRail />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('boom');
  });

  it('auto-dismisses after 3s for non-error toasts', () => {
    act(() => {
      useUIStore.getState().toast({ kind: 'info', message: 'hi' });
    });
    expect(useUIStore.getState().toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(3001));
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it('error toasts persist 5s', () => {
    act(() => {
      useUIStore.getState().toast({ kind: 'error', message: 'fail' });
    });
    act(() => vi.advanceTimersByTime(3001));
    expect(useUIStore.getState().toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(2001));
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/ToastRail.test.tsx`
Очікувано: FAIL.

- [ ] **Step 2: Імплементувати**

`src/frontend/src/components/core/ToastRail.tsx`:

```tsx
import { useEffect } from 'react';
import { useUIStore, type Toast } from '../../stores/uiStore';

const KIND_COLOR: Record<Toast['kind'], string> = {
  error:   'var(--signal-alert, #ef4444)',
  warn:    'var(--signal-warn, #f59e0b)',
  info:    'var(--primary, #f4af25)',
  success: 'var(--signal-ok, #16a34a)',
};

const KIND_TTL_MS: Record<Toast['kind'], number> = {
  error:   5000,
  warn:    4000,
  info:    3000,
  success: 3000,
};

export function ToastRail() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), KIND_TTL_MS[t.kind] ?? 3000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 84,
        left: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 80,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          onClick={() => {
            try { navigator.clipboard?.writeText(t.message); } catch {}
            dismiss(t.id);
          }}
          style={{
            pointerEvents: 'auto',
            padding: '8px 12px',
            borderRadius: 10,
            background: 'var(--glass-elevated, rgba(255,255,255,0.92))',
            border: `1px solid ${KIND_COLOR[t.kind]}`,
            color: 'var(--ink-primary, #2a241d)',
            fontSize: 13,
            fontFamily: 'var(--font-mono, monospace)',
            cursor: 'pointer',
            boxShadow: '0 8px 18px rgba(0,0,0,0.15)',
          }}
        >
          <strong style={{ color: KIND_COLOR[t.kind], marginRight: 8, textTransform: 'uppercase', fontSize: 10 }}>
            {t.kind}
          </strong>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/ToastRail.test.tsx
```

Очікувано: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/components/core/ToastRail.tsx src/frontend/src/__tests__/ToastRail.test.tsx
git commit -m "feat(chrome): ToastRail global toast container (auto-dismiss + clipboard)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 6: `tape-utils.ts` — `collapseRepeats` + `Tape` component

**Files:**
- Create: `src/frontend/src/components/agent/tape-utils.ts`
- Create: `src/frontend/src/components/agent/Tape.tsx`
- Create: `src/frontend/src/__tests__/tape-utils.test.ts`
- Create: `src/frontend/src/__tests__/Tape.test.tsx`

- [ ] **Step 1: Failing utility test**

`src/frontend/src/__tests__/tape-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collapseRepeats, type TapeRow } from '../components/agent/tape-utils';

const mk = (over: Partial<TapeRow> = {}): TapeRow => ({
  id: 'x', kind: 'reflection', verdict: 'revise_strategy',
  step_idx: 0, action: null, label: 'rv', ts: '2026-05-11T21:00:00Z',
  ...over,
});

describe('collapseRepeats', () => {
  it('returns empty for empty input', () => {
    expect(collapseRepeats([])).toEqual([]);
  });

  it('does not collapse a single row', () => {
    const out = collapseRepeats([mk()]);
    expect(out).toHaveLength(1);
    expect(out[0].repeats).toBe(1);
  });

  it('collapses 10 identical rows to one with repeats=10', () => {
    const inp = Array.from({ length: 10 }, (_, i) => mk({ id: `r-${i}` }));
    const out = collapseRepeats(inp);
    expect(out).toHaveLength(1);
    expect(out[0].repeats).toBe(10);
  });

  it('does not collapse different verdicts', () => {
    const a = mk({ id: 'a', verdict: 'revise_strategy' });
    const b = mk({ id: 'b', verdict: 'continue' });
    const c = mk({ id: 'c', verdict: 'revise_strategy' });
    expect(collapseRepeats([a, b, c])).toHaveLength(3);
  });

  it('keeps latest ts when collapsing', () => {
    const a = mk({ id: 'a', ts: '2026-05-11T21:00:00Z' });
    const b = mk({ id: 'b', ts: '2026-05-11T21:01:30Z' });
    const out = collapseRepeats([a, b]);
    expect(out[0].ts).toBe('2026-05-11T21:01:30Z');
    expect(out[0].repeats).toBe(2);
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/tape-utils.test.ts`
Очікувано: FAIL.

- [ ] **Step 2: Імплементувати util**

`src/frontend/src/components/agent/tape-utils.ts`:

```ts
export type TapeKind = 'reflection' | 'action' | 'observation' | 'event';

export interface TapeRow {
  id: string;
  kind: TapeKind;
  verdict?: string | null;
  step_idx?: number | null;
  action?: string | null;
  label: string;
  ts: string;
  repeats?: number;
}

function sameSignature(a: TapeRow, b: TapeRow): boolean {
  return (
    a.kind === b.kind &&
    (a.verdict ?? null) === (b.verdict ?? null) &&
    (a.step_idx ?? null) === (b.step_idx ?? null) &&
    (a.action ?? null) === (b.action ?? null)
  );
}

export function collapseRepeats(items: TapeRow[]): TapeRow[] {
  const out: TapeRow[] = [];
  for (const r of items) {
    const last = out[out.length - 1];
    if (last && sameSignature(last, r)) {
      last.repeats = (last.repeats ?? 1) + 1;
      last.ts = r.ts;
      continue;
    }
    out.push({ ...r, repeats: 1 });
  }
  return out;
}
```

Run: `cd src/frontend && npx vitest run src/__tests__/tape-utils.test.ts`
Очікувано: 5 passed.

- [ ] **Step 3: Failing component test**

`src/frontend/src/__tests__/Tape.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Tape } from '../components/agent/Tape';
import type { TapeRow } from '../components/agent/tape-utils';

const mk = (i: number): TapeRow => ({
  id: `r-${i}`, kind: 'reflection', verdict: 'revise_strategy',
  step_idx: 0, action: null, label: 'rv', ts: '2026-05-11T21:00:00Z',
});

describe('Tape', () => {
  it('renders empty placeholder', () => {
    const { getByText } = render(<Tape rows={[]} />);
    expect(getByText(/Awaiting/i)).toBeTruthy();
  });

  it('collapses 22 identical events into single row with ×22', () => {
    const rows = Array.from({ length: 22 }, (_, i) => mk(i));
    const { container } = render(<Tape rows={rows} />);
    const items = container.querySelectorAll('[data-tape-row]');
    expect(items.length).toBe(1);
    expect(container.textContent).toContain('×22');
  });

  it('renders 3 different verdicts as 3 rows', () => {
    const rows: TapeRow[] = [
      { ...mk(1), verdict: 'continue' },
      { ...mk(2), verdict: 'revise_strategy' },
      { ...mk(3), verdict: 'wait_user' },
    ];
    const { container } = render(<Tape rows={rows} />);
    expect(container.querySelectorAll('[data-tape-row]').length).toBe(3);
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/Tape.test.tsx`
Очікувано: FAIL.

- [ ] **Step 4: Імплементувати Tape**

`src/frontend/src/components/agent/Tape.tsx`:

```tsx
import { useMemo } from 'react';
import { collapseRepeats, type TapeRow } from './tape-utils';

interface Props {
  rows: TapeRow[];
}

function hhmm(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '--:--';
  }
}

export function Tape({ rows }: Props) {
  const collapsed = useMemo(() => collapseRepeats(rows).slice(-40), [rows]);

  if (collapsed.length === 0) {
    return (
      <div className="flex items-center justify-center h-full opacity-30 italic text-[10px] font-mono">
        Awaiting events…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto h-full font-mono text-[10px]">
      {collapsed.map((r) => (
        <div
          key={r.id}
          data-tape-row
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-black/5"
          title={r.label}
        >
          <span className="opacity-50 tabular-nums">{hhmm(r.ts)}</span>
          <span className="flex-1 truncate">{r.label}</span>
          {(r.repeats ?? 1) > 1 && (
            <span
              className="px-1 rounded text-[9px] font-bold"
              style={{
                background: 'var(--primary, #f4af25)',
                color: '#fff',
              }}
            >
              ×{r.repeats}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

Run: `cd src/frontend && npx vitest run src/__tests__/Tape.test.tsx`
Очікувано: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/agent/tape-utils.ts src/frontend/src/components/agent/Tape.tsx src/frontend/src/__tests__/tape-utils.test.ts src/frontend/src/__tests__/Tape.test.tsx
git commit -m "feat(agent-ui): Tape component with collapseRepeats dedup

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 7: `useStandingOrdersHeartbeat` hook

**Files:**
- Create: `src/frontend/src/hooks/useStandingOrdersHeartbeat.ts`
- Create: `src/frontend/src/__tests__/useStandingOrdersHeartbeat.test.ts`

**Pre-check:** GET `/api/v1/agent/standing_orders` повертає список enabled orders (підтверджено в `routes_agent.py:803`).

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/useStandingOrdersHeartbeat.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStandingOrdersHeartbeat } from '../hooks/useStandingOrdersHeartbeat';

const fetchSpy = vi.fn();

vi.mock('../services/api', () => ({
  request: (...args: unknown[]) => fetchSpy(...args),
}));

describe('useStandingOrdersHeartbeat', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('returns enabled count after first poll', async () => {
    fetchSpy.mockResolvedValue({
      orders: [
        { id: 1, enabled: true,  fire_count: 3, last_fired_at: '2026-05-11T20:00:00Z' },
        { id: 2, enabled: false, fire_count: 0, last_fired_at: null },
        { id: 3, enabled: true,  fire_count: 1, last_fired_at: '2026-05-11T21:00:00Z' },
      ],
    });
    const { result } = renderHook(() => useStandingOrdersHeartbeat());
    await waitFor(() => expect(result.current.enabled).toBe(2));
    expect(result.current.lastFireAt).toBe('2026-05-11T21:00:00Z');
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/useStandingOrdersHeartbeat.test.ts`
Очікувано: FAIL.

- [ ] **Step 2: Імплементувати**

`src/frontend/src/hooks/useStandingOrdersHeartbeat.ts`:

```ts
import { useEffect, useState } from 'react';
import { request } from '../services/api';

interface StandingOrderRow {
  id: number;
  enabled: boolean;
  fire_count: number;
  last_fired_at: string | null;
}

interface Heartbeat {
  enabled: number;
  totalFired: number;
  lastFireAt: string | null;
}

const POLL_MS = 10_000;

export function useStandingOrdersHeartbeat(): Heartbeat {
  const [hb, setHb] = useState<Heartbeat>({
    enabled: 0, totalFired: 0, lastFireAt: null,
  });

  useEffect(() => {
    let active = true;

    async function tick() {
      try {
        const resp = await request<{ orders: StandingOrderRow[] }>(
          'GET', '/agent/standing_orders',
        );
        if (!active) return;
        const orders = resp?.orders ?? [];
        const enabled = orders.filter((o) => o.enabled).length;
        const totalFired = orders.reduce((s, o) => s + (o.fire_count ?? 0), 0);
        const lastFireAt = orders
          .map((o) => o.last_fired_at)
          .filter((x): x is string => !!x)
          .sort()
          .pop() ?? null;
        setHb({ enabled, totalFired, lastFireAt });
      } catch {
        /* swallow — heartbeat is best-effort */
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  return hb;
}
```

Run: `cd src/frontend && npx vitest run src/__tests__/useStandingOrdersHeartbeat.test.ts`
Очікувано: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/hooks/useStandingOrdersHeartbeat.ts src/frontend/src/__tests__/useStandingOrdersHeartbeat.test.ts
git commit -m "feat(agent-ui): useStandingOrdersHeartbeat polling hook (10s)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 8: `AgentRoster` component

**Files:**
- Create: `src/frontend/src/components/agent/AgentRoster.tsx`
- Create: `src/frontend/src/__tests__/AgentRoster.test.tsx`

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/AgentRoster.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AgentRoster } from '../components/agent/AgentRoster';
import { useUIStore } from '../stores/uiStore';
import { useAgentStore } from '../stores/agentStore';

vi.mock('../hooks/useStandingOrdersHeartbeat', () => ({
  useStandingOrdersHeartbeat: () => ({ enabled: 0, totalFired: 0, lastFireAt: null }),
}));

describe('AgentRoster', () => {
  beforeEach(() => {
    useUIStore.setState({
      focusedAgent: 'foreground',
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
    useAgentStore.setState({
      currentTask: null,
      status: 'idle',
      promotedToBackgroundAt: {},
      proactive: { enabled: true, lastCycleAt: null, hasTriggers: false },
      councilActive: false,
      councilStatements: [],
    });
  });

  it('renders 4 base chips + council indicator', () => {
    const { container } = render(<AgentRoster />);
    expect(container.querySelectorAll('[data-roster-chip]').length).toBe(4);
    expect(container.querySelector('[data-roster-council]')).not.toBeNull();
  });

  it('clicking background chip sets focusedAgent', () => {
    const { container } = render(<AgentRoster />);
    const bg = container.querySelector('[data-roster-chip="background"]') as HTMLElement;
    fireEvent.click(bg);
    expect(useUIStore.getState().focusedAgent).toBe('background');
  });

  it('foreground chip is aria-pressed when active', () => {
    const { container } = render(<AgentRoster />);
    const fg = container.querySelector('[data-roster-chip="foreground"]');
    expect(fg?.getAttribute('aria-pressed')).toBe('true');
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/AgentRoster.test.tsx`
Очікувано: FAIL.

- [ ] **Step 2: Імплементувати**

`src/frontend/src/components/agent/AgentRoster.tsx`:

```tsx
import { useAgentStore } from '../../stores/agentStore';
import { useUIStore, type FocusedAgent } from '../../stores/uiStore';
import { useChromeCollapse } from '../../hooks/useChromeCollapse';
import { useStandingOrdersHeartbeat } from '../../hooks/useStandingOrdersHeartbeat';
import { ChromeHandle } from '../core/ChromeHandle';
import { Activity, Clock, Bot, Scale, Sparkles } from 'lucide-react';

interface ChipProps {
  id: FocusedAgent;
  icon: React.ReactNode;
  label: string;
  sub: string;
  active: boolean;
  compact: boolean;
}

function Chip({ id, icon, label, sub, active, compact }: ChipProps) {
  const setFocusedAgent = useUIStore((s) => s.setFocusedAgent);
  const focused = useUIStore((s) => s.focusedAgent) === id;

  return (
    <button
      data-roster-chip={id}
      aria-pressed={focused}
      onClick={() => setFocusedAgent(id)}
      style={{
        height: compact ? 28 : 36,
        minWidth: compact ? 56 : 168,
        padding: compact ? '0 8px' : '0 12px',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: focused
          ? 'var(--primary, #f4af25)'
          : 'var(--glass-elevated, rgba(255,255,255,0.7))',
        color: focused ? '#fff' : 'var(--ink-primary, #2a241d)',
        border: `1px solid ${focused ? 'transparent' : 'var(--glass-border, rgba(255,255,255,0.55))'}`,
        opacity: active ? 1 : 0.5,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: compact ? 10 : 11,
      }}
    >
      <span style={{ display: 'inline-flex' }}>{icon}</span>
      {!compact && (
        <span className="flex flex-col items-start leading-tight">
          <span className="font-bold tracking-wider uppercase text-[9px]">{label}</span>
          <span className="opacity-70 text-[10px] truncate max-w-[120px]">{sub}</span>
        </span>
      )}
    </button>
  );
}

export function AgentRoster() {
  const status = useAgentStore((s) => s.status);
  const currentTask = useAgentStore((s) => s.currentTask);
  const promotedAt = useAgentStore((s) => s.promotedToBackgroundAt);
  const proactive = useAgentStore((s) => s.proactive);
  const councilActive = useAgentStore((s) => s.councilActive);
  const focusedAgent = useUIStore((s) => s.focusedAgent);
  const setFocusedAgent = useUIStore((s) => s.setFocusedAgent);
  const [compact, toggle] = useChromeCollapse('roster');
  const so = useStandingOrdersHeartbeat();

  const fgActive = !!currentTask && !['idle','done','failed','stopped'].includes(status);
  const bgCount = Object.keys(promotedAt).length;

  return (
    <div
      className="flex items-center gap-2 px-3"
      style={{
        height: compact ? 28 : 36,
        background: 'var(--glass-card, rgba(255,255,255,0.5))',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.5))',
      }}
    >
      <Chip
        id="foreground"
        icon={<Activity size={compact ? 12 : 14} />}
        label="FG"
        sub={currentTask?.task.goal ?? 'idle'}
        active={fgActive}
        compact={compact}
      />
      <Chip
        id="background"
        icon={<Clock size={compact ? 12 : 14} />}
        label="BG"
        sub={bgCount > 0 ? `${bgCount} running` : 'idle'}
        active={bgCount > 0}
        compact={compact}
      />
      <Chip
        id="standing_orders"
        icon={<Bot size={compact ? 12 : 14} />}
        label="SO"
        sub={so.enabled > 0 ? `${so.enabled} · ${so.totalFired} fired` : 'none'}
        active={so.enabled > 0}
        compact={compact}
      />
      <Chip
        id="proactive"
        icon={<Sparkles size={compact ? 12 : 14} />}
        label="PRO"
        sub={proactive.enabled ? 'active' : 'off'}
        active={proactive.enabled}
        compact={compact}
      />
      <button
        data-roster-council
        aria-pressed={focusedAgent === 'council'}
        onClick={() => setFocusedAgent('council')}
        style={{
          width: 28, height: 28, borderRadius: 10,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: councilActive
            ? 'var(--primary, #f4af25)'
            : 'transparent',
          color: councilActive ? '#fff' : 'var(--ink-muted, #8a7f72)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
          marginLeft: 'auto',
          cursor: 'pointer',
        }}
        title="Council"
      >
        <Scale size={14} />
      </button>
      <ChromeHandle position="top" collapsed={compact} onToggle={toggle} label="Roster" />
    </div>
  );
}
```

- [ ] **Step 3: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/AgentRoster.test.tsx
```

Очікувано: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/components/agent/AgentRoster.tsx src/frontend/src/__tests__/AgentRoster.test.tsx
git commit -m "feat(agent-ui): AgentRoster — 4 agents + council chip + chrome compact

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 9: `FocusPanel` component

**Files:**
- Create: `src/frontend/src/components/agent/FocusPanel.tsx`
- Create: `src/frontend/src/__tests__/FocusPanel.test.tsx`

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/FocusPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FocusPanel } from '../components/agent/FocusPanel';
import { useUIStore } from '../stores/uiStore';
import { useAgentStore } from '../stores/agentStore';

vi.mock('../hooks/useStandingOrdersHeartbeat', () => ({
  useStandingOrdersHeartbeat: () => ({ enabled: 2, totalFired: 5, lastFireAt: '2026-05-11T21:00:00Z' }),
}));

describe('FocusPanel', () => {
  beforeEach(() => {
    useUIStore.setState({ focusedAgent: 'foreground' });
    useAgentStore.setState({
      currentTask: null,
      subGoals: [],
      recentActions: [],
      reflections: [],
      thoughtBudget: { estimated_actions: 4, actions_used: 0, force_reflect_ratio: 2, reflections_done: 0 },
      llmCallsUsed: 0,
      llmCallsCap: 30,
      progressByTaskId: {},
      bgTaskGoals: {},
      promotedToBackgroundAt: {},
      proactive: { enabled: true, lastCycleAt: '2026-05-11T21:00:00Z', hasTriggers: false },
    });
  });

  it('foreground view shows goal when task active', () => {
    useAgentStore.setState({
      currentTask: { task: { id: 't1', goal: 'greet protocol', status: 'running' }, sub_goals: [], observations: [] } as never,
    });
    const { getByText } = render(<FocusPanel />);
    expect(getByText(/greet protocol/i)).toBeTruthy();
  });

  it('standing_orders view shows enabled count', () => {
    useUIStore.setState({ focusedAgent: 'standing_orders' });
    const { getByText } = render(<FocusPanel />);
    expect(getByText(/2 enabled/i)).toBeTruthy();
  });

  it('proactive view shows last cycle time', () => {
    useUIStore.setState({ focusedAgent: 'proactive' });
    const { getByText } = render(<FocusPanel />);
    expect(getByText(/last cycle/i)).toBeTruthy();
  });

  it('background view shows "no background tasks" when empty', () => {
    useUIStore.setState({ focusedAgent: 'background' });
    const { getByText } = render(<FocusPanel />);
    expect(getByText(/no background tasks/i)).toBeTruthy();
  });
});
```

Запусти: `cd src/frontend && npx vitest run src/__tests__/FocusPanel.test.tsx`
Очікувано: FAIL.

- [ ] **Step 2: Імплементувати**

`src/frontend/src/components/agent/FocusPanel.tsx`:

```tsx
import { useMemo } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useUIStore } from '../../stores/uiStore';
import { useStandingOrdersHeartbeat } from '../../hooks/useStandingOrdersHeartbeat';

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function NowRow() {
  const tb = useAgentStore((s) => s.thoughtBudget);
  const used = useAgentStore((s) => s.llmCallsUsed);
  const cap = useAgentStore((s) => s.llmCallsCap);
  return (
    <div className="flex items-center gap-4 px-2 py-1 border-t border-black/5 text-[10px] font-mono uppercase tracking-wider opacity-70">
      <span>STEPS {tb.actions_used}/{Math.max(tb.estimated_actions, tb.actions_used)}</span>
      <span>AI {used}/{cap}</span>
      <span>REFLECTIONS {tb.reflections_done}</span>
    </div>
  );
}

function ForegroundView() {
  const currentTask = useAgentStore((s) => s.currentTask);
  const subGoals = useAgentStore((s) => s.subGoals);
  const reflections = useAgentStore((s) => s.reflections);
  const lastReflection = reflections[reflections.length - 1];

  if (!currentTask) {
    return (
      <div className="flex-1 flex items-center justify-center opacity-40 italic font-mono text-xs">
        No active foreground task. Type a goal in the HUD below.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-2 py-1.5">
        <div className="text-[9px] font-mono uppercase tracking-wider opacity-50">Goal</div>
        <div className="font-serif italic text-sm truncate">{currentTask.task.goal}</div>
      </div>
      {lastReflection && (
        <div className="px-2 py-1 border-y border-black/5 bg-white/30 text-[11px] font-mono">
          <span className="font-bold opacity-70">{lastReflection.verdict}</span>
          {' · '}
          <span className="opacity-60">{lastReflection.summary?.slice(0, 200)}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 flex flex-col gap-1">
        {subGoals.map((sg) => (
          <div
            key={sg.id}
            className="flex items-center gap-2 py-1 text-[12px]"
            style={{ opacity: sg.status === 'done' ? 0.5 : 1 }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                background:
                  sg.status === 'active' ? 'var(--primary)' :
                  sg.status === 'done'   ? 'var(--signal-ok)' :
                  sg.status === 'failed' ? 'var(--signal-alert)' :
                                            'rgba(0,0,0,0.2)',
              }}
            />
            <span className="flex-1">{sg.description}</span>
          </div>
        ))}
      </div>
      <NowRow />
    </div>
  );
}

function BackgroundView() {
  const promotedAt = useAgentStore((s) => s.promotedToBackgroundAt);
  const bgGoals = useAgentStore((s) => s.bgTaskGoals);
  const ids = Object.keys(promotedAt);
  if (ids.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center opacity-40 italic font-mono text-xs">
        No background tasks running.
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col gap-2 p-2">
      {ids.map((tid) => (
        <div key={tid} className="px-3 py-2 rounded-lg bg-white/40 border border-white/50">
          <div className="text-[9px] uppercase tracking-wider opacity-50 font-mono">Background · {tid.slice(0, 8)}</div>
          <div className="font-serif italic">{bgGoals[tid] ?? tid}</div>
        </div>
      ))}
    </div>
  );
}

function StandingOrdersView() {
  const so = useStandingOrdersHeartbeat();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 font-mono text-xs">
      <div className="text-lg font-bold">{so.enabled} enabled</div>
      <div className="opacity-60">{so.totalFired} fires total</div>
      <div className="opacity-50 text-[10px]">last fired: {timeAgo(so.lastFireAt)}</div>
    </div>
  );
}

function ProactiveView() {
  const p = useAgentStore((s) => s.proactive);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 font-mono text-xs">
      <div className="text-lg font-bold">{p.enabled ? 'ACTIVE' : 'OFF'}</div>
      <div className="opacity-60">last cycle: {timeAgo(p.lastCycleAt)}</div>
      <div className="opacity-50 text-[10px]">{p.hasTriggers ? 'has triggers' : 'no triggers'}</div>
    </div>
  );
}

function CouncilView() {
  const active = useAgentStore((s) => s.councilActive);
  const statements = useAgentStore((s) => s.councilStatements);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 font-mono text-xs">
      <div className="text-lg font-bold">{active ? 'IN SESSION' : 'IDLE'}</div>
      <div className="opacity-60">{statements.length} statements</div>
      <div className="opacity-40 text-[10px] italic max-w-xs text-center">
        Council deliberations open in modal when triggered by the orchestrator or invoked via roster.
      </div>
    </div>
  );
}

export function FocusPanel() {
  const focused = useUIStore((s) => s.focusedAgent);
  const view = useMemo(() => {
    switch (focused) {
      case 'background':       return <BackgroundView />;
      case 'standing_orders':  return <StandingOrdersView />;
      case 'proactive':        return <ProactiveView />;
      case 'council':          return <CouncilView />;
      case 'foreground':
      default:                 return <ForegroundView />;
    }
  }, [focused]);

  return (
    <section
      className="flex flex-col min-h-0 rounded-2xl"
      style={{
        background: 'var(--glass-card, rgba(255,255,255,0.4))',
        border: '1px solid var(--glass-border, rgba(255,255,255,0.5))',
        backdropFilter: 'blur(8px)',
      }}
    >
      {view}
    </section>
  );
}
```

- [ ] **Step 3: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/FocusPanel.test.tsx
```

Очікувано: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/components/agent/FocusPanel.tsx src/frontend/src/__tests__/FocusPanel.test.tsx
git commit -m "feat(agent-ui): FocusPanel — 5-pivot view (fg/bg/so/proactive/council)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 10: StatusBar compact mode + handle

**Files:**
- Modify: `src/frontend/src/components/core/StatusBar.tsx`

**Pre-check:** Read full `StatusBar.tsx` before editing. Не зчитуй уявно — глянь розмір і існуючий props-shape.

- [ ] **Step 1: Read StatusBar.tsx**

```bash
wc -l src/frontend/src/components/core/StatusBar.tsx
head -40 src/frontend/src/components/core/StatusBar.tsx
```

- [ ] **Step 2: Failing test (update існуючого `StatusBar.test.tsx`)**

Додай у кінець `src/frontend/src/__tests__/StatusBar.test.tsx`:

```tsx
import { useUIStore } from '../stores/uiStore';

describe('StatusBar — chrome compact mode', () => {
  it('renders compact (24px height) when chrome.statusBar=true', () => {
    useUIStore.setState({
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
    const { container } = render(<StatusBar />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.height || root.offsetHeight).toBeTruthy();
    // Compact-режим прибирає текстові підписи групи sensors
    expect(container.querySelector('[data-statusbar-labels]')).toBeNull();
  });

  it('renders full (36px) and shows labels when chrome.statusBar=false', () => {
    useUIStore.setState({
      chrome: { statusBar: false, roster: true, hud: true, toolbar: true },
    });
    const { container } = render(<StatusBar />);
    expect(container.querySelector('[data-statusbar-labels]')).not.toBeNull();
  });

  it('has chrome handle button', () => {
    const { container } = render(<StatusBar />);
    expect(container.querySelector('[aria-label*="StatusBar"]')).not.toBeNull();
  });
});
```

Запусти: FAIL.

- [ ] **Step 3: Імплементувати compact mode**

У `StatusBar.tsx`:
- Імпортувати `useChromeCollapse` + `ChromeHandle`.
- На початку компонента: `const [compact, toggle] = useChromeCollapse('statusBar');`
- Висота: `height: compact ? 24 : 36`.
- Розмітку розділити: статичні pulse-dots завжди, текстові групи (labels) обгорнути `{!compact && <span data-statusbar-labels>…</span>}`.
- В кінці бару додати: `<ChromeHandle position="top" collapsed={compact} onToggle={toggle} label="StatusBar" />`.

(Зчитай реальний layout — exact JSX залежить від поточного коду. Зміна не повинна ламати інші ассерти існуючого тесту.)

- [ ] **Step 4: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/StatusBar.test.tsx
```

Очікувано: всі passed.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/core/StatusBar.tsx src/frontend/src/__tests__/StatusBar.test.tsx
git commit -m "feat(chrome): StatusBar compact mode (24px) with ChromeHandle

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 11: FloatingToolbar collapsed mode + handle

**Files:**
- Modify: `src/frontend/src/components/core/FloatingToolbar.tsx`

**Pre-check:** Read існуючий FloatingToolbar; зрозумій його overlay-trigger logic.

- [ ] **Step 1: Read**

```bash
wc -l src/frontend/src/components/core/FloatingToolbar.tsx
sed -n '1,80p' src/frontend/src/components/core/FloatingToolbar.tsx
```

- [ ] **Step 2: Failing test**

Створи (або поправ існуючий) `src/frontend/src/__tests__/FloatingToolbar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FloatingToolbar } from '../components/core/FloatingToolbar';
import { useUIStore } from '../stores/uiStore';

describe('FloatingToolbar — chrome collapsed mode', () => {
  beforeEach(() => {
    useUIStore.setState({
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
  });

  it('renders only handle when collapsed', () => {
    const { container } = render(<FloatingToolbar />);
    expect(container.querySelector('[data-toolbar-buttons]')).toBeNull();
    expect(container.querySelector('[aria-label*="FloatingToolbar"]')).not.toBeNull();
  });

  it('toggle expands buttons', () => {
    const { container } = render(<FloatingToolbar />);
    const handle = container.querySelector('[aria-label*="FloatingToolbar"]') as HTMLElement;
    fireEvent.click(handle);
    expect(container.querySelector('[data-toolbar-buttons]')).not.toBeNull();
  });
});
```

Запусти: FAIL.

- [ ] **Step 3: Імплементувати**

У `FloatingToolbar.tsx`:
- Імпортувати `useChromeCollapse('toolbar')` + `ChromeHandle`.
- Якщо `collapsed === true` — рендеримо тільки 12px-вищий handle bar (position fixed bottom 0).
- Якщо `!collapsed` — повний рядок кнопок, обгорнутий у `<div data-toolbar-buttons>`.
- `<ChromeHandle position="bottom" collapsed={collapsed} onToggle={toggle} label="FloatingToolbar" />` поверх або зліва.

- [ ] **Step 4: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/FloatingToolbar.test.tsx
```

Очікувано: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/core/FloatingToolbar.tsx src/frontend/src/__tests__/FloatingToolbar.test.tsx
git commit -m "feat(chrome): FloatingToolbar collapsed mode (12px handle bar)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 12: `AgentCommandCenter` — error toast, collapsed mode, auto-policies

**Files:**
- Modify: `src/frontend/src/components/agent/AgentCommandCenter.tsx`
- Create: `src/frontend/src/__tests__/AgentCommandCenter.test.tsx` (новий)

- [ ] **Step 1: Failing test**

`src/frontend/src/__tests__/AgentCommandCenter.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { AgentCommandCenter } from '../components/agent/AgentCommandCenter';
import { useUIStore } from '../stores/uiStore';
import { useAgentStore } from '../stores/agentStore';

const startTaskMock = vi.fn();

vi.mock('../stores/agentStore', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return real;
});

describe('AgentCommandCenter', () => {
  beforeEach(() => {
    startTaskMock.mockReset();
    useUIStore.setState({
      toasts: [],
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
    useAgentStore.setState({
      status: 'idle',
      currentTask: null,
      emotion: null,
      quotaBackoff: null,
      startTask: startTaskMock,
      pauseTask: vi.fn(),
      resumeTask: vi.fn(),
      stopTask: vi.fn(),
      cancelStep: vi.fn(),
    } as never);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('renders 12px handle when hud collapsed', () => {
    const { container } = render(
      <AgentCommandCenter onIntervene={() => {}} onOpenVault={() => {}} onOpenParallelChat={() => {}} />
    );
    expect(container.querySelector('[data-hud-collapsed-handle]')).not.toBeNull();
    expect(container.querySelector('[data-hud-textarea]')).toBeNull();
  });

  it('expands HUD on toggle', () => {
    const { container } = render(
      <AgentCommandCenter onIntervene={() => {}} onOpenVault={() => {}} onOpenParallelChat={() => {}} />
    );
    fireEvent.click(container.querySelector('[data-hud-collapsed-handle]')!);
    expect(container.querySelector('[data-hud-textarea]')).not.toBeNull();
  });

  it('failed startTask publishes error toast', async () => {
    useUIStore.setState({ chrome: { statusBar: true, roster: true, hud: false, toolbar: true } });
    startTaskMock.mockRejectedValue(new Error('boom'));
    const { container } = render(
      <AgentCommandCenter onIntervene={() => {}} onOpenVault={() => {}} onOpenParallelChat={() => {}} />
    );
    const ta = container.querySelector('[data-hud-textarea]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'go' } });
    const send = container.querySelector('[data-hud-run]') as HTMLButtonElement;
    fireEvent.click(send);
    await waitFor(() => {
      expect(useUIStore.getState().toasts.length).toBe(1);
      expect(useUIStore.getState().toasts[0].kind).toBe('error');
      expect(useUIStore.getState().toasts[0].message).toBe('boom');
    });
  });

  it('after successful startTask, HUD auto-collapses in 1.5s', async () => {
    useUIStore.setState({ chrome: { statusBar: true, roster: true, hud: false, toolbar: true } });
    startTaskMock.mockResolvedValue(undefined);
    const { container } = render(
      <AgentCommandCenter onIntervene={() => {}} onOpenVault={() => {}} onOpenParallelChat={() => {}} />
    );
    const ta = container.querySelector('[data-hud-textarea]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'go' } });
    fireEvent.click(container.querySelector('[data-hud-run]') as HTMLElement);
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(useUIStore.getState().chrome.hud).toBe(true);
  });
});
```

Запусти: FAIL.

- [ ] **Step 2: Імплементувати**

Поправ `AgentCommandCenter.tsx` мінімально, зберігаючи поточний UI у full mode:

```tsx
// На початок компонента додай:
import { useChromeCollapse } from '../../hooks/useChromeCollapse';
import { useUIStore } from '../../stores/uiStore';
import { ChromeHandle } from '../core/ChromeHandle';

export function AgentCommandCenter({ onIntervene, onOpenVault, onOpenParallelChat }: Props) {
  // …existing hooks…
  const [collapsed, toggle] = useChromeCollapse('hud');
  const toast = useUIStore((s) => s.toast);
  const setChromeCollapsed = useUIStore((s) => s.setChromeCollapsed);

  // Updated submitGoal:
  const submitGoal = async () => {
    const goal = value.trim();
    if (!goal || busy || taskActive) return;
    setBusy(true);
    try {
      await startTask(goal);
      setValue('');
      setTimeout(() => setChromeCollapsed('hud', true), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to start task';
      toast({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  if (collapsed) {
    return (
      <div
        data-hud-collapsed-handle
        onClick={toggle}
        role="button"
        tabIndex={0}
        style={{
          position: 'absolute', bottom: 64, left: 0, right: 0,
          height: 12, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.4)',
          borderTop: '1px solid var(--glass-border, rgba(255,255,255,0.5))',
        }}
        aria-label="Розгорнути HUD"
      >
        <ChromeHandle position="bottom" collapsed={true} onToggle={toggle} label="HUD" />
      </div>
    );
  }

  // Існуючий full-HUD JSX — додай data-атрибути:
  //   <textarea … data-hud-textarea />
  //   <button onClick={submitGoal} … data-hud-run>…</button>
  // плюс на існуючій обгортці додай ChromeHandle position="bottom" collapsed={false} onToggle={toggle} label="HUD".
}
```

- [ ] **Step 3: Run green**

```bash
cd src/frontend && npx vitest run src/__tests__/AgentCommandCenter.test.tsx
```

Очікувано: 4 passed.

- [ ] **Step 4: Run full FE tests — guard проти регресії**

```bash
cd src/frontend && npx vitest run
```

Очікувано: всі зелені.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/components/agent/AgentCommandCenter.tsx src/frontend/src/__tests__/AgentCommandCenter.test.tsx
git commit -m "feat(agent-ui): HUD error toast, collapsed mode, auto-collapse after run

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 13: OperatorLayout — rewrite body

**Files:**
- Modify: `src/frontend/src/layouts/OperatorLayout.tsx`
- Update: `src/frontend/src/__tests__/OperatorLayout.test.tsx`

- [ ] **Step 1: Failing e2e test**

Створи або оновіть `src/frontend/src/__tests__/OperatorLayout.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import OperatorLayout from '../layouts/OperatorLayout';
import { useUIStore } from '../stores/uiStore';
import { useAgentStore } from '../stores/agentStore';
import { useSystemStore } from '../stores/systemStore';

vi.mock('../hooks/useAgentStream', () => ({ useAgentStream: () => {} }));
vi.mock('../hooks/useStandingOrdersHeartbeat', () => ({
  useStandingOrdersHeartbeat: () => ({ enabled: 0, totalFired: 0, lastFireAt: null }),
}));

describe('OperatorLayout v3 composition', () => {
  beforeEach(() => {
    useUIStore.setState({
      focusedAgent: 'foreground',
      toasts: [],
      chrome: { statusBar: true, roster: true, hud: true, toolbar: true },
    });
    useAgentStore.setState({
      currentTask: null, subGoals: [], recentActions: [], observations: [],
      reflections: [], events: [], thoughtBudget: { estimated_actions: 0, actions_used: 0, force_reflect_ratio: 2, reflections_done: 0 },
      llmCallsUsed: 0, llmCallsCap: 0, status: 'idle', substate: 'idle',
      currentInfoNeed: null, councilActive: false, reportPending: null,
      promotedToBackgroundAt: {}, bgTaskGoals: {}, progressByTaskId: {},
      proactive: { enabled: false, lastCycleAt: null, hasTriggers: false },
      councilStatements: [], councilSituationKind: null, councilSituationSummary: null,
      councilDecision: null,
    } as never);
    useSystemStore.setState({ state: 'OPERATOR' as never, sentience: { cortisol: 0 } as never });
  });

  it('contains AgentRoster, FocusPanel, Tape, no Logic Stream section', () => {
    const { container } = render(<OperatorLayout />);
    expect(container.querySelector('[data-roster-chip="foreground"]')).not.toBeNull();
    expect(container.querySelector('[data-focus-panel]')).not.toBeNull();
    // Logic Stream section removed
    expect(container.textContent).not.toMatch(/Logic Stream/i);
    // Event Log section removed
    expect(container.textContent).not.toMatch(/Event Log/i);
  });
});
```

Запусти: FAIL (`OperatorLayout` ще старий).

- [ ] **Step 2: Переписати body**

Відкрий `src/frontend/src/layouts/OperatorLayout.tsx`. Залиш імпорти, які потрібні; видали невикористовувані. Body замінити на:

```tsx
return (
  <motion.div
    className="w-[1024px] h-[600px] flex flex-col relative overflow-hidden"
    style={{
      background: 'var(--surface-sunrise, var(--surface-base))',
      filter: `blur(${morphology.blur}px) contrast(${morphology.contrast}) saturate(${morphology.saturation})`,
      opacity: morphology.opacity,
    }}
    initial={{ opacity: 0 }}
    animate={{ opacity: morphology.opacity }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.4 * morphology.motionScale, ease: EASE_PHANTOM as unknown as number[] }}
    data-testid="operator-layout"
  >
    <AmbientGlows />
    <StatusBar />
    <AgentRoster />

    <main className="flex-1 grid grid-cols-[1fr_140px] gap-2 p-3 min-h-0 z-10">
      <div data-focus-panel className="min-h-0 flex flex-col">
        <FocusPanel />
      </div>
      <div className="min-h-0 flex flex-col p-2 rounded-2xl"
           style={{
             background: 'var(--glass-card, rgba(255,255,255,0.35))',
             border: '1px solid var(--glass-border, rgba(255,255,255,0.45))',
             backdropFilter: 'blur(6px)',
           }}>
        <div className="text-[9px] font-bold tracking-widest uppercase opacity-50 mb-1 font-mono">
          Tape
        </div>
        <Tape rows={tapeRows} />
      </div>
    </main>

    <ToastRail />

    <AgentCommandCenter
      onIntervene={() => setInterveneOpen(true)}
      onOpenVault={() => setVaultOpen(true)}
      onOpenParallelChat={() => setChatOpen(true)}
    />
    <FloatingToolbar />

    <ParallelChatDrawer isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    <AgentVault isOpen={vaultOpen} onClose={() => setVaultOpen(false)} />

    <InterventionDialog
      open={interveneOpen}
      prompt={promptToUser}
      onSubmit={async (text) => { await intervene(text); setPromptToUser(null); }}
      onClose={() => setInterveneOpen(false)}
    />

    {reportPending && (
      <AgentReportScreen
        report={reportPending}
        busy={false}
        onClose={() => acknowledgeReport()}
        onContinueAsConversation={async () => {
          const seed = await resumeAsConversation();
          if (seed) setSystemState(SystemState.DIALOGUE, { trigger: 'resume', timestamp: Date.now(), auto: false });
        }}
        onOpenHistory={() => setAgentHistoryOpen(true)}
      />
    )}

    {currentInfoNeed && (
      <InfoNeedDialog
        infoNeed={currentInfoNeed}
        busy={infoNeedBusy}
        onSubmit={(answer) => respondToInfoNeed(answer)}
        onCancel={currentInfoNeed.required ? undefined : () => dismissInfoNeed()}
      />
    )}

    {planEditorOpen && currentTask && (
      <PlanEditor
        open={planEditorOpen}
        taskId={currentTask.task.id}
        initialSubGoals={subGoals}
        onClose={() => setPlanEditorOpen(false)}
      />
    )}

    {councilActive && (
      <CouncilStage
        open={councilActive}
        situationKind={councilSituationKind}
        summary={councilSituationSummary}
        statements={councilStatements}
        decision={councilDecision}
        onClose={dismissCouncil}
      />
    )}
  </motion.div>
);
```

`tapeRows` — derive у `useMemo`:

```ts
const tapeRows = useMemo<TapeRow[]>(() => {
  const out: TapeRow[] = [];
  recentActions.forEach((a, i) =>
    out.push({
      id: `act-${i}-${a.step_idx}`, kind: 'action',
      action: a.action, step_idx: a.step_idx, verdict: null,
      label: a.action, ts: a.ts ?? new Date().toISOString(),
    }),
  );
  reflections.forEach((r, i) =>
    out.push({
      id: `ref-${i}`, kind: 'reflection', verdict: r.verdict,
      step_idx: null, action: null,
      label: `reflection · ${r.verdict}`,
      ts: new Date().toISOString(),
    }),
  );
  observations.forEach((o, i) =>
    out.push({
      id: `obs-${i}`, kind: 'observation', verdict: null, step_idx: null,
      action: null, label: o.summary ?? 'observation',
      ts: o.created_at ?? new Date().toISOString(),
    }),
  );
  return out;
}, [recentActions, reflections, observations]);
```

Видалити:
- `HeroOrb`, `BudgetChip`, `BackgroundTaskCardMount` (функції внизу файлу).
- Імпорти `DecisionCard`, `LongRunningTaskCard`, `PlanTree`, `AgentTimeline`, `LayoutPanelLeft`, `Sparkles`, `History` (якщо вони лиш для старого body).

- [ ] **Step 3: Run e2e test green**

```bash
cd src/frontend && npx vitest run src/__tests__/OperatorLayout.test.tsx
```

Очікувано: passed.

- [ ] **Step 4: Run full FE suite**

```bash
cd src/frontend && npx vitest run
```

Очікувано: усе зелене (включно з оновленими StatusBar, FloatingToolbar, ChromeHandle, ToastRail тестами).

- [ ] **Step 5: Manual smoke**

Запусти dev:
```bash
cd src/frontend && npm run dev
```

Відкрий http://localhost:5173, переконайся:
- StatusBar 24px compact, Roster 28px compact, HUD 12px handle, Toolbar 12px handle.
- Клік на Roster Background → FocusPanel свапиться.
- Клік на HUD handle → з'являється input.
- Type → RUN при бекенді на Flash — таск стартує без 400-loop.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/src/layouts/OperatorLayout.tsx src/frontend/src/__tests__/OperatorLayout.test.tsx
git commit -m "feat(operator): rewrite layout as Roster + Focus + Tape

- AgentRoster (foreground/background/standing_orders/proactive/council)
- FocusPanel (5-pivot view)
- Tape (deduplicated event log)
- ToastRail mounted globally
- removed Hero hero-orb, PlanTree section, Logic Stream, Event Log
- removed BackgroundTaskCardMount floating overlay (folded into roster)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 14: Wire `useChromeCollapse` into 5 інших layouts

**Files (modify each):**
- `src/frontend/src/layouts/ShadowLayout.tsx`
- `src/frontend/src/layouts/FocusLayout.tsx`
- `src/frontend/src/layouts/DialogueLayout.tsx`
- `src/frontend/src/layouts/SentinelLayout.tsx`
- `src/frontend/src/layouts/GhostLayout.tsx`

**Why:** chrome-collapse — глобальний паттерн. Інші layout’и також мають StatusBar та FloatingToolbar — вони автоматично отримають compact/collapsed режими, бо самі компоненти вже використовують `useChromeCollapse` через свій store. Тут просто треба переконатися, що ці layout’и НЕ перекривають height’ами поверх компонентів.

- [ ] **Step 1: Read each layout, identify hard-coded heights**

```bash
for f in ShadowLayout FocusLayout DialogueLayout SentinelLayout GhostLayout; do
  echo "=== $f ==="
  grep -n "StatusBar\|FloatingToolbar\|paddingTop\|paddingBottom\|h-\[36\|h-\[60" src/frontend/src/layouts/$f.tsx | head -10
done
```

- [ ] **Step 2: Для кожного — прибрати hard-coded heights**

В кожному layout’і:
- Якщо є `paddingTop: 36` / `paddingBottom: 60` для компенсації StatusBar/Toolbar — замінити на flex-розкладку (`flex flex-col` body, `flex-1` main, StatusBar і FloatingToolbar самі визначають свою висоту через `useChromeCollapse`).
- Якщо `<StatusBar />` рендериться абсолютно — нічого не змінюємо (Status sам відповідає).

Робимо мінімум — компонентний компресор робить роботу. Цілком можливо, що ці layout’и не вимагають змін взагалі. Тоді commit пропустимо.

- [ ] **Step 3: Run FE suite**

```bash
cd src/frontend && npx vitest run
```

Очікувано: усе зелене.

- [ ] **Step 4: Manual smoke** — перемкнути systemState на DIALOGUE, FOCUS, SHADOW, SENTINEL, GHOST. Перевірити, що StatusBar 24px і FloatingToolbar 12px handle працюють всюди.

- [ ] **Step 5: Commit (тільки якщо було зміни в коді — інакше пропусти)**

```bash
git add src/frontend/src/layouts/{Shadow,Focus,Dialogue,Sentinel,Ghost}Layout.tsx
git commit -m "fix(layouts): respect chrome-collapsed heights across non-operator screens

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 15: Final smoke + backend integration test

- [ ] **Step 1: Run всі тести**

```bash
cd src/frontend && npx vitest run
cd src/backend && pytest -x -q
```

Очікувано: ZERO failures.

- [ ] **Step 2: Manual e2e — повна петля**

1. Підняти backend (якщо ще не):
   ```bash
   cd src/backend && source .venv/bin/activate
   AI_GEMINI_MODEL=gemini-2.5-flash uvicorn main:app --host 0.0.0.0 --port 8000 &
   ```
2. Підняти frontend: `cd src/frontend && npm run dev`.
3. Відкрити браузер 1024×600 емуляція.
4. Submit goal "say hello" → переконатись:
   - HUD auto-collapses через 1.5s.
   - Foreground chip активний.
   - FocusPanel показує goal + subgoals.
   - Tape отримує події без дублів.
   - Tape: якщо bot входить у revise_strategy 5× — task auto-paused.
5. Toggle handles по черзі — chrome elements компактні/повні.
6. Click Roster Background — FocusPanel пустий ("no background tasks").

- [ ] **Step 3: Перевірити quota не палиться при reflection loop**

В backend log переконатися, що при штучному виклику Pro 2.5 (тимчасово зміни env на pro) і запуску таска — після 5 reflections видно `auto-pause after 5 consecutive revise_strategy`. Повернути env назад на flash.

- [ ] **Step 4: Final commit (нічого нового — просто marker)**

Якщо в проекті використовується tag-on-merge — можна додати annotated tag `operator-v3-shipped`. Інакше пропустити.

```bash
git tag -a operator-v3-shipped -m "OperatorLayout v3 — Roster + Focus + Tape + Chrome Collapse"
```

(Push tag тільки якщо оператор просить.)

---

## Self-Review Checklist

Перед фіналом перевір:

1. **Spec coverage** — кожна вимога зі спеки `2026-05-11-operator-layout-v3-design.md` має задачу:
   - Roster + Focus + Tape → Tasks 6, 8, 9
   - Dedup loop-spam → Task 6 (`collapseRepeats`)
   - Backend reflection-cap → Task 1
   - Error toasts in HUD → Task 12
   - Chrome density (4 zones) → Tasks 2, 3, 4, 10, 11, 12
   - All other layouts respect chrome → Task 14
2. **No placeholders** — кожен step має код або точну команду. ✓
3. **Type consistency** — `FocusedAgent`, `ChromeKey`, `TapeRow` визначені в Task 2 та використовуються однаково в Tasks 3, 6, 8, 9. ✓
4. **TDD discipline** — кожна задача: failing test → impl → green → commit. ✓

## Відомі ризики імплементації

- `useStandingOrdersHeartbeat` залежить від наявного REST `/api/v1/agent/standing_orders`. Якщо response shape відрізняється від припущеного — поправ адаптер у hook (рядок `const orders = resp?.orders ?? []`).
- `AgentCommandCenter` тест припускає, що `useAgentStore.setState` пробрасується вглиб через зовнішній mock. Якщо vitest спіткнеться — використати `vi.spyOn(useAgentStore.getState(), 'startTask')` як fallback.
- StatusBar має кастомний JSX — потрібно реально прочитати файл перед патчем; data-атрибути на правильних wrappers.
- Хоча task 14 описаний як "можливо нічого не змінювати" — якщо інші layout’и явно hard-coded `pt-[36px]` через top-padding для StatusBar, треба перевести на flex.

## Out-of-scope (наступні PR)

1. Gemini Pro 2.5 tool-schema 400 root-cause fix.
2. Аудит модалок (`AgentVault`, `ParallelChatDrawer`, `InterveneDialog`, `InfoNeedDialog`, `AgentReportScreen`, `PlanEditor`, `CouncilStage`) на компактний дизайн.
3. Mobile companion з тим самим chrome-collapse паттерном.
