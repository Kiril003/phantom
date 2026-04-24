# Phase 11b / 11b.1 Retrospective Investigation

**Status:** Read-only audit. No code changes. The branch is checked out at
`v0.10.4-postpolish` (b00c380) — the user reverted here after live testing of
both 11b and 11b.1 surfaced breakage. Tags `v0.11-voice-always-on` (d3b5344)
and `v0.11.1-voice-fix` (fd11d5a) inspected via `git show`.

**Scope of this audit:** explain *why* automated gates passed twice but live
testing broke twice, identify which fixes still hold and which are illusions,
and propose a single path forward.

## Executive summary

Phase 11b shipped a complete backend voice pipeline plus a fully-built
`useVoiceAlwaysOn` hook — and forgot to wire the hook into any UI component.
The hook was dead code. **The "always-on" feature could not have worked at all
at v0.11**, because no React tree consumed `useVoiceAlwaysOn` (verified via
`git grep useVoiceAlwaysOn d3b5344` — only the hook file and a test file).

Phase 11b.1 wired it via a new `<VoiceAlwaysOnGate>` mounted in
`DialogueLayout`, gated reactively on `voice_always_on_enabled`, plus a shared
`useMicStream` to deconflict tap-to-talk and always-on. The settings gate, the
shared mic, the input-mode arbitration, and the WebSocket flow all read
correctly in source. **And yet the user reported 11b.1 still broken.**

The most economical explanation: **the served frontend was stale dist**. The
`src/frontend/dist/` build is dated `2026-04-24 22:32:14` — *one minute before*
the first Phase 11b commit (`4f8be5c` at 22:33:09). All Phase 11b code, and
every line of Phase 11b.1, is absent from that dist. If the user was running
`npm run preview` or serving the dist directly, the browser saw effectively
baseline v0.10.4 frontend regardless of which tag was checked out. That
single fact makes every reported 11b.1 symptom (sphere stuck "Listening", chat
mic visual mirroring toolbar, ffmpeg "Invalid data" upload) consistent with
known baseline behavior plus a flaky hardware mic capture, not with anything
in the new code.

If instead the user was on the vite dev server (`npm run dev`, port 5173),
HMR would have served the new code — but the only 11b.1 path that could
plausibly degrade tap-to-talk in that case is **shared MediaStream tearing**
(useMicStream stops tracks on last release; if the React effect order trips a
release-then-acquire on the same render the new acquire calls getUserMedia
fresh, but a still-alive old MediaRecorder on the stopped tracks would emit a
truncated webm that ffmpeg rejects with rc=183).

Recommended path forward is **option β — roll forward from v0.10.4 with two
small cherry-picks** (the backend ai_provider sync and the wake-word ASR
reset shortcut). Defer always-on entirely until a follow-up phase can ship
it with a real-browser smoke test as a hard gate, instead of jsdom unit
tests that can't see MediaRecorder, getUserMedia, or AudioWorklet.

---

## Section 1 — What 11b added

### Diff stats (b00c380 → d3b5344)

```
35 files changed, 5507 insertions(+), 26 deletions(-)
```

### New backend (Python)

| File | LOC | Purpose |
|---|---:|---|
| `src/backend/api/routes_voice_stream.py` | 287 | WS handler at `/ws/voice` |
| `src/backend/voice/always_on.py` | 301 | Orchestrator FSM |
| `src/backend/voice/vad.py` | 254 | Silero VAD wrapper |
| `src/backend/voice/wake_spotter.py` | 173 | Vosk wake-word matcher |
| `src/backend/voice/models/silero-vad/silero_vad.onnx` | 2.3 MB | binary asset |
| 6 test files | 1392 | Unit tests for the above |

### New frontend (TS / JS)

| File | LOC | Purpose |
|---|---:|---|
| `src/frontend/src/hooks/useVoiceAlwaysOn.ts` | 364 | WS + AudioWorklet client hook |
| `src/frontend/src/workers/voice-capture.worklet.js` | 112 | PCM resample/quantize |
| `src/frontend/src/__tests__/voiceAlwaysOn.test.tsx` | 333 | Hook unit tests |

### Modified files

`config.py` (+11 lines for `voice_always_on_enabled` etc.), `routes_settings.py`
(+23, surface the keys), `routes_chat.py` (+48 for `input_method=voice`),
`pipeline.py` (+59 for shared Vosk-model accessor), `stt_engine.py` (+7 lines
exposing `VoskSTTProvider.get_model()`), `main.py` (+2 lines registering the
WS), `requirements.txt` (+5 for `onnxruntime`, `vosk`).

### Hook signature at d3b5344

