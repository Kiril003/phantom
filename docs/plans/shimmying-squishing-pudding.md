# Phase 4 — Bug Wave + Vision

## Context

DA-1..DA-6 of Phase 3 closed. User flagged 6 issues during DA-6 review and
explicitly chose **bug-fix wave first, ambitious vision wave second**.

The 3 bugs (this plan executes now):
- **BW-1** Map not visible
- **BW-2** Downloaded STT models (Vosk / Whisper) silently unused
- **BW-3** Timer "не правильно робить" (vague — needs symptom clarification before code change)

The 3 ambitious vision items (next plan after BW lands):
- **P4-1** Profile screen + AI-context profile (nothing exists today)
- **P4-2** Persistent chat sessions + history UI (every launch = clean chat)
- **P4-3** Rich chat artifacts (Claude-style) — design TBD between widget extension vs HTML sandbox vs hybrid

## Approach — Bug Wave

### BW-1 — Map not in nav graph

Recon facts (`feature-stream/.../ui/widget/MapWidget.kt:58-131` + `domain/SurfaceId.kt:20-31` + `app/.../navigation/PhantomNavGraph.kt:63-99`):

- `MapWidget` Composable is **fully implemented** (MapLibre import, MapView, GeoJSON circles, style URL `https://demotiles.maplibre.org/style.json`).
- `SurfaceId` enum has 7 entries — Stream, Onboarding, Pair, Vault, Diary, Motion, Whisper. **No `Map`.**
- `PhantomNavGraph` has 7 `composable()` destinations — same set, no Map.
- `INTEGRATION_AUDIT.md:77` confirms: "map: pipe alive, surface empty (MapWidget consumes local intents only — Phase 1-G)".

