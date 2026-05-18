# Phase 1.5 — Surface Ports

## Context

Phase 1 (A–G) closed: WS pipeline, multi-thread Stream, proactive insights, emotion-tone morph, proactive chat, lock-vault verb, handoff sheet — all live and tested. The prototype in `/tmp/phantom-design-4/phantom-app2/project/` exposes ~30 surfaces; Phase 1 surfaced 6 of them (Stream + its widgets + handoff). Phase 1.5 ports the next 7 standalone surfaces (Onboarding morph, Pair AR, Vault, Settings, Decision Diary, Motion Catalog, Whisper Line) so the operator can reach every Familiar capability the Phase-1 backend already serves. Out of scope (Phase 2+): PdfChat, Calendar, SmartHome, SleepDashboard, ImageGen, MemoryPalace 3D, DreamJournal, NegotiationCourt, AmbientHealth, Subliminal Pulse, Margin Glow, Family Hive UI.

Operator confirmed two preconditions:
- **SurfaceTray does not exist.** Build it as **Phase 1.5-0** before any surface port lands so 1.5-B…G can register their pills uniformly.
- **QR scanner swap.** Phase 1.5-B replaces ZXing in `PairScreen.kt` with `MLKitVisionEngine` (already in `:core-vision`); ML Kit's bounding-box API drives the AR-bracket snap.

All commits land green: `./gradlew testDebugUnitTest :app:assembleDebug :app:lintDebug`. Atomic — one commit per phase, message `feat(surface): Phase 1.5-X — <name>`. Ukrainian copy from prototype goes verbatim into `app/src/main/res/values/strings.xml`. Spring physics `stiffness=180f, dampingRatio=0.75f` already exists at `core-design/src/main/java/local/phantom/companion/core/design/theme/EmotionTone.kt:44-53` — reuse `emotionSpringFloat()` / `emotionSpringColor()` everywhere.

## Reference patterns to reuse (do not reinvent)

- `feature-stream/src/main/java/.../ui/widget/ChartWidget.kt` — composable widget pattern with JSON kind dispatch.
- `feature-stream/src/main/java/.../ui/items/HandoffSheet.kt` — Material3 ModalBottomSheet pattern from Phase 1-G.
- `feature-ambient/src/main/java/.../service/FloatingOrbService.kt` — Service + ComposeView + WindowManager template; copy its lifecycle/state-registry boilerplate for `WhisperLineService`.
- `core-design/.../theme/EmotionTone.kt` — spring physics constants (already match brief).
- `feature-onboarding/.../ui/OnboardingNarration.kt` — already drafted (untracked); plug in during 1.5-A.
- `core-vision/.../engine/MLKitVisionEngine.kt:22` — already configured BarcodeScanner; expose detection flow for 1.5-B.
- `app/src/main/java/.../navigation/PhantomNavGraph.kt` — destination wiring template; mirror for new routes.

---

## Phase 1.5-0 — SurfaceTray foundation

**Why first:** every later phase registers a pill here.

**New files:**
- `feature-stream/src/main/java/.../ui/SurfaceTray.kt` — `@Composable fun SurfaceTray(open, onClose, current: SurfaceId, onSelect: (SurfaceId) -> Unit)`. Bottom-sheet glass card; pill grid; mirror prototype `phase2.jsx#SurfaceTray:856-940`. Pills filtered by `BuildConfig.DEBUG` for dev-only motion catalog.
- `feature-stream/src/main/java/.../domain/SurfaceId.kt` — sealed enum: `Stream, Onboarding, Pair, Vault, Diary, Motion, Whisper, Settings`. `label: String`, `requiresPair: Boolean`, `devOnly: Boolean`.
- `feature-stream/src/test/java/.../SurfaceIdTest.kt` — verify pill filter by debug flag, label copy verbatim.

