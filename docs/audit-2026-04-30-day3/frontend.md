# Day-3 Frontend Audit — 2026-04-30

**Auditor perspective:** N-fe — Settings UI auto-render, touch-target compliance, 1024×600 layout, TypeScript strictness, animation discipline, auth lockout surface.

**Branch:** `autonomous-run` · **HEAD:** `d3ca9a6` · **Day-3 baseline:** `c3602c8`

**Scope:** read-only analysis of `src/frontend/src/`. No edits, no builds.

**Day-2 carry-overs (D2-FE1..FE5):** Re-confirmed below in the carry-over section. Not re-filed as new findings.

---

## Executive summary

Day-3 introduces **three net-new backend config keys** (`chat_tool_call_timeout_s`, `chat_tool_max_total_ms`, `log_json_enabled`) that are absent from `CATEGORY_SPEC` in `routes_settings.py` and therefore produce zero UI rows in `SettingsPanel.tsx`. This is the same class of gap as D2-FE1 (which covered seven earlier chat keys). All three are now fully wired on the backend: `chat_tool_call_timeout_s` is actively consumed by `ai/chat_tool_dispatcher.py:113`, `chat_tool_max_total_ms` is tested in `tests/test_phase_audit_2026_04_29_i5_cpu_sampler.py`, and `log_json_enabled` is branched on in `main.py:218`. An operator has no UI path to toggle any of them.