```ts
export interface AlwaysOnConfig {
  wsUrl?: string;
  token?: string;
  onFinalTranscript?: (t: FinalTranscript) => void;
  onWake?: (transcript: string, confidence: number) => void;
  debug?: boolean;
}
export function useVoiceAlwaysOn(config: AlwaysOnConfig = {})
  → { status, partialTranscript, errorMessage, confidenceMin, continuationWindowS,
      start(), stop(), micDuck(), micUnduck(), setConfidence() }
```

Note **no `enabled` prop** at this version. The hook would unconditionally try
to start as soon as someone called `start()`. Whether anyone called `start()`
depended on… (next paragraph).

### **SMOKING GUN — Phase 11b: no consumer**

```
$ git grep -l useVoiceAlwaysOn d3b5344
hooks/useVoiceAlwaysOn.ts        (definition)
__tests__/voiceAlwaysOn.test.tsx (test only)
```

No production component imports the hook at d3b5344. ChatWindow, FloatingToolbar,
DialogueLayout, StatusBar, VoiceSettings — none of them. The infrastructure
shipped, the consumer didn't.

This is the entire explanation for the Phase 11b symptom "saying фантом does
nothing": the WS endpoint was up, the orchestrator was running, but no
browser frame ever opened the mic to feed it bytes. The phase-11b acceptance
doc declared green because the gates were pure unit tests (orchestrator FSM,
VAD hysteresis, JWT verify, etc.) — none asserted that *some* component ever
calls the hook.

### Toolbar mic at d3b5344 (unchanged from baseline)

`FloatingToolbar.tsx` Voice button (`id: 'voice'`) calls `openVoice()`:

```ts
const openVoice = () => {
  setPendingVoiceActivation(true);
  if (state !== SystemState.DIALOGUE) goDialogue();
};
```

`pendingVoiceActivation` is consumed by `ChatWindow` (effect on the flag),
which calls `toggleVoice()` only if `recorder.state` is `idle` or `error`. So
the toolbar mic is a **one-way "start" button**: it can never stop a recording.
Stopping requires the chat-input mic. **This was already true at v0.10.4 and
was not introduced by 11b/11b.1.** When users say "the toolbar mic and the
chat mic affect each other" they're observing the correct flow — toolbar
fires `toggleVoice` which moves recorder into `'recording'`, which the chat
input mic visually reflects.

### Backend WS

`POST /ws/voice?token=<jwt>` — JWT in query string (browsers can't set headers
on WS). Sends `{type: "ready", enabled, sample_rate, frame_size_recommended,
wake_words, ...}` first message. Accepts binary PCM frames + JSON commands
(`reset`, `mic_duck`, `mic_unduck`, `set_confidence`, `stop`). Emits
`speech_start`, `speech_end`, `wake`, `final`, `cooldown_start`, `cooldown_end`,
`error`. The connection is accepted **regardless** of `voice_always_on_enabled`;
the orchestrator no-ops frames when disabled.

### Default

```py
# config.py:103
voice_always_on_enabled: bool = False
```

---

## Section 2 — What 11b.1 changed

### Diff stats (d3b5344 → fd11d5a)

```
6 commits, ~1100 net lines added
```

| File | New / Changed | Net |
|---|---|---:|
| `hooks/useMicStream.ts` | NEW | +182 |
| `stores/inputModeStore.ts` | NEW | +31 |
| `components/chat/VoiceAlwaysOnGate.tsx` | NEW | +68 |
| `__tests__/useMicStream.test.tsx` | NEW | +154 |
| `__tests__/VoiceAlwaysOnGate.test.tsx` | NEW | +130 |
| `hooks/useVoiceRecorder.ts` | refactor (shared mic) | +50 |
| `hooks/useVoiceAlwaysOn.ts` | added enabled gate, arbitration | +56 |
| `layouts/DialogueLayout.tsx` | mounted Gate, derived state | +23 |
| `backend/main.py` | ai_provider sync | +11 |

### `useMicStream` — singleton refcount, module-scoped

A closure holds one `state` object: `{ status, stream, error, pending, consumers: Set<string> }`. Two functions exposed via `useMicStream()`:

- `acquire(consumerId)` — adds to `consumers`. If a stream is already active,
  returns it. If a `getUserMedia` is in flight, returns the same pending
  promise. Otherwise calls `getUserMedia({ audio: { echoCancellation,
  noiseSuppression, channelCount: 1 }})` and caches.
- `release(consumerId)` — removes from `consumers`. **When the set is empty,
  it calls `track.stop()` on every track and resets `state.stream = null`.**

This is the most important new primitive. Both consumers acquire/release with
their own ID (`'tap-to-talk'`, `'always-on'`). Code is well-formed.

### `useVoiceRecorder` — refactored to use shared mic