**Edit:**
- `app/src/main/java/.../ui/system/SystemPulseHeader.kt` — wrap state-label `Text` in a `combinedClickable` (or `pointerInput { detectTapGestures(onLongPress = ...) }`). Add `onLongPress: () -> Unit = {}` param.
- `app/src/main/java/.../ui/StreamNav.kt` — add `var trayOpen by remember { mutableStateOf(false) }`. Pass `onLongPress = { trayOpen = true }` to header. Render `SurfaceTray(trayOpen, ...) { id -> navController.navigate(routeFor(id)) }`.
- `app/src/main/java/.../navigation/Routes.kt` — add stub routes `Vault`, `Diary`, `Motion`, `Whisper` (no destinations yet — added in their own phases).
- `app/src/main/java/.../navigation/PhantomNavGraph.kt` — accept `navController` in `StreamNav`; placeholder destinations (`composable(...) { /* TODO Phase 1.5-X */ }`) so navigate() doesn't crash if invoked early.

**Tests:** SurfaceIdTest. Routing test for SystemPulseHeader long-press is UI — manual.

**Verification:** Build green; long-press "ВАРТА" header on existing build → tray slides up showing `stream` only (other pills disabled until their phases land).

---

## Phase 1.5-A — Onboarding 6-step morph polish

**Why:** state machine works (`OnboardingViewModel`); current UI is a `when` switch with no transition + no narration. Prototype `surfaces.jsx#Onboarding:41-200` adds Orb dwell, crossfade, narration, progress whispers.

**Edit:**
- `feature-onboarding/src/main/java/.../ui/OnboardingScreen.kt` — wrap the `when` body in `Crossfade(targetState = state, animationSpec = tween(600))` so each state morphs in/out. Inside, render an Orb fixed at top (240dp during PermissionStep per prototype line 200; 180dp during CreatingProfile; 140dp default). Position `top` interpolated by `animateFloatAsState(emotionSpringFloat())` keyed on `state::class`.
- `feature-onboarding/src/main/java/.../ui/OnboardingScreen.kt` — wire `OnboardingNarration.narrationLineFor(state)` into `LaunchedEffect(state::class)`. TTS via `AppContainer.ttsEngine` if `voicePrefs.ttsEnabled.value`. Skip narration in test builds (no model). Use existing `container.voicePrefs` injection pattern.
- `feature-onboarding/src/main/java/.../ui/OnboardingScreen.kt` — `CreatingProfileIndicator` (lines 124-153) replace `CircularProgressIndicator` with: deeper Orb breath (period 4s), expanding ring overlay scaled by `progress` collected from a new `state.progress: Float` (already provided by viewmodel — verify) or local `produceState` mirroring viewmodel's 0→1 timer. Render `creatingProfileWhisper(progress)` as the `inkSecondary` text below the Orb.
- `feature-onboarding/src/main/java/.../ui/PermissionExplanationScreen.kt` — bump central Orb to 240dp; align with prototype lines 180-200 (kicker chip "FAMILIAR ПРОСИТЬ", glass hero card).

**Tests:**
- `feature-onboarding/src/test/java/.../ui/OnboardingNarrationTest.kt` — assert `narrationLineFor` returns the verbatim Ukrainian copy for each state.
- `feature-onboarding/src/test/java/.../ui/CreatingProfileWhisperTest.kt` — boundary tests at progress 0.0/0.29/0.30/0.54/0.55/0.79/0.80/1.0.

**Add `OnboardingNarration.kt` to git** (currently untracked — must be staged in this commit).

---

## Phase 1.5-B — Pair scanner with AR brackets (ML Kit swap)

**Why:** `PairScreen.kt` uses ZXing today (works, ~300 LOC of decode boilerplate). MLKitVisionEngine already wired in `:core-vision`. ML Kit returns `Barcode.boundingBox: Rect` + `cornerPoints: Array<Point>` — needed to drive AR-bracket snap.

**New files:**
- `core-vision/src/main/java/.../engine/MLKitVisionEngine.kt` — extend with `fun barcodeFlow(imageProxy): Flow<DetectedBarcode>` if not present; data class `DetectedBarcode(rawValue: String, bbox: Rect, corners: List<Offset>)`.
- `app/src/main/java/.../ui/screens/pair/ARBrackets.kt` — composable: 4 corner brackets (22dp), gold (`accent.color`), animated with `animateOffsetAsState(emotionSpringColor())`. `locked: Boolean` thickens stroke to 2.5dp + ripple-bloom on lock per `surfaces.jsx#ARBrackets:424-455`.
- `app/src/test/java/.../ui/screens/pair/PairScannerStateMachineTest.kt` — `scanning → locking → claiming → done` phase transitions, prototype lines 291-327.