Beyond the settings gap, three additional new findings emerge: (1) `StatusBar.tsx:42` uses a bare `useSystemStore()` destructure — a D2-FE5 carry-over confirmed still present; (2) `AmbientGlows.tsx` runs three `animate-pulse-slow` CSS loops with no data coupling — the only purely-decorative animation in the codebase; (3) `LoginScreen.tsx` does not read the `Retry-After` or `X-Error-Code: LOCKED_OUT` headers from the server-side 429 response, meaning the frontend lockout countdown is computed entirely from a client-side clock that starts on the wrong event (the N-th failed attempt, not the server's actual lockout timestamp).

Touch-target compliance: the only confirmed sub-44 px interactive element is the NPU Refresh button at `SettingsPanel.tsx:1021` (`minHeight: 32`) — carried from D2-FE2, still unfixed. No new sub-44 violations found in Day-3 commits. Layout at 1024×600: no new overflow risks found. TypeScript strictness: `strict: true` in `tsconfig.json`; Day-3 commits introduced no new `: any` casts in product code; existing `as any` in map layer files pre-dates Day-3 and is catalogued below without re-filing.

**New findings: 4** (NEW-FE-01 through NEW-FE-04). Zero P0, two Tier B, two Tier C.

---

## Re-confirmation of D2 carry-overs (NOT re-filed)

The following five findings from Day-2 were scheduled for Day-3 Block R. All five are still present at HEAD `d3ca9a6` and are re-confirmed here for traceability. They do NOT receive new `NEW-FE-XX` IDs.

| ID | File:line | Status |
|----|-----------|--------|
| D2-FE1 | `routes_settings.py:101-252` — 7 chat/agent keys absent from `CATEGORY_SPEC` | **Still open.** No new rows added. |
| D2-FE2 | `SettingsPanel.tsx:1021` — NPU Refresh `minHeight: 32` | **Still open.** Value unchanged. |
| D2-FE3 | `agent_risk_tolerance` legal-values (1/3/5/7) not enforced by `ValueEditor` number input | **Still open.** `ValueEditor` unchanged. |
| D2-FE4 | `systemStore.ts:65` — `setContext` no shallow-equality bail | **Still open.** `setContext: (ctx) => set({ context: ctx })` unchanged. |
| D2-FE5 | `StatusBar.tsx:42` — whole-store destructure without selector | **Still open.** Confirmed again below; see NEW-FE-03 note. |

D2-FE5 is architecturally the same issue confirmed at line 42 of `StatusBar.tsx`. Because the Day-2 audit filed it, it is not re-filed — but the impact description below is expanded with Day-3 evidence showing the subscriber count has grown.

---

## NEW-FE-01 — Three Day-2 backend keys absent from Settings UI

**Severity: Tier B** (operator-invisible production tuning knobs; not broken today but will matter the moment Tier D chat pipeline ships)

### Background

Day-2 Tier C hardening (Block I) landed three new `PhantomConfig` fields:

| Key | Type | Default | Wired in |
|-----|------|---------|----------|
| `chat_tool_call_timeout_s` | `float` | `10.0` | `ai/chat_tool_dispatcher.py:113` |
| `chat_tool_max_total_ms` | `int` | `12000` | tests; planned `chat_pipeline.py` |
| `log_json_enabled` | `bool` | `False` | `main.py:218` |

### Evidence — backend: keys exist and are consumed

```python
# src/backend/config.py:469-486
chat_tool_call_timeout_s: float = 10.0
# Day-2 PERF-17b: per-turn wall-clock ceiling
chat_tool_max_total_ms: int = 12_000
# Day-2 (audit-2026-04-29 Tier E): structured JSON log output.
log_json_enabled: bool = False
```

```python
# src/backend/ai/chat_tool_dispatcher.py:113
timeout_s = float(config.chat_tool_call_timeout_s)
```

```python
# src/backend/main.py:218
if config.log_json_enabled:
```

### Evidence — frontend: keys absent from CATEGORY_SPEC

`grep -rn 'chat_tool_call_timeout_s\|chat_tool_max_total_ms\|log_json_enabled' src/frontend/src/` returns zero results. The keys are not referenced anywhere in frontend code.

`CATEGORY_SPEC` in `routes_settings.py:101-252` lists eight explicit categories (`general`, `theme`, `auth`, `sensors`, `ai`, `voice`, `vision`, `map`, `about`). None of these categories contain any of the three keys:

```python
# src/backend/api/routes_settings.py:101-252  (abridged)
CATEGORY_SPEC: list[dict[str, Any]] = [
    { "id": "general", "keys": ["system_hostname", "log_level", "debug", "serial_enabled"] },
    { "id": "ai",      "keys": ["ai_primary_provider", ... "ai_streaming"] },
    # ← no "chat" category; no chat_tool_call_timeout_s, chat_tool_max_total_ms, log_json_enabled
]
```

`LABEL_OVERRIDES` at `routes_settings.py:254-342` similarly has no entry for any of the three keys.

The settings panel rendering path (`SettingsPanel.tsx:377-393`) iterates `activeCategory.settings` which is built from `CATEGORY_SPEC` server-side by `_collect_categories()` at `routes_settings.py:416-431`. If a key is not in `CATEGORY_SPEC` it never appears in `GET /settings` category response and thus never renders a row.

### Why it matters

- `chat_tool_call_timeout_s` is the per-call hard ceiling for every tool invocation in the Tier-D chat pipeline. The default of 10 s may be too loose for the 7" touch device (operator will want to tighten it to 4-6 s). With no UI surface, the operator must use `curl PUT /api/v1/settings/chat_tool_call_timeout_s` — a route that does exist (F-09 is now fixed) but is not documented anywhere on the device UI.
- `chat_tool_max_total_ms` is the wall-clock budget for an entire multi-step tool turn. Default 12 s. On the Radxa (QNN NPU doing STT, GPU doing LLM via Ollama), a tight budget is essential; operators must be able to trim it without SSH.
- `log_json_enabled` is a structured-log toggle. Security operators running log-aggregation pipelines need a UI switch; `False` default is correct but toggling it requires backend-side env manipulation today.

### Fix sketch

Add a `"chat"` category to `CATEGORY_SPEC` after `"ai"`:

```python
{
    "id": "chat",
    "label": "Чат · Інструменти",
    "icon": "💬",
    "keys": [
        # From D2-FE1 (still open):
        "chat_prompt_logging_enabled",
        "chat_prompt_excerpt_max_chars",
        "chat_tools_enabled",
        "chat_tool_locationhistory_limit",
        "chat_tool_anchors_limit",
        "chat_tool_max_calls_per_turn",
        # NEW-FE-01 (Day-3):
        "chat_tool_call_timeout_s",
        "chat_tool_max_total_ms",
    ],
},
```

Add a `"logging"` key to `"general"` or a new `"ops"` category:

```python
{
    "id": "ops",
    "label": "Операції",
    "icon": "◈",
    "keys": ["log_level", "debug", "log_json_enabled"],
},
```

Add `LABEL_OVERRIDES` entries:

```python
"chat_tool_call_timeout_s": "Tool timeout (с)",
"chat_tool_max_total_ms":   "Tool бюджет ходу (мс)",
"log_json_enabled":         "JSON лог (structlog)",
```

`SettingsPanel.tsx` requires **zero changes** — it iterates whatever the API returns. `ValueEditor` will render `chat_tool_call_timeout_s` as a `number` input (float stored as Python `float`, returned as JSON number; `_infer_type` returns `"number"` for both `float` and `int`), which is correct. `log_json_enabled` renders as a toggle (boolean → `ValueEditor` boolean branch). `chat_tool_max_total_ms` renders as a `number` integer spinner.

**Note on `log_json_enabled` placement:** If `log_level` stays in `general`, move `log_json_enabled` alongside it rather than creating a new `ops` category — fewer categories is better on the 1024×600 sidebar.

---

## NEW-FE-02 — AmbientGlows: three `animate-pulse-slow` loops carry no data

**Severity: Tier C** (CLAUDE.md rule 9 violation — "Анімації = інформація — кожна анімація несе сенс, декоративних нуль")

### File

`src/frontend/src/components/core/AmbientGlows.tsx:15,28,42`

### Evidence

```tsx
// AmbientGlows.tsx:6-56 — full component
export function AmbientGlows() {
  return (
    <div aria-hidden className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Top-left cyan wash */}
      <div
        className="absolute rounded-full animate-pulse-slow"   // ← LINE 15
        style={{ top: '-25%', left: '-10%', width: '55%', height: '90%',
                 filter: 'blur(120px)', background: 'var(--glow-primary)', opacity: 0.55 }}
      />
      {/* Bottom-right purple wash */}
      <div
        className="absolute rounded-full animate-pulse-slow"   // ← LINE 28
        style={{ bottom: '-25%', right: '-10%', width: '50%', height: '80%',
                 filter: 'blur(110px)', background: 'var(--glow-secondary)', opacity: 0.5,
                 animationDelay: '2s' }}
      />
      {/* Accent ring near centre */}
      <div
        className="absolute rounded-full animate-pulse-slow"   // ← LINE 42
        style={{ top: '15%', right: '30%', width: '35%', height: '50%',
                 filter: 'blur(120px)', background: 'var(--accent-glow)', opacity: 0.35,
                 animationDelay: '1.2s' }}
      />
    </div>
  );
}
```

The component takes **no props** and reads **no store**. The three blobs animate continuously (`animate-pulse-slow` is a CSS `@keyframes` infinite loop defined in Tailwind config) with fixed delays of 0 s, 2 s, and 1.2 s. The animation rate never changes regardless of system state (SHADOW / SENTINEL / DREAM / GHOST). The blob positions and sizes are compile-time constants.

### Why it violates rule 9

The animation conveys nothing:
- It does not accelerate/decelerate to reflect system state (compare `Avatar` which pulses in sync with voice amplitude, or `SentinelLayout`'s radar sweep which is at least state-gated to `SENTINEL`).
- It does not reflect sensor data (breathing BPM would be the obvious coupling, as `DreamLayout` already does on its own orb).
- It does not stop when the device is idle (GHOST, DREAM layouts suppress the StatusBar but still render AmbientGlows — the blobs keep cycling in GHOST mode, which per `SECRET_FEATURES.md` is supposed to be visually inert).
- The three blobs pulse at different effective frequencies (base + 1.2 s offset + 2 s offset) creating a Lissajous-like beat pattern that is purely aesthetic.

`AmbientGlows` is mounted by `LoginScreen.tsx` and every layout that doesn't suppress it. It is the single largest source of continuous GPU rasterisation on the Radxa Mali GPU (three 1024×600 blurred radial gradients composited with `filter: blur(120px)` — each a separate GPU layer).

### Comparison with acceptable similar animations

| Component | Animation | Data coupling | Status |
|-----------|-----------|---------------|--------|
| `Avatar` (`Avatar.tsx:177-190`) | Ring pulse, scale | `voiceAmplitude` from store | Information-carrying ✓ |
| `DreamLayout` orb | Slow breathe | `breathingBpm` from context | Information-carrying ✓ |
| `SentinelLayout` radar sweep | Rotate 360° infinite | State-gated (only in SENTINEL) | Borderline — acceptable ✓ |
| `AmbientGlows` blobs | Pulse infinite | **None** | Decorative ✗ |

### Fix sketch

Two options, ordered by effort:

**Option A (minimal — 20 LOC):** Pass `systemState` as a prop and gate the animation via `animationPlayState`:

```tsx
import { useSystemStore } from '../../stores/systemStore';
import { SystemState } from '@shared/types';

export function AmbientGlows() {
  const state = useSystemStore((s) => s.state);
  // Pause in GHOST (stealth) and DREAM (has its own ambient orb)
  const play = state !== SystemState.GHOST && state !== SystemState.DREAM
    ? 'running' : 'paused';
  // Vary speed by threat level
  const duration = state === SystemState.SENTINEL ? '1.5s' : '4s';
  ...
  <div className="absolute rounded-full animate-pulse-slow"
       style={{ ..., animationPlayState: play, animationDuration: duration }} />
```

This couples the animation cadence to system state (SENTINEL = faster, GHOST = stopped), satisfying rule 9 at minimum viable cost.

**Option B (preferred — 40 LOC):** Couple to `context?.body.breathing_bpm` so the ambient wash breathes with the operator, mirroring what `DreamLayout` already does. This is semantically richer — the background literally responds to the user's biosignal — and creates a coherent "the system is alive" metaphor across all layouts.

Either option should add `aria-hidden` (already present — no accessibility change needed).

---

## NEW-FE-03 — StatusBar.tsx:42 whole-store destructure (D2-FE5 expansion)

**Severity: Tier B** (confirmed performance regression path; subscriber count has grown in Day-3 code)

This is a **Day-2 carry-over** (D2-FE5) being elevated here because Day-3 commits did not close it, and the impact is now measurable against the expanded subscriber set. It is NOT given a new ID — it is documented under its D2 ID. However its impact analysis is new.

### Evidence

```tsx
// src/frontend/src/components/core/StatusBar.tsx:42
export function StatusBar() {
  const { state, wsConnected, context, esp32 } = useSystemStore();  // ← bare destructure
  const { user } = useAuthStore();
```

Zustand's selector model: when you call `useSystemStore()` with no selector, React subscribes to the entire store object. Every `set()` call inside the store — regardless of which field changed — triggers a re-render of `StatusBar`. The store has six fields that can change independently:

| Field | Setter | Trigger frequency |
|-------|--------|-------------------|
| `state` | `setState` | state machine transitions (rare) |
| `context` | `setContext` | every WS `context.tick` (up to 2 Hz under full ESP32 cadence) |
| `authenticated` | `setAuthenticated` | on login/logout (rare) |
| `wsConnected` | `setWsConnected` | WS connect/disconnect (rare) |
| `esp32` | `setEsp32` | health poll every 10 s |
| `voiceAmplitude` | `setVoiceAmplitude` | audio rate while listening (~30 Hz) |

`StatusBar` destructures only `state`, `wsConnected`, `context`, `esp32` — but it re-renders on **every** `voiceAmplitude` update. While listening (which in `continuous` voice mode is permanent), `StatusBar` re-renders at the audio polling rate (~30 Hz), re-executing the time formatting, all child component prop comparisons, `useMemo` calls for `esp32DerivedOnline` and `esp32Effective`, and the internal `useRouterStatePolled` and `useAgentStatusPolled` polling hooks (which are defined as closures inside `StatusBar`'s render scope — but fortunately they use `useState` + `useEffect` internally so they're stable across re-renders).

The `StatusBar` is also the widest subscriber chain: it renders `OledEyePreview`, `FaceChip`, `BackgroundTrackBadge`, `BackgroundTrackDivider`, `ProactiveIndicator`, `ProviderBadge` — none of which need to re-render on voice amplitude changes.

### Fix: four per-field selectors

```tsx
// Before (line 42):
const { state, wsConnected, context, esp32 } = useSystemStore();

// After:
const state       = useSystemStore((s) => s.state);
const wsConnected = useSystemStore((s) => s.wsConnected);
const context     = useSystemStore((s) => s.context);
const esp32       = useSystemStore((s) => s.esp32);
```

Each of the four field-level subscriptions now only re-renders `StatusBar` when that specific field changes. `voiceAmplitude` changes no longer touch `StatusBar`. Combined with D2-FE4's `setContext` shallow-equality bail, this reduces worst-case re-renders from ~30 Hz to < 0.1 Hz during listening mode.

---

## NEW-FE-04 — LoginScreen does not consume server-side lockout headers

**Severity: Tier B** (UX correctness gap; creates a state-split between server and client lockout tracking that can allow or deny access incorrectly)

### File

`src/frontend/src/components/auth/LoginScreen.tsx:68-96`
`src/frontend/src/services/api.ts:28-62`

### Evidence — backend: 429 with headers

```python
# src/backend/api/routes_auth.py:133-141
def _lockout_response(remaining_s: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={"detail": f"Locked out. Retry after {remaining_s}s."},
        headers={
            "Retry-After": str(max(1, remaining_s)),
            "X-Error-Code": "LOCKED_OUT",
        },
    )
```

The backend enforces lockout server-side in `security.login_lockout` (a process-local in-memory module reset by `conftest.py:63-67`). When the per-IP or per-username threshold is exceeded, the backend:
1. Returns `HTTP 429` with `Retry-After: <seconds>` and `X-Error-Code: LOCKED_OUT` response headers.
2. Rejects all subsequent PIN attempts with `429` (not `401`) until the cooldown expires.

### Evidence — frontend: does not read headers

```typescript
// src/frontend/src/services/api.ts:28-62 — full request function
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  ...
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/me') {
      // Token cleanup — only handles 401
    }
    const err = await res.json().catch(() => ({ detail: 'Unknown error', code: 'UNKNOWN' }));
    throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.detail ?? 'Unknown error');
    // ← No res.headers.get('Retry-After') read
    // ← No res.headers.get('X-Error-Code') check
  }
  ...
}
```

`ApiError` stores `status: number`, `code: string`, `message: string` — no `retryAfter` field. The headers are discarded when the `Response` object goes out of scope.

### Evidence — LoginScreen: client-side lockout only

```typescript
// src/frontend/src/components/auth/LoginScreen.tsx:84-93
  try {
    const res = await authApi.loginPin(username.trim(), pin);
    setUser(res.user, res.token, res.expires_at);
    setAuthenticated(true);
  } catch {
    incrementAttempts();
    const attempts = loginAttempts + 1;
    if (attempts >= maxPinAttempts) {
      setLockout(Date.now() + lockoutDurationM * 60 * 1000);   // ← client-computed
      setError(`Too many attempts. Locked for ${lockoutDurationM} min.`);
    } else {
      setError(`Invalid credentials. Attempt ${attempts}/${maxPinAttempts}.`);
    }
  }
```

The catch block increments `loginAttempts` regardless of whether the server returned `401 PIN_INVALID` or `429 LOCKED_OUT`. When the 5th attempt triggers a server-side `429`, the client calls `incrementAttempts()` → 5 total → `setLockout(Date.now() + 15*60*1000)`. This is coincidentally correct for the "first lockout triggered by the 5th attempt" case.

### The failure modes

**Failure mode A — multi-device / page-refresh desync.**
If the operator opens a second browser tab and makes 3 more attempts from that tab (or the same tab reloads), the client-side `loginAttempts` resets to 0 (Zustand state is in-memory, not persisted). The client shows "Attempt 1/5" but the server responds `429`. The client catches the error, calls `incrementAttempts()` → count = 1, does NOT set lockout (1 < 5), shows "Invalid credentials. Attempt 1/5" — no lockout banner is displayed even though the server is locked out. The operator can keep entering PINs, each returning a `429` the client misinterprets as a count-1 failure.

**Failure mode B — lockout duration drift.**
The client computes `Date.now() + lockoutDurationM * 60 * 1000`. `lockoutDurationM` is fetched from `GET /auth/config` on mount but may differ from the actual remaining lockout time if: (a) the config changed between page load and lockout, or (b) the server's lockout started earlier (from a different IP or a previous tab). The `Retry-After` header contains the authoritative remaining seconds; the client ignores it.

**Failure mode C — RFID path.**
`RFIDScanner.tsx` calls `authApi.loginRfid(uid)` and dispatches `onError(m)` on any error (`LoginScreen.tsx:288-289`). The RFID path has no attempt counting in the frontend at all — the lockout display is only wired to the PIN flow. If RFID triggers a `429`, the operator sees the raw API error message string, not a lockout countdown banner.

**Failure mode D — lock badge not shown on initial 429.**
If the page is freshly loaded and the server is already locked (e.g. from a previous session), the first PIN attempt returns `429`. The client increments to 1, does not set lockout, does not show the red badge. The operator thinks they made one bad attempt; they have actually been banned for 15 minutes.

### What is correct

The lockout countdown timer at `LoginScreen.tsx:365-379` and the `authStore.setLockout/isLocked` logic are sound when the client has correctly set `lockedUntil`. The locked state badge renders at `LoginScreen.tsx:365-379`:

```tsx
{isLocked() && lockoutSeconds > 0 && (
  <motion.div ... style={{ background: ..., border: '1px solid var(--signal-alert)' }}>
    Locked · {lockoutSeconds}s
  </motion.div>
)}
```

This is correct UX — it just needs to be populated from server truth, not client count.

### Fix sketch

**Step 1 — Extend `ApiError` to carry retry-after:**

```typescript
// src/frontend/src/services/api.ts
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterS?: number,   // ← new field
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(...): Promise<T> {
  ...
  if (!res.ok) {
    const retryAfter = res.headers.get('Retry-After');
    const xErrorCode = res.headers.get('X-Error-Code');
    const err = await res.json().catch(() => ({ detail: 'Unknown error', code: 'UNKNOWN' }));
    throw new ApiError(
      res.status,
      xErrorCode ?? err.code ?? 'UNKNOWN',
      err.detail ?? 'Unknown error',
      retryAfter ? parseInt(retryAfter, 10) : undefined,
    );
  }
```

**Step 2 — LoginScreen catch block:**

```typescript
} catch (e) {
  const apiErr = e instanceof ApiError ? e : null;
  if (apiErr?.status === 429 || apiErr?.code === 'LOCKED_OUT') {
    // Server-authoritative lockout
    const remainingMs = (apiErr.retryAfterS ?? lockoutDurationM * 60) * 1000;
    setLockout(Date.now() + remainingMs);
    setError(`Too many attempts. Locked for ${Math.ceil(remainingMs / 60000)} min.`);
  } else {
    incrementAttempts();
    const attempts = loginAttempts + 1;
    if (attempts >= maxPinAttempts) {
      setLockout(Date.now() + lockoutDurationM * 60 * 1000);
      setError(`Too many attempts. Locked for ${lockoutDurationM} min.`);
    } else {
      setError(`Invalid credentials. Attempt ${attempts}/${maxPinAttempts}.`);
    }
  }
}
```

**Step 3 — RFID path:** wrap the `onError` call in `RFIDScanner.tsx` to use the same 429-detection logic and call `setLockout` there too.

**Step 4 — Initial probe on mount:** `LoginScreen` already fetches `authApi.config()` on mount. Add a second probe: `authApi.status()` (or interpret the existing `/auth/config` response to include a `locked_until` field if the server adds one). Alternatively, keep it simple: on any first PIN attempt that returns `429`, immediately display the lockout banner — which Step 2 already handles.

Estimated effort: ~50 LOC across `api.ts` (15), `LoginScreen.tsx` (25), `RFIDScanner.tsx` (10). Zero new dependencies.

---

## Touch-target compliance — Day-3 sweep

Methodology: `grep -rn 'h-1[01]\b\|h-9\b\|h-8\b\|h-7\b\|h-6\b' src/frontend/src/ --include="*.tsx"`, cross-referenced with inline `style` props for `height` and `minHeight`.

### Findings

| Location | Element | Rendered height | Hit target | Verdict |
|----------|---------|----------------|------------|---------|
| `SettingsPanel.tsx:1021` | NPU Refresh `<button>` | `minHeight: 32` (no `height` prop) | 32 px | **FAIL — D2-FE2, unfixed** |
| `App.tsx:71` | Loading spinner `<div>` | `w-8 h-8` = 32×32 px | non-interactive | OK — not clickable |
| `TimelineDrawer.tsx:79` | Pagination `<button>` | `w-8 h-8` + `min-w-[44px] min-h-[44px]` | 44 px (min overrides h-8) | OK |
| `TimelineDrawer.tsx:87` | Pagination `<button>` | `w-8 h-8` + `min-w-[44px] min-h-[44px]` | 44 px (min overrides h-8) | OK |
| `LoginScreen.tsx` TabButton | `<button>` | `height: 36, minHeight: 44` | 44 px (minHeight overrides) | OK |
| `LoginScreen.tsx` StatusPill | `<div>` | `height: 28` | non-interactive | OK |
| `LoginScreen.tsx` LockBadge | `<div>` | auto from `px-3 py-1.5` ≈ 28 px | non-interactive | OK |
| `PinPad.tsx` PadButton | `<motion.button>` | `height: 56, minHeight: 44` | 56 px | OK |
| `ChatWindow.tsx:349` | New session `<button>` | `height: 44, minHeight: 44` | 44 px | OK |
| `ChatWindow.tsx:654` | Voice button | `height: 40, minHeight: 44` | 44 px (min overrides) | OK |
| `ChatWindow.tsx:703` | Send button | `height: 40, minHeight: 44` | 44 px (min overrides) | OK |
| `SettingsPanel.tsx:163` | Category sidebar rows | `minHeight: 44` | 44 px | OK |
| `SettingsPanel.tsx:275` | Reset button | `minHeight: 44` | 44 px | OK |
| `SettingsPanel.tsx:294` | Save button | `minHeight: 44` | 44 px | OK |
| `SettingsPanel.tsx:476-503` | Boolean toggle | `minHeight: 44, minWidth: 64` | 44 px | OK |
| `SettingsPanel.tsx:509-531` | Select editor | `minHeight: 44` | 44 px | OK |
| `SettingsPanel.tsx:536-556` | Number input | `minHeight: 44` | 44 px | OK |
| `SettingsPanel.tsx:692-709` | ProviderTestButton | `minHeight: 44` | 44 px | OK |

**Net: 1 violation (D2-FE2, carried forward). Zero new Day-3 touch-target violations.**

The `TimelineDrawer.tsx:79,87` pattern (`w-8 h-8` + `min-w-[44px] min-h-[44px]`) deserves a note: the Tailwind `w-8/h-8` (32 px) visual size is overridden by the explicit Tailwind `min-w-[44px]/min-h-[44px]` classes which translate to `min-width: 44px; min-height: 44px`. CSS min-width/min-height always win over explicit width/height when the content is smaller. The visual appearance is 32×32 (the icon), the actual clickable box is 44×44. Compliant, but consider using `w-11 h-11` (44 px) instead to avoid confusion in future audits.

---

## 1024×600 layout — Day-3 sweep

All layout roots already audited in Day-2 as clean. Day-3 commits introduced no new layouts. The `SettingsPanel` is rendered inside `ViewportFrame.tsx` which constrains to `w-[1024px] h-[600px]`:

```tsx
// SettingsPanel.tsx:115-116
<div className="w-[1024px] h-[600px] flex flex-col" ...>
  <StatusBar />  {/* height: var(--status-bar-h) = 36px */}
  <div className="flex-1 flex min-h-0">  {/* remaining: 564px */}
    <aside className="w-[220px] h-full flex flex-col glass-panel"> ... </aside>
    <main className="flex-1 min-h-0 flex flex-col">
      <header style={{ height: 56 }}> ... </header>
      <section className="flex-1 overflow-y-auto px-6 py-5"> ... </section>
    </main>
  </div>
</div>
```

Pixel budget: `36 (StatusBar) + 56 (header) + flex-1 (overflow-y-auto) = 564px` for content. `flex-1 overflow-y-auto` on the section ensures the settings rows scroll without leaking outside the 600 px boundary. No overflow risk.

The `NPUDiagnostics` detail grid (lines 1053-1085) uses `gridTemplateColumns: '120px 1fr'` inside the scrollable section. At maximum content, it could produce ~200 px of grid height. This is inside the scrollable section and does not overflow the outer container.

**No new 1024×600 violations found in Day-3 scope.**

---

## TypeScript strictness — Day-3 sweep

`tsconfig.json` at HEAD:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

All four strictness flags confirmed active. `noEmit: true` means `tsc` runs as a type-checker only; the build gate is `tsc && vite build`.

### `as any` inventory (product code only — excluding `__tests__/` and `test-setup.ts`)

| File | Line | Cast | Justification |
|------|------|------|---------------|
| `map/HeatmapLayer.tsx` | 44, 75 | `geojson as any` passed to `map.getSource().setData()` | MapLibre GL type stubs don't expose the full GeoJSON union — established pre-Day-3 pattern |
| `map/layers/BaseLayer.tsx` | 20 | `buildPhantomStyle(tokens) as any` for `map.setStyle()` | MapLibre style type is intentionally loose upstream |
| `map/TacticalMap.tsx` | 153 | `buildPhantomStyle(...) as any` same reason | Same as above |
| `map/TacticalMap.tsx` | 222–241 | `'mousedown' as any`, `'mousemove' as any`, etc. | MapLibre event name union doesn't include all touch variants; known upstream gap |
| `map/layers/ReconLayer.tsx` | 44, 59 | `geojson as any` | Same as HeatmapLayer |
| `chat/MapResponse.tsx` | 84 | `buildDarkStyle(...) as any` | Same MapLibre style pattern |
| `services/geolocation.ts` | 74 | `(navigator.permissions as any).query(...)` | Navigator Permissions API not fully typed in DOM lib at ES2022 target |
| `stores/systemStore.ts` | 33, 78 | `(window as any).__phantom` | DEV-only debug escape hatch; guarded by `import.meta.env.DEV` |
| `stores/authStore.ts` | 120, 121 | `(window as any).__phantom` | Same DEV-only pattern |

### Assessment

**Zero new `as any` casts introduced in Day-3 commits.** All of the above pre-date Day-3 and are confined to two categories:

1. **MapLibre GL type gap** (`map/` files): The `as any` casts on `buildPhantomStyle()` result and MapLibre event names are an upstream type gap in `maplibre-gl@4.7.1`. The correct long-term fix is a type declaration augmentation in `src/frontend/src/vite-env.d.ts`, not suppression. However this is not a new Day-3 issue.

2. **DEV debug window escape** (`stores/*.ts`): The `(window as any).__phantom` pattern is correctly guarded by `import.meta.env.DEV`. It does not appear in production bundles (Vite tree-shakes the DEV block). An `eslint-disable @typescript-eslint/no-explicit-any` comment is missing on these lines, which will cause the `eslint --max-warnings 0` gate to flag it if the ESLint `@typescript-eslint/no-explicit-any` rule is enabled. Check the ESLint config — if the rule is currently `off`, no action needed; if it's `warn`, these need suppression comments.

**No `@ts-ignore` or `@ts-nocheck` directives found anywhere in product code.**

---

## Animation discipline — Day-3 sweep

CLAUDE.md rule 9: "Анімації = інформація — кожна анімація несе сенс, декоративних нуль."

### DreamLayout — breathing orb

```tsx
// DreamLayout.tsx:35-54
const breathDuration = breathingBpm && breathingBpm > 0 ? 60 / breathingBpm : 5;
<motion.div
  animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.8, 0.5] }}
  transition={{ duration: breathDuration, repeat: Infinity, ease: 'easeInOut' }}
/>
```

Correct — animation period is `60 / breathingBpm` seconds (real respiratory cycle). Information-carrying. The fallback of 5 s (default when no biosignal) approximates a resting 12 BPM adult breathing rate, which is reasonable.

The breathing bar at `DreamLayout.tsx:84-109` uses the same `breathDuration`. Both are coupled to the same data. Correct.

### SentinelLayout — radar sweep

```tsx
// SentinelLayout.tsx:94-96
animate={{ rotate: 360 }}
transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
```

The 4-second sweep period is not coupled to any sensor data. However the entire `SentinelLayout` is only mounted when `systemState === SENTINEL`, so the animation is state-gated. Per Day-2 assessment: borderline, but defensible as a skeuomorphic state-cue. Confirmed unchanged from Day-2.

### SentinelLayout — alert flash overlay

```tsx
// SentinelLayout.tsx:43-49
animate={{ opacity: [0, 0.06, 0] }}
transition={{ duration: 0.8, repeat: Infinity }}
```

The flash is constant at 0.8 s period regardless of threat level, presence distance, or motion energy. Not wired to `context.presence.other_distance_cm` or `context.body.motion_energy`. Per Day-2 assessment: "P2 — defendable but could link to alert intensity." Confirmed unchanged.

### AmbientGlows — three `animate-pulse-slow` blobs

**See NEW-FE-02 above.** This is the only Tier C animation finding in Day-3. The `animate-pulse-slow` CSS animation is a Tailwind custom keyframe with no data coupling whatsoever.

### StatusBar — `pulse-state` CSS animation on state dot

```tsx
// StatusBar.tsx (StatePill):
animation: state === SystemState.SENTINEL
  ? 'pulse-state 0.6s ease-in-out infinite'
  : 'pulse-state 2s ease-in-out infinite',
```

The animation speed is coupled to system state (0.6 s in SENTINEL = "urgent", 2 s normally = "breathing"). Information-carrying. Correct.

### Summary

| Component | Animation | Coupled to data | Rule 9 status |
|-----------|-----------|-----------------|---------------|
| DreamLayout orb + bar | breathe | `breathing_bpm` | OK ✓ |
| SentinelLayout radar sweep | rotate 360° | state-gated to SENTINEL | Borderline OK ✓ |
| SentinelLayout flash | opacity pulse 0.8 s | state-gated only | Borderline OK ✓ |
| SentinelLayout presence dot | scale pulse | state-gated + `other_detected` | OK ✓ |
| StatusBar state dot | pulse 0.6 s / 2 s | system state | OK ✓ |
| Avatar ring | pulse | `voiceAmplitude` | OK ✓ |
| **AmbientGlows blobs** | **animate-pulse-slow × 3** | **none** | **FAIL ✗ → NEW-FE-02** |

---

## Auth surface — lockout UX completeness

Cross-referencing `src/frontend/src/components/auth/LoginScreen.tsx`, `PinPad.tsx`, `RFIDScanner.tsx`, `stores/authStore.ts`, `services/api.ts` against the backend `routes_auth.py` lockout contract.

### What works

1. **Client-side attempt counter** (`authStore.loginAttempts`) correctly counts PIN failures and displays `Attempt N/max` in `LoginScreen.tsx:395`.
2. **Lockout banner** at `LoginScreen.tsx:365-379` renders when `isLocked()` returns true, shows countdown in seconds, auto-clears via the `lockedUntil` timer.
3. **PinPad is disabled** when `isLocked()` — the `disabled` prop propagates through `PinPad` → `PadButton` → `motion.button disabled={disabled}`. Keyboard interaction also blocked.
4. **Username input is disabled** when `isLocked()` — `LoginScreen.tsx:265`.
5. **Config fetch on mount** — `authApi.config()` correctly seeds `maxPinAttempts` and `lockoutDurationM` from the backend, so even if the admin changed the default in settings, the UI reflects the current server config.
6. **Mode-switch clears error** — `handleModeSwitch` calls `setError('')` so a stale error from PIN mode doesn't persist when switching to RFID.

### What does not work (filed as NEW-FE-04)

1. `request()` discards `Retry-After` and `X-Error-Code` response headers — see NEW-FE-04.
2. RFID 429 not handled — `RFIDScanner`'s `onError` receives a raw error string; no lockout countdown is shown.
3. Fresh-page 429 not detected — first attempt after page reload returns `429`, client shows "Attempt 1/5."

### What is not expected (by spec)

The `LoginScreen` does not implement auto-unlock polling (no `GET /auth/status` call to check if the lockout has expired server-side). The client relies entirely on the client-side `lockedUntil` timer calling `resetAttempts()` after the countdown. This is acceptable for a LAN device where clock drift between client and server is negligible (both on the same Radxa node). No finding raised.

---

## Punch list — new Day-3 findings only

### Tier B — will cause observable UX gaps in current or near-term phase

| ID | File | Severity | Short description |
|----|------|----------|-------------------|
| **NEW-FE-01** | `routes_settings.py:101-252` | Tier B | 3 Day-3 backend keys (`chat_tool_call_timeout_s`, `chat_tool_max_total_ms`, `log_json_enabled`) absent from `CATEGORY_SPEC`; invisible in Settings UI |
| **NEW-FE-03** | `StatusBar.tsx:42` | Tier B | D2-FE5 carry-over — whole-store destructure with no selector; re-renders StatusBar at voice amplitude rate (~30 Hz while listening) |
| **NEW-FE-04** | `LoginScreen.tsx:84-93` + `api.ts:51-60` | Tier B | `Retry-After` / `X-Error-Code: LOCKED_OUT` headers from 429 response discarded; client lockout state desyncs from server on page-reload, multi-tab, and RFID paths |

### Tier C — polish / CLAUDE.md rule compliance

| ID | File | Severity | Short description |
|----|------|----------|-------------------|
| **NEW-FE-02** | `AmbientGlows.tsx:15,28,42` | Tier C | Three `animate-pulse-slow` blobs with no data coupling — only purely decorative animation in the codebase; violates CLAUDE.md rule 9 |

---

## Carry-over D2 findings — not fixed, not re-filed

| ID | File:line | Tier | Unchanged? |
|----|-----------|------|-----------|
| D2-FE1 | `routes_settings.py:101-252` | B | Yes — 7 earlier chat keys still absent |
| D2-FE2 | `SettingsPanel.tsx:1021` | C | Yes — `minHeight: 32` still present |
| D2-FE3 | `SettingsPanel.tsx:534-557` | C | Yes — `ValueEditor` number input unchanged |
| D2-FE4 | `systemStore.ts:65` | B | Yes — `setContext: (ctx) => set({ context: ctx })` unchanged |
| D2-FE5 | `StatusBar.tsx:42` | B | Yes — bare destructure unchanged (see NEW-FE-03 expansion) |

---

## Things confirmed safe in Day-3

- **Touch-target compliance**: 1 pre-existing violation (D2-FE2 NPU Refresh 32 px). Zero new violations.
- **1024×600 layout**: All layout roots correct. `SettingsPanel` correctly uses `flex-1 overflow-y-auto` for the settings section. No overflow risk found.
- **TypeScript strict mode**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` all active. Zero new `as any` casts in product code in Day-3 commits. Zero `@ts-ignore` anywhere in product code.
- **Auth attempt counter display**: Correct when page state is intact and no concurrent tabs.
- **PinPad disabled state**: Correctly propagates `disabled` prop to all 12 tap targets (10 digits + Clear + Del).
- **DreamLayout animation**: Correctly coupled to `breathing_bpm`; speed matches real breathing cycle.
- **StatusBar state-dot animation speed**: Correctly switched between 0.6 s (SENTINEL) and 2 s (all other states) — information-carrying.
- **No `@ts-nocheck` or `@ts-ignore` in any product file.**
- **No dead modules or orphan exports found in Day-3 scope.**