Two changes from baseline (b00c380):
1. The `cleanup()` no longer calls `track.stop()`; it calls
   `micRelease('tap-to-talk')` instead. Refcount in `useMicStream` decides
   whether to actually stop the tracks.
2. `start()` now calls `micAcquire('tap-to-talk')` instead of
   `getUserMedia(...)` directly, and sets `useInputMode → 'tap'` synchronously
   *before* the mic resolves so any in-flight always-on wake is suppressed.

Everything else is preserved (MediaRecorder setup, AnalyserNode for amplitude,
onstop blob assembly, etc.).

**Subtle interaction:** baseline cleanup invariant was "after cleanup the
stream is dead". With refcount the invariant becomes "after cleanup my hold
is released; tracks may or may not still be live". A stale reference held
elsewhere (e.g., a `MediaStreamAudioSourceNode` someone forgot to disconnect)
would keep observing a *now-stopped* track if always-on releases last. Phase
11b.1 keeps both consumers' ref counts in lockstep — fine — but if anything
else holds the stream (e.g., a forgotten React strict-mode double-mount), the
behavior changes.

### `useVoiceAlwaysOn` — enabled prop + auto-start effect

The hook now takes `enabled?: boolean` (default `false`):

```ts
const [status, setStatus] = useState<AlwaysOnStatus>(
  enabled ? 'disconnected' : 'disabled',
);
// ...
const start = async () => {
  if (!enabled) {
    setStatus('disabled');
    return;
  }
  // ... open WS, micAcquire, AudioWorklet
};

useEffect(() => {
  if (!enabled) {
    manualStopRef.current = true;
    _teardown();
    setStatus('disabled');
    setErrorMessage(null);
    return;
  }
  setStatus(prev => prev === 'disabled' ? 'disconnected' : prev);
  void start();
}, [enabled]);   // eslint-disable react-hooks/exhaustive-deps
```

Three properties to verify:

1. **Does it call `acquire` when disabled?** No. `start()` returns before
   `micAcquire` line.
2. **Does it open the WS when disabled?** No. WS opens after the `if (!enabled)`
   gate inside `start()`.
3. **Does it auto-start on toggle-on?** Yes. The effect re-runs when `enabled`
   flips, and idempotency in `start()` (early return if status is connecting/
   ready/listening) is correct.

So the settings gate is sound at the source level.

### `VoiceAlwaysOnGate` — the missing wiring

```tsx
const enabled = useSettingsStore((s) =>
  Boolean(s.values.voice_always_on_enabled ?? false));
const sendMessage = useChatStore((s) => s.sendMessage);
const systemState = useSystemStore((s) => s.state);
const setInputMode = useInputMode((s) => s.setMode);

const onFinalTranscript = useCallback((t) => {
  const text = (t.transcript ?? '').trim();
  if (!text) return;
  void sendMessage(text, 'voice', systemState);
  setInputMode('idle');
}, [sendMessage, systemState, setInputMode]);

const { status, errorMessage } = useVoiceAlwaysOn({ enabled, onFinalTranscript });
useEffect(() => onStatusChange?.(status), [status, onStatusChange]);
return null;
```

Mounted by `DialogueLayout` line 46. Renders nothing. Reads settings
reactively via Zustand selector. Forwards transcripts to chat store. This is
correct.

### `inputModeStore` — minimal arbitration store

```ts
type InputMode = 'idle' | 'tap' | 'always_on';
useInputMode = create<{ mode, setMode }>((set) => ({
  mode: 'idle',
  setMode: (m) => set({ mode: m }),
}));
```

Calls:
- `useVoiceRecorder.start()` → `setMode('tap')` synchronously before mic resolves
- `useVoiceRecorder.cleanup()` → `setMode('idle')`
- `useVoiceAlwaysOn` wake handler → `setMode('always_on')`
- `useVoiceAlwaysOn` cooldown_end handler → `setMode('idle')` if was always_on
- `VoiceAlwaysOnGate.onFinalTranscript` → `setMode('idle')`

Wake-suppression check uses an `inputModeRef` (kept in sync via effect) so the
check sees the latest value even if React hasn't re-rendered. When mode is
`'tap'` and a wake event arrives, the WS is sent `{cmd:'reset'}` and the
event is dropped.

### Sphere "Listening" label source

```tsx
// DialogueLayout.tsx:74-84
{voiceActive
  ? 'Listening'                                 // ← tap-to-talk recorder state
  : alwaysOnStatus === 'armed'
    ? 'Armed'
    : alwaysOnStatus === 'cooldown'
      ? 'Cooldown'
      : pulsing
        ? 'Thinking'
        : alwaysOnActive
          ? 'Awake'
          : 'Ready'}
```