**Edit:**
- `app/src/main/java/.../ui/screens/PairScreen.kt` — strip ZXing imports; `QrCameraSurface` keeps CameraX preview but ImageAnalysis dispatches to `MLKitVisionEngine.barcodeFlow`. Map detected bbox to viewport coords. Drive `ARBrackets` with smoothed bbox center via `emotionSpringFloat()`. On detect: phase = LOCKING (700ms) → CLAIMING (existing claim flow) → DONE (orb expands, ChimeBell sound deferred — no audio infra yet, leave a comment marker).
- `app/build.gradle.kts` (if zxing dep removable cleanly) — keep ZXing for now; just stop using it in PairScreen. Dep cleanup is its own phase later.

**Acceptance:** Manual — connected device, scan phantom-os QR → brackets snap to QR center, lock animation fires, existing claim flow completes. **Verify Phase 0 E2E playbook still works** (memory entry `e2e_playbook.md`).

---

## Phase 1.5-C — VaultGate full UI

**Why:** `VaultStore` exists (`core-data/.../vault/VaultStore.kt`) with CRUD + locked StateFlow from Phase 1-F. No UI surface yet.

**New files:**
- `feature-stream/src/main/java/.../ui/vault/VaultScreen.kt` — full-screen GHOST-tinted background; biometric gate (use existing `app/src/main/java/.../auth/AndroidBiometricGate.kt`); on success, `LazyColumn` of glass cards. Each card: kind kicker, label, `••••<last4>` preview, "копія · 6с" button. Long-press → 2nd biometric → reveal inline. Header: "VAULT · ПРИМАРА" + "слідів не залишаю". Layout per prototype `surfaces.jsx#VaultGate:457-598`.
- `feature-stream/src/main/java/.../ui/vault/VaultViewModel.kt` — collects `VaultStore.getEntries()`, holds `revealed: StateFlow<Map<String, Long>>` (id → reveal-expires-at-epoch-ms). Dispatch: `Reveal(id, biometricSession)`, `CopyToClipboard(id, ttlSeconds=6)`. Background timer auto-clears clipboard via `ClipboardManager.clearPrimaryClip()` (API 28+) at `expiresAt`.
- `feature-stream/src/test/java/.../vault/VaultViewModelTest.kt` — reveal expires after 6s; clipboard is cleared; second reveal request resets timer; lockNow() collapses all reveals.

**Edit:**
- `app/src/main/java/.../navigation/Routes.kt` — `Vault` route already added in 1.5-0; now plug destination.
- `app/src/main/java/.../navigation/PhantomNavGraph.kt` — add `composable(Routes.Vault.path) { VaultDestination(navController) }`.
- `app/src/main/java/.../ui/StreamNav.kt` — when `LocalEmotionTone` shifts to GHOST, header narrative should say "vault режим — слідів не залишаю" (state-routing already in place).

**Strings (verbatim, prototype lines 461-468, 511, 514):** `vault_kicker = "VAULT · ПРИМАРА"`, `vault_subtitle = "слідів не залишаю"`, etc. Add to `strings.xml`.

**Tests:** VaultViewModelTest covers reveal/copy/clear timing.

---

## Phase 1.5-D — Settings conversational sheet

**Why:** `SettingsDialog.kt` (694 LOC) is a toggle-grid dialog. Prototype `phase3.jsx#ConvSettingsSheet:922-966` is conversational — each section text-peeks the full state.