Fix:
1. Add `Map` to `SurfaceId` enum (`feature-stream/.../domain/SurfaceId.kt`).
2. Add `composable("map") { MapScreen(...) }` to `PhantomNavGraph.kt`.
3. Wrap existing `MapWidget` in a `MapScreen` composable that hosts it full-screen + handles back-nav + wires `phantomVm._mapEvents` if needed.
4. Verify SurfaceTray now exposes Map automatically (it already pulls from `SurfaceId.visible(isDebug)` per `SurfaceTray.kt:136-151`).
5. Tile-server URL stays `demotiles.maplibre.org` for now — note in Settings/code that custom tile server is a future option (don't block BW-1 on it).
6. Test: launch app, tap Map pill, confirm map renders. No unit test (MapWidget has none).

### BW-2 — STT model lazy-init race

Recon facts (`core-voice/.../VoiceManager.kt:76-85`, `core-ai/.../ModelManager.kt`, `app/.../data/AppContainer.kt:113,207-225,631-649`):

- `voiceManager` is lazy singleton; on first access calls `initStt(voskDir, whisperPath)`.
- At init time both `voskDir` and `whisperPath` resolve to **non-existent files** (no download yet).
- VoiceManager silently falls back to `FakeSttEngine()` and stays there for the session.
- After download, `ModelManager.events` emits `DownloadEvent.Completed` → `AppContainer:639-649` calls `voiceManager.refreshModels(...)` which DOES re-init properly.
- BUT: window of broken behavior between voiceManager-first-access and download-complete.
- Even worse: if user already used PTT once with FakeSttEngine, refresh happens but UI may still show "no STT" until next access cycle.

Fix:
1. **Make `initStt()` re-runnable cheap**: ensure `refreshModels` actually swaps the active engine atomically (read VoiceManager.kt:76-85 to confirm; if not, fix).
2. **Init-on-models-present**: change `voiceManager` lazy block so `initStt(...)` is called only when `voskDir.exists() || whisperPath.exists()`. Otherwise skip and let the download-completion handler do the first init.
3. **Eager check on subscribe**: when PTT button is pressed, before recording starts, call `voiceManager.ensureInitialized(modelManager)` which checks model files and inits if needed. Sync, fast — file existence check is microseconds.
4. **Session-spanning fix**: emit a `VoiceManager.engineState: StateFlow<EngineState>` (Fake / Vosk / Whisper / Hybrid) so UI can show actual current engine, not assumed.
5. Test: extend `SttDispatchInvariantTest.kt` to cover (a) first-access-before-download → fake; (b) download → refresh → real engine; (c) re-init idempotent.

### BW-3 — Timer "не правильно робить"

Recon facts (`feature-stream/.../ui/widget/TimerWidget.kt:84-279`, `TimerMath.kt:16-110`, 23 unit tests in `TimerWidgetTest.kt`):

- Code appears **correct**: rememberSaveable state, tickerFlow with 1s delay, finish-latch via `firedFinish` saveable, math via `System.currentTimeMillis()` (no TZ drift), tests cover happy path + edge cases.
- Most likely failure modes (none caught by tests):
  - Finish chime not audible — `LocalSoundEngine.current` may be gated by `GhostMode` state or muted via `voicePrefs.soundsEnabled`
  - Notification not firing if app backgrounded
  - WidgetRenderer dispatcher routes wrong widget type → TimerWidget never instantiates
  - AI never emits proper timer JSON in the expected schema (WidgetPayloadTest passes but means nothing if AI pipeline doesn't emit)

Action: **ask user for concrete symptom** before changing code — recon says code is correct, so we need user's actual repro to know whether bug is in TimerWidget itself or in the upstream AI/dispatch/sound chain.

## Critical files — Bug Wave

- `feature-stream/src/main/java/local/phantom/companion/feature/stream/domain/SurfaceId.kt` — add `Map` enum entry
- `app/src/main/java/local/phantom/companion/navigation/PhantomNavGraph.kt` — add `composable("map") {…}`
- `feature-stream/src/main/java/local/phantom/companion/feature/stream/ui/widget/MapWidget.kt` — wrap in MapScreen for full-screen rendering
- `feature-stream/src/main/java/local/phantom/companion/feature/stream/ui/SurfaceTray.kt` — verify auto-pickup (read-only check)
- `core-voice/src/main/java/local/phantom/companion/core/voice/VoiceManager.kt` — guard initStt + add engineState
- `core-ai/src/main/java/local/phantom/companion/core/ai/ModelManager.kt` — read-only reference for download events
- `app/src/main/java/local/phantom/companion/data/AppContainer.kt:113,207-225,631-649` — fix lazy init order
- `feature-stream/src/test/java/local/phantom/companion/feature/stream/SttDispatchInvariantTest.kt` — extend with model-race coverage

## Approach — Vision (P4-1, P4-2, P4-3) — outline only, separate plan later

| Item | Sketch | Effort |
|---|---|---|
| P4-1 Profile | New `:feature-profile` module with `ProfileScreen`. Pulls user from phantom-os `/api/v1/users/me` (multi-user — phantom + kiril). Editable name, avatar URL, AI-facing behavioural model (preferences fed to system prompt). New `SurfaceId.Profile`. Settings → "Профіль" entry point. | Medium (1-2 days) |
| P4-2 Chat sessions + history | Room v11: `chat_session` (id, title, created_at) + `chat_message` (id, session_id, role, content, widgets_json, created_at). Sidebar UI à la ChatGPT. AI context: pass last N messages of current session to AIRouter. WS sync to phantom-os via new `chat` channel. | Large (3-5 days) |
| P4-3 Chat artifacts | **Recommended**: hybrid. Keep widget JSON for known types (timer, route, weather, code, chart, table, form, vote, gallery, todo). For unknown/one-off, AI emits `{type: "artifact", html: "...", csp: "strict"}` rendered in `WebView` sandbox with no JS interop except a postMessage bridge. New CONTRACT §10.20 schema. Sandbox audit + XSS gate are blockers. | Large (5-10 days) |

P4 plan (separate file) lands after BW ships.

## Verification

- BW-1 done when: launch app → tap Map pill in SurfaceTray → MapLibre map renders with default style + can pan/zoom.
- BW-2 done when: fresh install → no models downloaded → press PTT → Settings shows "Engine: Fake, no STT". Download Vosk → wait → press PTT again → Settings shows "Engine: Vosk". `SttDispatchInvariantTest` includes new race-coverage test.
- BW-3 done when: user confirms specific symptom is reproducible, fix lands, user confirms it works.
- All three: `./gradlew :app:assembleDebug` passes; install on RFCY61HG0WB and smoke-test each fix.
- Three commits: `fix(map): BW-1 — wire Map surface into nav graph`; `fix(voice): BW-2 — guard STT init against missing models`; `fix(timer): BW-3 — <symptom-driven>` (after user clarifies).