Where `voiceActive = recorder.state === 'recording' || recorder.state === 'requesting'`
(ChatWindow.tsx line ~95) and `setVoiceActive` is the callback `onVoiceToggle`
on `ChatWindow`. **The "Listening" label is driven entirely by the tap-to-talk
recorder's lifecycle, not by always-on.** Same logic as baseline (v0.10.4 has
`{voiceActive ? 'Listening' : pulsing ? 'Thinking' : 'Ready'}` — just simpler).

If a user reports "sphere stuck on Listening with always-on=false", that
means `recorder.state ∈ {recording, requesting}` and never went back to
`idle`. Possible causes: an in-flight `getUserMedia` rejection that didn't
flip state, an unhandled error path, or — and this is the practical one — a
stale dist where the recorder error path was different.

### Backend `main.py` change

```py
# Phase 11b.1 — reconcile the ContextEngine's cached ai_provider
try:
    from core.context_engine import context_engine
    context_engine.set_ai_provider(config.ai_primary_provider)
except Exception as exc:
    logger.debug("...skipped: %s", exc)
```

Runs after `apply_overrides(overrides)` from DB, so by the time it executes
`config.ai_primary_provider` already reflects user choice. `set_ai_provider`
mutates `_ai_provider` and the cached `_snapshot["system"]["ai_provider"]`
(context_engine.py:228-230). The next WS broadcast carries the right value.
**This is a correct, surgical fix.**

The wider context_engine has another reconciler at line 426-431 that runs in
`build_snapshot`:

```py
# context_engine.py:426
configured = config.ai_primary_provider
if self._ai_provider != configured:
    self._ai_provider = configured
```

So even without the 11b.1 startup fix, the StatusBar would correct itself on
the next 500 ms tick. The 11b.1 fix removes the visible flicker on first
broadcast. Holds up.

---

## Section 3 — Reproduction (what would break at v0.11.1)

Tracing user click → broken state, reading source at fd11d5a.

### Scenario A — clean v0.11.1 with `voice_always_on_enabled=false` (default)

1. App boots, `VoiceAlwaysOnGate` mounts.
2. `enabled` reads `false` from settings store. Effect runs: `_teardown()`
   no-op (nothing held), `setStatus('disabled')`. **No mic acquired, no WS
   opened.**
3. User clicks chat-input mic → `toggleVoice()` → `recorder.start()` →
   `micAcquire('tap-to-talk')` → `getUserMedia` (only consumer) → live stream.
4. User speaks → MediaRecorder collects chunks (`recorder.start(250)` emits
   every 250 ms).
5. User clicks chat-input mic again → `recorder.stop()` → `onstop` builds
   blob from chunks → `cleanup()` → `micRelease('tap-to-talk')` → refcount
   reaches zero → tracks stopped, stream nulled.
6. Blob uploaded to `POST /api/v1/voice/stt` with filename `clip.webm`.
7. Backend `/voice/stt` reads bytes, calls `transcribe_blob(raw, "uk")` →
   pipeline.py → STT provider (whisper or vosk) → returns text.

**This path works in source.** Backend `routes_voice.py` and `pipeline.py`'s
`transcribe_blob` are *unchanged* between baseline and 11b.1 (verified —
diff is purely additive: new `_vosk_model`, `get_vosk_model()`,
`reset_vosk_model()`). The HTTP STT route is untouched.

### Scenario B — user toggles `voice_always_on_enabled = true`

1. Settings PUT → store updates → `VoiceAlwaysOnGate.enabled` becomes `true`.
2. Hook's effect runs: `setStatus('disconnected')`, `void start()`.
3. `start()`: validates `enabled` (true), validates token, opens WS at
   `/ws/voice?token=...`. Awaits `'open'` event.
4. WS opens → `micAcquire('always-on')` → if tap-to-talk is also a consumer
   the cached stream is reused; otherwise a fresh `getUserMedia` is issued.
5. AudioContext + AudioWorklet attached. Worklet posts 30 ms PCM frames; main
   thread sends them as binary to WS.
6. Server emits `wake` → `setStatus('armed')`, `setInputMode('always_on')`,
   `onWake` fires.
7. Server emits `final` → `onFinalTranscript({ transcript, source, confidence })`
   → `sendMessage(text, 'voice', state)` → `setInputMode('idle')`.

**This path also works in source.** Provided the worklet asset loads (Vite
emits it via `?url` import), provided getUserMedia resolves, provided WS auth
passes.

### Scenario C — what would break it

Five concrete failure modes, only one of which is in the new code:

C1. **Stale dist served** — *this is the leading hypothesis.* `src/frontend/dist/`
    timestamps:

    ```
    drwxrwxr-x 2 radxa radxa    4096 Apr 24 22:32 .
    ...
    -rw-rw-r-- 1 radxa radxa  522523 Apr 24 22:32 DialogueLayout-BSCsxqC0.js
    -rw-rw-r-- 1 radxa radxa     864 Apr 24 22:32 AmbientGlows-DhYep5mK.js
    ```

    Every dist asset is from `2026-04-24 22:32:14`. Phase 11b's first commit
    (`4f8be5c — phase-11b: frontend AudioWorklet + useVoiceAlwaysOn hook`) is
    timestamped `22:33:09`. **The dist build does not contain a single line of
    Phase 11b or 11b.1 frontend code.** If the user opened the app via
    `npm run preview` (port 4173) or via a static server pointed at `dist/`,
    they were running essentially baseline v0.10.4 in the browser regardless
    of which git tag was checked out.

    Symptom mapping under stale-dist hypothesis:
    - "Sphere stuck Listening" → recorder really did get stuck on the user's
      hardware (mic permission flake, getUserMedia hang) — same bug as
      baseline would exhibit, no fix shipped because no fix ran.
    - "Toolbar mic toggles chat-input visual" → baseline behavior; expected.
    - "ffmpeg rc=183 Invalid data" → MediaRecorder produced a malformed webm
      under whatever hardware-level race. Independent of 11b changes.
    - "Top bar still shows Ollama briefly" → backend startup didn't run
      11b.1's `set_ai_provider` because the *backend* tag was actually fd11d5a
      but only the frontend dist was stale; or backend was also restarted at
      a different revision. Either way, frontend wasn't reading the new
      backend's reconciled snapshot in any way 11b.1 would have changed.

C2. **MediaStream re-acquire race** — if React strict-mode (or just two
    re-renders in fast succession) caused the recorder hook to mount, acquire,
    release, acquire on the same render commit, useMicStream's pending+stream
    state could end up with a stopped track on a stream object some component
    still holds. Reading the code, this requires the cleanup effect to fire
    twice in close succession; we didn't see explicit ref-count tests under
    React 18 strict-mode double-invocation. Plausible but not proven.

C3. **Worklet asset path** — `useVoiceAlwaysOn.ts:23` imports
    `'../workers/voice-capture.worklet.js?url'`. Vite emits it correctly in
    dev mode (HMR). In a build, the URL is rewritten and the file lands in
    `dist/assets/`. With stale dist, the worklet *isn't* in dist at all — but
    that only matters if always-on actually starts, which it shouldn't with
    the default off.

C4. **Phase 11b dead-hook autostart** — if a developer testing 11b had
    locally added a manual `useVoiceAlwaysOn().start()` call somewhere, that
    would have run at d3b5344 with no settings gate. We didn't find such a
    call in fd11d5a or d3b5344, but it could have existed in a working-tree
    state at user test time.

C5. **Vosk model load on backend startup** — the new shared
    `get_vosk_model()` in `pipeline.py` is *only* called by the always-on
    orchestrator. The HTTP STT path doesn't go through it. So even if the
    Vosk model directory was missing, `/voice/stt` would still work via the
    Whisper path. **Not a regression vector.**

---

## Section 4 — Root cause hypotheses

Ranked by confidence given the evidence above.

### H1 (HIGH) — Stale `dist/` served to the browser

**Evidence:** every dist asset timestamp is `Apr 24 22:32:14`, which precedes
the first Phase 11b code commit (`22:33:09 — phase-11b: frontend AudioWorklet
+ useVoiceAlwaysOn hook`) by 55 seconds. Subsequent six 11b commits and six
11b.1 commits never produced a fresh dist. If `npm run preview` or any static
server was pointed at `dist/`, the browser ran *baseline* JS while the
user/Claude believed they were testing 11b.1.

**What would fix it:** rebuild dist (`npm run build`) at every phase, OR
require the user to confirm they're on the dev server, OR add a build hash to
the served HTML and assert it matches HEAD before declaring the gate green.

### H2 (MEDIUM) — Hardware mic flake (recorder gets stuck)

**Evidence:** "Sphere stuck Listening" only flips back to "Ready" when the
recorder leaves the recording/requesting state. If `getUserMedia` hangs (the
browser permission prompt is dismissed without action; the device is busy
because OBS/Zoom holds it; PulseAudio re-route in progress), the hook sits in
`'requesting'` indefinitely. Baseline would exhibit the same symptom; no
known guard. Not introduced by 11b.

**What would fix it:** add a `getUserMedia` timeout in `useVoiceRecorder`
(e.g., race against a 6 s timer, set state to `'error'` on timeout). Same
guard would help baseline.

### H3 (LOW) — useVoiceAlwaysOn auto-runs despite enabled=false