**New files:**
- `app/src/main/java/.../ui/settings/ConvSettingsSheet.kt` — `ModalBottomSheet`, drag-down to close, sections per prototype lines 924-930: AI Brain, Voice, Theme, Connection, Permissions, Profile. Each section is a tappable row with kicker + title + body text + cta-link. Tap row → expands inline with relevant controls (key field for AI Brain, switch for TTS, theme picker, etc.). State stored in `var expandedSection by remember { mutableStateOf<String?>(null) }`.
- `app/src/main/java/.../ui/settings/ConvSettingsBody.kt` — pure functions producing the body text from current state (e.g., `"23 запити сьогодні · ключ закінчується на ${key.takeLast(4)}"` for AI Brain). Unit-testable.
- `app/src/test/java/.../ui/settings/ConvSettingsBodyTest.kt` — text generation invariants (no key → "не підключено"; key ending → last 4 chars; theme → current theme name).

**Edit:**
- `app/src/main/java/.../ui/StreamNav.kt` — replace `if (showSettings) { SettingsDialog(...) }` with `if (showSettings) { ConvSettingsSheet(...) }`. All current callbacks (onSetTheme, onSetTtsEnabled, onSaveGeminiKey, etc.) keep their existing signatures — just rerouted.
- `app/src/main/java/.../ui/settings/SettingsDialog.kt` — **keep file**, do not delete. Mark `@Deprecated("Use ConvSettingsSheet from Phase 1.5-D")` so any forgotten caller still compiles. Removal is a later cleanup.

**Strings (prototype lines 924-929):** add `settings_ai_brain_kicker`, `settings_ai_brain_title_template`, `settings_voice_kicker`, etc.

---

## Phase 1.5-E — Decision Diary

**Why:** Brand-new surface. No backend dependency — pure local DB.

**New files:**
- `core-data/src/main/java/.../diary/DecisionEntity.kt` — `@Entity(tableName="decisions")` columns: `id (PK), title, decidedAt: Long, context, alternatives (CSV), chosenReason, lastReviewedAt: Long?, status: String` (one of "active" / "stale").
- `core-data/src/main/java/.../diary/DecisionDao.kt` — `getAll(): Flow<List<DecisionEntity>>`, `insert`, `update`, `delete(id)`.
- `core-data/src/main/java/.../diary/DecisionStore.kt` — wrapper consistent with `VaultStore`/`ProfileStore`.
- `core-data/src/main/java/.../Migration_3_4.kt` — `Migration(3, 4)` running `CREATE TABLE decisions (...)`.
- `feature-stream/src/main/java/.../ui/diary/DecisionDiaryScreen.kt` — full-screen surface; LazyColumn of glass cards; tap-expand for full context+alternatives+reason. Stale entries show "circumstances changed" alert per prototype lines 656-667.
- `feature-stream/src/main/java/.../ui/diary/DecisionDiaryViewModel.kt` — collects `DecisionStore.getAll()`; exposes `entries: StateFlow<List<UiDecision>>`; placeholder logic: `status="stale"` if `lastReviewedAt` null and `decidedAt` > 60d ago.
- `core-data/src/test/java/.../diary/DecisionStoreTest.kt` — round-trip insert/update/delete.
- `core-data/src/test/java/.../Migration_3_4Test.kt` — `MigrationTestHelper` schema test (use existing Room migration test framework or add `androidx.room:room-testing` if missing).
- `feature-stream/src/test/java/.../diary/DecisionDiaryViewModelTest.kt` — stale detection at 59d/60d/61d.

**Edit:**
- `core-data/src/main/java/.../PhantomDatabase.kt:47` — bump version to 4; add `DecisionEntity::class` to `entities`. Replace `.fallbackToDestructiveMigration()` with `.addMigrations(Migration_3_4)`. (This changes the upgrade contract — existing operators preserve their data.)
- `core-data/src/main/java/.../Module.kt` — provide `DecisionStore` from DI.
- `app/src/main/java/.../navigation/{Routes,PhantomNavGraph}.kt` — wire `Routes.Diary` destination.

**Acceptance:** Insert 3 decisions via test fixture; upgrade DB v3→v4 in instrumented test; Compose screen renders; stale alert appears on 60+d entry without `lastReviewedAt`.

---

## Phase 1.5-F — Motion Catalog (dev-only)

**Why:** Operator-facing animation reference per DESIGN_BRIEF XIV. Behind `BuildConfig.DEBUG`.