**Evidence:** Reading `useVoiceAlwaysOn.ts` lines 232-244 (start gate) and
380-400 (auto-effect): both check `enabled` first. The hook genuinely cannot
acquire the mic with `enabled=false`. **Hypothesis disproven by source.**

The only path that *could* run with enabled=false is `_teardown()` itself,
which is a no-op when nothing is held. So this hypothesis is FALSE for the
11b.1 source. (Could still be live if the user had stale dist running 11b
code where the gate didn't exist — but at d3b5344 nobody was calling the
hook anyway.)

### H4 (LOW) — Sphere "Listening" comes from a different store

**Evidence:** `DialogueLayout.tsx:74` directly reads `voiceActive` (boolean
local state set by `setVoiceActive` callback wired to `ChatWindow`'s
`onVoiceToggle`). `onVoiceToggle?.(true)` fires synchronously at the start
of `toggleVoice()` (ChatWindow line ~140) and `(false)` at the
recording→stopping transition. So the label is precisely tied to recorder
intent. **Hypothesis disproven** — sphere "Listening" cannot fire from
always-on; it can only fire from tap-to-talk recorder.

### H5 (LOW) — MediaRecorder + AudioWorklet on shared stream emits malformed webm

**Evidence:** Web Audio spec permits multiple consumers on a `MediaStream` —
`createMediaStreamSource` does not interfere with concurrent `MediaRecorder`.
Real browsers (Chrome, Firefox) handle this. We can't disprove a Radxa-side
ARM Chromium bug, but the MediaRecorder produces a finalized webm container
in `onstop` regardless of what other graph nodes are doing. The reported
ffmpeg rc=183 ("Invalid data found when processing input") is more often
*empty/truncated input* than container corruption — and an empty input is
exactly what you'd get if `recorder.stop()` is called before `start()`
finishes laying down the EBML header (a sub-100 ms recording).

**What would catch it:** a real-browser smoke test (Playwright + Chromium
with `--use-fake-ui-for-media-stream` and a synthetic audio file via
`--use-file-for-fake-audio-capture`) that records 1 s, uploads, and asserts
HTTP 200 with non-empty transcript.

---

## Section 5 — Recommended path forward

### Recommendation: **Option β — roll forward from v0.10.4 with two cherry-picks; defer always-on**

Reasoning:
- Phase 11b's hook-without-consumer ships as zero-feature. Cherry-picking the
  *backend* infrastructure on top of v0.10.4 buys nothing if there's no UI.
- Phase 11b.1's `useMicStream` + `inputModeStore` + `VoiceAlwaysOnGate` are
  good code, but their value is conditional on always-on actually working,
  which we cannot prove without a real-browser test. Leaving them out keeps
  the surface small.
- Two specific 11b.1 changes have value independently:
  1. **Backend `set_ai_provider` startup sync** (`main.py` +11 lines). Surgical,
     proven correct, removes a real-world flicker. Cherry-pick.
  2. **Backend Vosk model accessor** (`stt_engine.py` +7 lines for
     `VoskSTTProvider.get_model`). Only meaningful if always-on lands later;
     skip for now, re-introduce alongside the always-on phase.
- Always-on as a feature is then deferred to a *Phase 11c* with a different
  approach (see "What gates missed" below).

### Scope of the recommended phase (Phase 11.5 — "AI provider sync only")

1. Cherry-pick `e33ca45 — phase-11b.1: sync ai_provider after DB settings load`
   onto v0.10.4-postpolish.
2. Verify no other code depends on it (it doesn't — `set_ai_provider` already
   exists at v0.10.4 line 228 of context_engine.py).
3. Run backend tests (`pytest src/backend/tests/test_phase00_scaffolding.py
   test_phase01_*` etc.) — full suite is overkill if the diff is +11 lines.
4. Manual: restart backend with `ai_primary_provider=ollama` env, switch UI
   to gemini in Settings, restart, verify StatusBar reads "Gemini" *immediately*
   (no flicker).
5. Tag `v0.10.5-provider-sync`.

### Time estimate

- Cherry-pick: 5 min
- Test verification: 10 min
- Manual reload check: 5 min
- Doc / commit: 10 min
- **Total: 30 min, ceiling 1 h.**

### Hard gates that would have caught Phase 11b/11b.1 issues

1. **`grep` gate**: at the end of any phase that ships a new hook, assert
   ≥ 1 production component imports it. One-line CI step:
   ```bash
   ! git grep -L useNewHook src/frontend/src/components src/frontend/src/layouts \
     | xargs grep -l useNewHook >/dev/null 2>&1
   ```
   Trivial; would have caught Phase 11b's dead hook in the diff review.

2. **dist/ freshness gate**: if `dist/` exists, its mtime must be ≥ HEAD's
   commit time, *or* the gate refuses to mark the phase shipped. Equivalently:
   `npm run build` must run as part of the acceptance script and the resulting
   dist must be committed (or its hash recorded somewhere the test harness
   reads).

3. **Real-browser smoke test**: Playwright test that loads the app on the
   running backend, clicks the chat-input mic button, speaks 1 s of synthetic
   audio (`--use-file-for-fake-audio-capture`), clicks again, asserts a chat
   message appears. Costs ~30 s in CI but catches:
   - Mic recorder stuck states
   - MediaRecorder producing corrupt blobs
   - Stale dist (URLs and bundles get fetched live)
   - JS errors in browser console

4. **Settings-reactivity smoke**: Playwright toggles voice_always_on_enabled
   in Settings, asserts WS connects to `/ws/voice` (network panel), toggles
   back, asserts WS disconnects.

### The single missing assertion

> "Some component renders the toolbar Voice button such that clicking it ends
> with `recorder.state === 'recording'`, AND clicking it a second time ends
> with `recorder.state === 'idle'` AND a chat message appears."

This is a 30-line Playwright test. It would have caught the Phase 11b dead
hook (always-on can't engage at all, so the second-click toggle would never
land if always-on was the only path), the Phase 11b.1 stale-dist scenario
(test runs against the running app, not against ephemeral imports), and the
toolbar one-way bug (which is *also* present in baseline v0.10.4 and shown
to be a UX issue, not a regression).

We have 199 frontend unit tests. None of them touch a real browser. None
verify "the app actually works."

---

## What gates missed

Honest list:

- **Phase 11b**: 96 backend + 30 frontend tests passed. Zero of them asserted
  a UI integration. The hook's existence ≠ the hook being used. The
  acceptance doc declared "shipped" because every gate the plan listed was
  green; the plan listed no integration gate. **The plan was the bug.**

- **Phase 11b.1**: 12 new frontend tests + 4 modified. All against jsdom,
  with `__resetMicStream()` test escape hatch and FakeMediaRecorder /
  FakeWebSocket / FakeAudioWorklet stubs. They verified:
  - useMicStream's refcount math
  - VoiceAlwaysOnGate calls the hook with the right `enabled`
  - useVoiceAlwaysOn's wake/final dispatch logic
  - Input-mode arbitration order

  They did NOT verify:
  - That `npm run build` produces a dist that contains the new files
  - That a browser can mount DialogueLayout without throwing
  - That the worklet URL resolves to a 200
  - That MediaRecorder produces a webm ffmpeg can read
  - That `getUserMedia` failures bubble back to a `'idle'` recorder state

- **Live verification step**: phase-11b.1 acceptance doc claims live STT
  curl test with HTTP 200 returned. That test used a backend-generated sine
  webm via ffmpeg — it verified the *backend* path, not the *frontend->backend*
  path. The blob the frontend produces under real conditions was never
  uploaded.

- **The user as the test harness**: both phases ended with "user must verify
  manually". When the user did, both broke. That's a process bug. A phase
  shouldn't ship to the user as the first integration test.

## What to keep, what to drop