**New files:**
- `feature-stream/src/main/java/.../ui/motion/MotionCatalogScreen.kt` — list of 10 named animations from prototype `surfaces.jsx#MotionCatalogScene:677-746`: `bracketsQR`, `flowRoute`, `bloomSuccess`, `pulseCoral`, `rippleTap`, `washState`, `breatheStandard`, `breatheDeep`, `glowAmbient`, `pulseAudio`. Each row: animation id + duration. Tap → triggers via `triggerKey++` increment so `key(triggerKey) { ... }` re-runs.
- `feature-stream/src/main/java/.../ui/motion/MotionStage.kt` — fixed-height (220dp) stage with central Orb + per-trigger overlay (matches prototype `MotionStage:747-836`). Each trigger drawn as an `AnimatedVisibility` or `LaunchedEffect`-driven animation. No new physics — reuse `emotionSpringFloat()`.
- `feature-stream/src/test/java/.../ui/motion/MotionCatalogTest.kt` — assert all 10 animation ids exposed; test labels are exact strings.

**Edit:**
- `app/src/main/java/.../navigation/{Routes,PhantomNavGraph}.kt` — add `Routes.Motion` destination, but only register if `BuildConfig.DEBUG`.
- `feature-stream/.../domain/SurfaceId.kt` — `Motion(devOnly = true)` — already gated in `SurfaceTray` filter.

**No DB / wire changes.** No copy strings (animations have id labels in mono).

---

## Phase 1.5-G — Whisper Line overlay service

**Why:** New top-level presence channel per `docs/PRESENCE_AND_CHAT.md §I.2`. Renders agent messages as a 4dp marquee overlay over any app.