| Component | Verdict | Rationale |
|---|---|---|
| Backend `routes_voice_stream.py` | KEEP at v0.10.4-baseline (don't ship) | No frontend uses it; revival waits for Phase 11c |
| Backend `voice/vad.py`, `wake_spotter.py`, `always_on.py` | KEEP archived | Working code, just no consumer yet |
| Backend `context_engine.set_ai_provider` startup sync | **CHERRY-PICK** | Standalone fix, surgical |
| Backend `pipeline.get_vosk_model()` | DROP for now | Only used by always-on |
| Frontend `useVoiceAlwaysOn.ts` | KEEP archived | Re-evaluate in 11c with real-browser tests |
| Frontend `useMicStream.ts` | KEEP archived | Useful primitive but not needed without 2nd consumer |
| Frontend `VoiceAlwaysOnGate.tsx` | DROP | Same — re-introduce with feature |
| Frontend `inputModeStore.ts` | DROP | Same |
| Frontend `useVoiceRecorder.ts` | KEEP at v0.10.4-baseline (don't ship 11b.1 refactor) | Refactor to shared mic was a bet on always-on; reverting reduces risk surface |
| `voice-capture.worklet.js` | KEEP archived | |

---

## Appendix A — Commit timeline

```
2026-04-24 20:55  89060b2  phase-11a audit doc (read-only)
2026-04-24 21:21  014360f  11b task 0 — dependency reconciliation
2026-04-24 21:27  39b2538  11b task 1 — Silero VAD module
2026-04-24 21:33  936daf1  11b task 2 — Vosk wake spotter
2026-04-24 22:07  f5057bb  11b task 3 — orchestrator FSM
2026-04-24 22:15  4b269a6  11b task 4 — voice WebSocket
2026-04-24 22:21  2c84792  11b task 5 — chat input_method=voice
2026-04-24 22:32  ────────  npm run build (last touch on dist/)
2026-04-24 22:33  4f8be5c  11b task 6 — frontend hook + worklet  ← dist no longer matches
2026-04-24 22:38  b9d0c40  11b task 7 — settings surface
2026-04-24 22:42  d3b5344  11b acceptance doc + tag v0.11-voice-always-on
2026-04-24 22:50  ────────  USER LIVE TEST — symptoms reported
2026-04-24 23:40  3f468bd  11b.1 — shared mic stream
2026-04-24 23:52  daa91f6  11b.1 — wire useVoiceAlwaysOn + arbitration
2026-04-24 23:57  e33ca45  11b.1 — ai_provider sync          ← surgical, keep
2026-04-24 23:58  bfb2b9a  11b.1 — settings toggle wiring verified
2026-04-25 00:09  fd11d5a  11b.1 acceptance + tag v0.11.1-voice-fix
2026-04-25 00:25  ────────  USER LIVE TEST — symptoms persist
2026-04-25 00:50  ────────  USER REVERTS to v0.10.4-postpolish
2026-04-25 (now)  ────────  This audit
```

The 22:32 dist build precedes every Phase 11b/11b.1 frontend change.

## Appendix B — Key file:line citations

- Phase 11b dead hook: `git grep useVoiceAlwaysOn d3b5344` returns 2
  non-test files: hook definition + tests. **Zero production consumers.**
- Sphere "Listening" source: `src/frontend/src/layouts/DialogueLayout.tsx:74`
  (and at v0.10.4: `DialogueLayout.tsx:62`).
- voiceActive plumbing: `src/frontend/src/components/chat/ChatWindow.tsx`
  line 95 (`voiceActive = recorder.state === 'recording' || 'requesting'`),
  line ~140 (`onVoiceToggle?.(true)` then `await recorder.start()`).
- Toolbar Voice one-way: `src/frontend/src/components/core/FloatingToolbar.tsx`
  line ~118 (`openVoice = () => { setPendingVoiceActivation(true); ... }`),
  consumed at `ChatWindow.tsx` (effect on `pendingVoiceActivation` only fires
  toggleVoice when `recorder.state ∈ {idle, error}`).
- Settings gate at fd11d5a: `useVoiceAlwaysOn.ts:232-244` (start early-return),
  `useVoiceAlwaysOn.ts:380-400` (auto-effect on `enabled`).
- Mode arbitration: `useVoiceAlwaysOn.ts:177-183` (wake suppress),
  `useVoiceAlwaysOn.ts:207-209` (final suppress).
- Backend `set_ai_provider` reconcile: `src/backend/main.py:160-169` (only
  exists at fd11d5a, not at b00c380), `src/backend/core/context_engine.py:228-230`
  (the method itself, exists at both tags).
- Stale dist evidence: `ls -la src/frontend/dist/` — all assets at
  `2026-04-24 22:32:14`, before `4f8be5c` at `22:33:09`.

## Appendix C — diff stat raw

```
$ git diff --stat b00c380..fd11d5a
 (top entries)
 src/backend/api/routes_voice_stream.py             | 287 +++++++++++++++++++++
 src/backend/voice/always_on.py                     | 301 +++++++++++++++++++++
 src/backend/voice/models/silero-vad/silero_vad.onnx| Bin 0 -> 2327524 bytes
 src/backend/voice/vad.py                           | 254 +++++++++++++++++
 src/backend/voice/wake_spotter.py                  | 173 ++++++++++++
 src/backend/voice/pipeline.py                      |  59 +++-
 src/backend/voice/stt_engine.py                    |   7 +
 src/backend/main.py                                |  11 +
 src/backend/api/routes_chat.py                     |  48 +++++-
 src/backend/api/routes_settings.py                 |  23 ++-
 src/backend/config.py                              |  11 +
 src/frontend/src/hooks/useVoiceAlwaysOn.ts         | 420 +++++++++++++++++++++
 src/frontend/src/hooks/useMicStream.ts             | 182 ++++++++++++
 src/frontend/src/hooks/useVoiceRecorder.ts         |  50 +-
 src/frontend/src/components/chat/VoiceAlwaysOnGate.tsx | 68 +++
 src/frontend/src/layouts/DialogueLayout.tsx        |  23 +-
 src/frontend/src/stores/inputModeStore.ts          |  31 ++
 src/frontend/src/workers/voice-capture.worklet.js  | 112 ++++
 (+ 6 backend test files, 4 frontend test files, docs)
 35 files changed, 5507 insertions(+), 26 deletions(-)
```