**New files:**
- `feature-ambient/src/main/java/.../service/WhisperLineService.kt` — extends `Service`, mirrors `FloatingOrbService.kt` lifecycle template. WindowManager params: `TYPE_APPLICATION_OVERLAY`, `FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCHABLE | FLAG_LAYOUT_NO_LIMITS | FLAG_SECURE`, gravity `TOP|FILL_HORIZONTAL`, height 4dp. ComposeView renders gold-faint TextView with `marquee` modifier (`Modifier.basicMarquee(iterations = Int.MAX_VALUE, spacing = MarqueeSpacing(40.dp))`). Subscribes to `AppContainer.whisperBus: SharedFlow<WhisperText>`.
- `feature-ambient/src/main/java/.../bus/WhisperBus.kt` — `class WhisperBus { private val _flow = MutableSharedFlow<WhisperText>(replay=0, extraBufferCapacity=8); val flow: SharedFlow<WhisperText> = _flow; suspend fun emit(text: WhisperText) }`. Single-instance, owned by `AppContainer`.
- `feature-ambient/src/main/java/.../bus/WhisperText.kt` — `data class WhisperText(val text: String, val priority: Int = 0, val timestampMs: Long)`.
- `feature-ambient/src/test/java/.../bus/WhisperBusTest.kt` — emission ordering, replay=0 (late subscribers don't see prior messages), buffer overflow drops oldest.

**Edit:**
- `app/src/main/AndroidManifest.xml` — declare `<service android:name="local.phantom.companion.feature.ambient.service.WhisperLineService" android:foregroundServiceType="specialUse" android:exported="false" />`. `SYSTEM_ALERT_WINDOW` already declared per existing FloatingOrbService.
- `app/src/main/java/.../data/AppContainer.kt` — instantiate `WhisperBus` and expose.
- `app/src/main/java/.../data/VoicePreferences.kt` — add `whisperLineEnabled: StateFlow<Boolean>` + `setWhisperLineEnabled(value: Boolean)`. Default true.
- `app/src/main/java/.../ui/StreamNav.kt` — mirror the `LaunchedEffect(orbOverlayEnabled)` block for `whisperLineEnabled`: start/stop `WhisperLineService` based on flag + overlay grant.
- `app/src/main/java/.../ui/settings/ConvSettingsSheet.kt` — Voice section adds Whisper Line toggle row.

**Test:** Bus tests are pure JVM. FLAG_SECURE-vs-MediaProjection invisibility is **manual only** — record screen via `adb shell screenrecord`, verify whisper line is absent from the capture. Note this in commit message; not enforceable in CI.

**Strings:** `whisper_settings_label = "Шепіт"`, `whisper_settings_detail = "тонка стрічка над будь-якою апкою · бачиш тільки ти"`.

---

## Files modified across all phases (quick index)

Created (new):
- `feature-stream/.../ui/SurfaceTray.kt`
- `feature-stream/.../domain/SurfaceId.kt`
- `app/.../ui/screens/pair/ARBrackets.kt`
- `feature-stream/.../ui/vault/{VaultScreen,VaultViewModel}.kt`
- `app/.../ui/settings/{ConvSettingsSheet,ConvSettingsBody}.kt`
- `core-data/.../diary/{DecisionEntity,DecisionDao,DecisionStore}.kt`
- `core-data/.../Migration_3_4.kt`
- `feature-stream/.../ui/diary/{DecisionDiaryScreen,DecisionDiaryViewModel}.kt`
- `feature-stream/.../ui/motion/{MotionCatalogScreen,MotionStage}.kt`
- `feature-ambient/.../service/WhisperLineService.kt`
- `feature-ambient/.../bus/{WhisperBus,WhisperText}.kt`
- Tests for each (see per-phase sections).

Edited:
- `app/.../ui/StreamNav.kt` (1.5-0, 1.5-C, 1.5-D, 1.5-G)
- `app/.../ui/system/SystemPulseHeader.kt` (1.5-0)
- `app/.../navigation/{Routes,PhantomNavGraph}.kt` (1.5-0 + each phase that adds a route)
- `app/.../ui/screens/PairScreen.kt` (1.5-B)
- `core-vision/.../engine/MLKitVisionEngine.kt` (1.5-B; only if `barcodeFlow` not present)
- `core-data/.../PhantomDatabase.kt` + `Module.kt` (1.5-E)
- `feature-onboarding/.../ui/{OnboardingScreen,PermissionExplanationScreen}.kt` (1.5-A)
- `feature-onboarding/.../ui/OnboardingNarration.kt` (1.5-A — stage to git)
- `app/.../data/{AppContainer,VoicePreferences}.kt` (1.5-G)
- `app/src/main/AndroidManifest.xml` (1.5-G)
- `app/src/main/res/values/strings.xml` (1.5-A, -C, -D, -G)
- `app/.../ui/settings/SettingsDialog.kt` (1.5-D — `@Deprecated` only)

## Verification

After each phase commit:
```
./gradlew testDebugUnitTest :app:assembleDebug :app:lintDebug
```
Must be all-green. No new warnings introduced beyond the existing 155 lint baseline.

Phase-specific manual checks (only when device connected):
- **1.5-0:** Long-press "ВАРТА" header → tray slides up; tap pill → navigates.
- **1.5-A:** Restart onboarding; observe Orb dwell + crossfades + (if TTS on) Ukrainian narration per state.
- **1.5-B:** Re-run Phase 0 pair E2E (`memory/e2e_playbook.md`); brackets snap to QR; pair claims successfully.
- **1.5-C:** Open Vault from tray; biometric gate; reveal entry; clipboard auto-clears at 6s (`adb shell cmd clipboard get-primary` after 7s should be empty).
- **1.5-D:** Open settings sheet; tap each section; expand panels; save Gemini key; verify it persists.
- **1.5-E:** Insert decision via debug menu; expand card; force lastReviewedAt=null + decidedAt=now-61d → "circumstances changed" alert visible.
- **1.5-F:** Build debug variant; tray shows Motion pill; trigger each animation; verify duration matches.
- **1.5-G:** Toggle Whisper Line on; emit `whisperBus.emit(WhisperText("олег чекає · 23 хв"))` from debug menu; line appears at top of any app; `adb shell screenrecord /sdcard/test.mp4` recorded for 10s — verify line absent from playback.

**After Phase 1.5-G:** Pause. Operator review before Phase 2 (sensing class).
