# Phantom Companion v2 — Phase 3+ Cohesion & Completion Plan

## Context

The companion app is mid-build. The `core-ai` (Gemini SSE + Gemma local), `core-data` (Room + SQLCipher), `core-net` (Ed25519/X25519/Argon2id + Ktor REST + WebSocket) modules are **fully real** and wired through `AppContainer` to working ViewModels. Pairing, AI completion, profile creation, and live WS event flow are end-to-end functional.

But the surface **feels uncooked** because:

1. **Navigation is a boolean flag** (`PhantomRoot()` toggles `showPair: Boolean`) — no `NavHost`, no route table, fragile.
2. **Stub modules instantiated in production code:** `core-context` (12-line marker), `core-sensor` (59-line marker), `core-bridge` (409 lines of empty class shells — `WireGuardBridge.setConfig()` returns success without doing anything; `TailscaleBridge.isTailscaleAvailable()` hardcoded `false`; `PhantomRelay` has no socket code). `BridgeModule` is built in `AppContainer` and never read.
3. **Visible widget placeholders:** `ArMapWidget.kt:33` renders a text label not AR; `MapWidget.kt:82` has circle rendering commented out; `VisionBubble.kt:24` is a "simulation/placeholder for camera feed".
4. **Service-layer TODOs the user can feel:** `HearablesBridge.kt:54,58` (acoustic model switch, mute), `FloatingOrbService.kt:61` (orb not rendered).
5. **`ProfileShell.kt:86`** has a "Bypass Launcher for now, just pick the first profile" hack with commented-out `setActive()`.
6. **Wear module** is build-graph only — no `DataLayer`/`MessageClient` integration.

**Outcome we want:** the app reads as a finished, cohesive product where every visible surface is backed by real logic, and the scaffolding modules do real work. User chose to **keep all stub files** (deprecate/disable, don't delete) so they remain a substrate for future phases.

---

## Plan Overview

7 phases, sequenced so each unblocks the next. Estimated 6–8 weeks of focused work.

| # | Phase | Status | Module(s) | Goal |
|---|-------|--------|-----------|------|
| A | Structural foundation | ✅ DONE | `app/`, `feature-onboarding` | Real Compose `NavHost`, ProfileLauncher, deprecate dead surface |
| B | Sensor reality | ✅ DONE (partial) | `core-sensor` | GPS+IMU+MicRms (BLE+WiFi+PPG deferred to follow-up) |
| C | Context engine | ✅ DONE (foundation) | `core-context` | DecisionTree v2 + StateMachine + 3 nodes (UI integration deferred) |
| D | Bridge layer | pending | `core-bridge` | WireGuard/Tailscale/Relay real impls, surfaced in Settings |
| E | Vision & TTS premium | pending | `core-vision`, `core-voice` | MediaPipe Hands+FaceMesh, ARCore overlay, StyleTTS2 runtime |
| F | Wear DataLayer | pending | `wear/`, `app/` | MessageClient + DataClient sync (profile, vitals, commands) |
| G | Surface polish | partial (G1 ✅) | `feature-stream`, `core-design` | G1 MapWidget circles done; VisionBubble CameraX, FloatingOrb pending |

**Session 1 delivered:** Phase A (3 sub-tasks) + Phase B (4 sub-tasks, sources GPS/IMU/MicRms only) + Phase C foundation + Phase G1. All builds clean, `:core-context:test` passes. All gated behind BuildConfig flags (`ENABLE_SENSOR`, `ENABLE_CONTEXT`, `ENABLE_BRIDGE`, ...) defaulting to `false` until on-device verification.

---

## Phase A — Structural Foundation (Week 1)

**Why first:** every later phase wires new screens/state. Without a real nav graph and a clean ProfileLauncher, each new feature would re-add boolean hacks.

### A1. Replace boolean nav with Compose Navigation

Create routes table in new `app/src/main/java/local/phantom/companion/navigation/PhantomNavGraph.kt`:

```
Routes:
  onboarding/{step}      → OnboardingScreen states
  launcher               → ProfileLauncher (replaces bypass hack)
  pair/scan              → PairScreen (QR mode)
  pair/manual            → PairScreen (JSON mode)
  stream                 → StreamSurface (chat tab)
  stream/map             → MapTab
  stream/godmode         → GodModeOverlay
  settings               → SettingsDialog (keep as dialog or promote)
```

- Add `androidx.navigation:navigation-compose` to `app/build.gradle.kts` (gradle/libs.versions.toml).
- Refactor `MainActivity.kt:onCreate` → wrap `NavHost` instead of `PhantomRoot()`.
- Delete `PhantomRoot()` boolean toggle in `MainActivity.kt`.
- Refactor `StreamNav.kt` map/stream tab switch to nested nav graph (`stream/{tab}`).

**Critical files:**
- `app/src/main/java/local/phantom/companion/MainActivity.kt` (84 → ~60 lines)
- `app/src/main/java/local/phantom/companion/ui/StreamNav.kt:235-237` (Command dispatch retained, tab logic replaced)
- New: `app/src/main/java/local/phantom/companion/navigation/PhantomNavGraph.kt`
- New: `app/src/main/java/local/phantom/companion/navigation/Routes.kt` (sealed class)

### A2. ProfileLauncher (kill the bypass hack)

Real launcher screen for multi-profile devices.

- `app/src/main/java/local/phantom/companion/ui/ProfileShell.kt:86` — replace bypass with navigation to `launcher` route.
- New: `app/src/main/java/local/phantom/companion/ui/launcher/ProfileLauncherScreen.kt`
  - Lazy grid of profile avatars, "Active" indicator, long-press → context menu (rename, delete, set active).
  - Calls `profileStore.setActive(id)` (already real in `core-data/ProfileStore.kt:30-35`).
  - Reuses `GlassCard` from `core-design`.

### A3. Deprecate (don't delete) dead modules in `AppContainer`

In `app/src/main/java/local/phantom/companion/data/AppContainer.kt:145`:

- Wrap `BridgeModule(...)` instantiation in `if (BuildConfig.ENABLE_BRIDGE)` flag (default `false`). Keep file.
- Annotate `core-bridge/src/main/java/local/phantom/companion/core/bridge/BridgeModule.kt` and all sub-class shells with `@Deprecated("Phase D scaffold — will be reimplemented")`.
- Same for `core-context/Module.kt`, `core-sensor/Module.kt` until they are filled in this plan.
- Add `BuildConfig.ENABLE_BRIDGE`, `ENABLE_CONTEXT`, `ENABLE_SENSOR` (default `false`) — flipped per-phase as each lands.

### A4. Verification

- `./gradlew :app:assembleDebug` succeeds.
- Manual: cold start → launcher (if multi-profile) → stream. Pair flow reachable from settings.
- Back-stack works correctly in pair → stream → settings → back.
- `feature-onboarding` integration tests still pass (`feature-onboarding/src/test`).

---

## Phase B — Sensor Reality (`core-sensor`, Week 2)

**Why second:** context engine (Phase C) and bridge layer (Phase D) both consume sensor streams. Sensors first → cascading enablement.

### B1. MobileSensorAdapter

Replace 59-line marker with a real adapter exposing a `SharedFlow<SensorBatch>` consumed by:
- `PhantomViewModel` (vitals row UI)
- `core-context` ContextEngine (Phase C input)
- `PhantomApi.uploadSensorBatch()` (already declared in `app/.../net/PhantomApi.kt`, currently a stub call site)

**New files in `core-sensor/src/main/java/local/phantom/companion/core/sensor/`:**

```
MobileSensorAdapter.kt           — orchestrator, Service-bound
sources/GpsSource.kt             — FusedLocationProviderClient
sources/ImuSource.kt             — SensorManager (TYPE_ACCELEROMETER, GYROSCOPE, ROTATION_VECTOR)
sources/MicRmsSource.kt          — AudioRecord, 50Hz RMS sampling (no audio retention)
sources/BleSource.kt             — BluetoothLeScanner, beacons
sources/WifiSource.kt            — WifiManager.scanResults (rate-limited per OS)
sources/PpgSource.kt             — HealthServices PassiveListenerService (proxies Wear PPG, Phase F bridge)
SensorBatch.kt                   — domain model (timestamp, gps, imu, mic_rms, ble[], wifi[], ppg)
SensorPermissions.kt             — runtime permission declarations
```

### B2. Permissions & manifest

- Update `app/src/main/AndroidManifest.xml` with required permissions: `ACCESS_FINE_LOCATION`, `ACTIVITY_RECOGNITION`, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `RECORD_AUDIO`, `BODY_SENSORS`, plus foreground service type `dataSync|location|health`.
- New: `app/.../service/SensorService.kt` foreground service hosting `MobileSensorAdapter`.
- Add a permission rationale screen in onboarding (post-PIN, before pair offer): `feature-onboarding/.../ui/PermissionsStep.kt`.

### B3. Wire to AppContainer & batch upload

- `AppContainer.kt:145` — instantiate `MobileSensorAdapter` if `BuildConfig.ENABLE_SENSOR`.
- New: `app/.../data/SensorUploader.kt` — buffer 10-second batches, post to `/api/v1/sensors/mobile_batch` via existing `PhantomApi`.
- Surface live values in `VitalsRow.kt` (BPM from PPG, breath proxy from accelerometer chest displacement, stress from HRV).

### B4. Verification

- Manual: grant permissions → vitals row updates with real BPM (fallback to mock if Wear not paired).
- Network inspector: verify `mobile_batch` POST every 10s with non-empty payload.
- Battery test: 30 min in foreground, sensor service ≤ 4% drain.
- Unit tests: `core-sensor/src/test/java/.../MobileSensorAdapterTest.kt` covers backpressure (>10Hz IMU not buffered unbounded).

---

## Phase C — Context Engine (`core-context`, Week 2–3, parallel-ish with B)

**Why now:** context engine needs sensor stream (B) and outputs to AI router (already exists). Without it, Stream commands have no situational awareness.

### C1. DecisionTree v2

`core-context/src/main/java/local/phantom/companion/core/context/`:

```
ContextEngine.kt                 — main orchestrator, mirrors phantom-os ContextEngine
StateMachine.kt                  — state transitions (FOCUS/SENTINEL/GHOST + sub-states)
DecisionTree.kt                  — v2: weighted, async, node DSL
nodes/                           — domain decision nodes
  TimeOfDayNode.kt
  LocationNode.kt
  MotionNode.kt
  AmbientAudioNode.kt
  CalendarNode.kt                — uses ContentResolver for calendar provider
EventStream.kt                   — outbound: ContextSnapshot every 30s or on transition
```

Reuse `LocalStateAccent` in `core-design/theme/PhantomTheme.kt` — already wired for FOCUS/SENTINEL/GHOST visual changes. Just emit transitions.

### C2. Wire into StreamViewModel and ambient services

- `feature-stream/.../StreamViewModel.kt` — inject `ContextEngine`, attach inferred state to every `AIIntent` for context-aware prompts.
- `feature-ambient/.../HearablesBridge.kt:54,58` — wire TODO for acoustic model switch: when context = FOCUS, switch to noise-suppression model; SENTINEL → wake-word-only; GHOST → mute STT.
- Settings dialog: add "Show inferred state" debug toggle in `app/.../settings/SettingsDialog.kt`.

### C3. Verification

- Test fixture: replay 1h of mock SensorBatch → assert state transitions match expected timeline.
- Manual: walk vs sit → state pill in `StatePill.kt` updates.
- Feature flag `ENABLE_CONTEXT=true` flipped after C2.

---

## Phase D — Bridge Layer (`core-bridge`, Week 4–6)

**Why later:** highest implementation cost; depends on stable sensor + context for proximity/handoff logic.

### D1. WireGuard real

`core-bridge/.../WireGuardBridge.kt:23-26` — replace stub with real `com.wireguard.android:tunnel` integration:
- Parse `WireGuardConfig` to `com.wireguard.config.Config` via `Config.parse()`.
- Call `backend.setState(tunnel, Tunnel.State.UP, config)`.
- Expose `Flow<TunnelState>` for UI.
- Add `wireguard-android` dependency to `core-bridge/build.gradle.kts`.

### D2. Tailscale real

`core-bridge/.../TailscaleBridge.kt:15-18` — integrate Tailscale Android SDK:
- Bind to `IPNService` from `com.tailscale.ipn`.
- Replace hardcoded `false` with actual VPN service availability check.
- Surface peers list, latency.

### D3. Relay socket

`core-bridge/.../PhantomRelay.kt:33` — real socket relay:
- Server URL from `PairedDevice.relayUrl`.
- TLS socket with cert pinning (reuse `core-net` cert utilities).
- Bidirectional frame relay, exposed as `Flow<RelayFrame>`.

### D4. Other bridge classes

Implement the rest (`HandoffManager`, `OffloadEngine`, `AnonymousP2P`, `ProximityDrop`, `EventMesh`, `TrustLend`, `GuardianProtocol`, `TrustGraph`, `CooperativeCalendar`):
- `ProximityDrop`: BLE advertise + scan, payload encrypted with X25519 (reuse `core-net/X25519.kt`).
- `HandoffManager`: WS channel `handoff` already declared in `PhantomLink.kt:55`. Wire to UI continuation prompt.
- `OffloadEngine`: route compute-heavy intents (large image inference) to paired desktop via `PhantomRelay`.
- `EventMesh`: pubsub over relay; reuse Ktor.
- `TrustLend`, `GuardianProtocol`, `TrustGraph`, `CooperativeCalendar`: thin domain wrappers around `VaultStore` + relay channels — implement minimum viable per phantom-os contracts.

### D5. UI surfaces

- `app/.../settings/SettingsDialog.kt` — new "Bridge" section: VPN toggles, relay status, peer list.
- New: `feature-godmode/.../ui/BridgeDashboard.kt` — full-page diagnostic view.

### D6. Verification

- Manual: enable WireGuard → `ip a` shows wg interface; ping paired host succeeds.
- Tailscale: peer list populates, MagicDNS resolves.
- Relay: send test frame phone → desktop, observe echo.
- Feature flag `ENABLE_BRIDGE=true` after D5.

---

## Phase E — Vision & TTS Premium (Week 6–7)

### E1. MediaPipe Hands + FaceMesh

`core-vision/src/main/java/.../MediaPipeVisionEngine.kt` — currently declared, fill in:
- Load `hand_landmarker.task` and `face_landmarker.task` (extend `core-ai/ModelManager.kt` to download these).
- Camera2 / CameraX preview source.
- Expose `Flow<HandLandmarks>` and `Flow<FaceMesh>` to `feature-godmode`.

### E2. ARCore replace AR placeholder

`feature-stream/.../widget/ArMapWidget.kt:33` — replace text label:
- `ArSceneView` from Google AR (or Filament+ARCore via existing `FilamentOrbView` integration in `core-design`).
- Render proximity dots from `ProximityDrop` (Phase D) anchored in world space.

### E3. StyleTTS2 ONNX runtime

`core-voice/.../tts/StyleTts2OnnxRoute.kt` — currently stub per `Phase 2-B-2 comment`:
- ONNX Runtime mobile (`onnxruntime-android` already in `core-ai` deps).
- Load `styletts2.onnx` via `ModelManager`.
- Implement `synthesize(text): Flow<AudioChunk>` mirroring `RoutedTts` interface.
- `RoutedTts` already routes premium → fallback; flipping a flag activates StyleTTS2.

### E4. Verification

- AR widget: scan environment, see anchored markers.
- Hand gestures: pinch in godmode dashboard rotates orb.
- StyleTTS2 voice: play sample, A/B with system TTS in settings.

---

## Phase F — Wear DataLayer (Week 7–8)

### F1. Phone side

New: `app/.../wear/WearableManager.kt`:
- `MessageClient.sendMessage()` for commands.
- `DataClient.putDataItem()` for syncable state (active profile, vitals snapshot, latest stream message).
- `CapabilityClient` to detect Wear node presence.

### F2. Wear side

`wear/src/main/java/.../`:
- `WearMainActivity.kt` (new): Compose-for-Wear shell with mini orb + vitals + last 3 stream items.
- `WearableListenerService.kt` for receiving phone data.
- `WearVoiceCommand.kt`: PTT via Wear mic → forward audio frames over `MessageClient`.
- Pull `core-design` `OrbView` into Wear-compatible variant (`OrbViewWear.kt`) — strip Filament 3D, use 2D Canvas only.

### F3. Verification

- Pair Wear device.
- Send command from Wear → response on phone.
- Profile switch on phone → Wear updates within 2s.

---

## Phase G — Surface Polish (Week 8)

### G1. Real MapWidget

`feature-stream/.../widget/MapWidget.kt:82` — restore commented-out circles:
- MapLibre GeoJSON source + circle layer.
- Render proximity dots, paired-host markers, geofences.

### G2. Real VisionBubble

`feature-stream/.../widget/VisionBubble.kt:24` — replace simulation:
- `CameraX Preview` composable embedded in bubble.
- Emit MediaPipe overlays from Phase E1.
- Privacy: 5-second auto-dismiss timer.

### G3. FloatingOrb real render

`app/.../service/FloatingOrbService.kt:61` — currently TODO:
- Use `WindowManager.addView()` with `OrbView` Composable hosted in `ComposeView`.
- Drag to reposition, double-tap to expand to stream, long-press to hide.

### G4. Animation & error pass

- Add transition animations between routes (Compose Navigation `enterTransition`/`exitTransition`).
- Shared element transitions: orb on stream → orb expanded.
- Error states for: AI route timeout, sensor permission denied, Wear disconnected, bridge down. Reuse `NoticeBubble` pattern in `feature-stream`.
- Empty state hardening: every `LazyColumn` gets a real empty state (already in `StreamScreen.kt:185` — extend to others).

### G5. Verification

- Run full UX path: cold install → onboarding → permissions → pair → first message → settings tour → bridge enable → wear pair.
- Performance: stream scroll at 90fps on Pixel 7 / equivalent.
- A11y: TalkBack covers every interactive element.

---

## Critical Files Reference

| File | Reason it matters this plan |
|------|------------------------------|
| `app/src/main/java/local/phantom/companion/MainActivity.kt` | Phase A1 root rewrite |
| `app/src/main/java/local/phantom/companion/data/AppContainer.kt` | All phases — DI graph extension |
| `app/src/main/java/local/phantom/companion/ui/ProfileShell.kt` | Phase A2 |
| `app/src/main/java/local/phantom/companion/ui/StreamNav.kt` | Phase A1 + G4 |
| `app/src/main/java/local/phantom/companion/net/PhantomLink.kt` | Phases B/C/D — channel subscriptions |
| `core-sensor/src/main/java/.../Module.kt` | Phase B (full rewrite) |
| `core-context/src/main/java/.../Module.kt` | Phase C (full rewrite) |
| `core-bridge/src/main/java/.../BridgeModule.kt` | Phase D — implements all sub-classes |
| `core-vision/src/main/java/.../MediaPipeVisionEngine.kt` | Phase E1 |
| `core-voice/src/main/java/.../tts/StyleTts2OnnxRoute.kt` | Phase E3 |
| `wear/src/main/java/.../WearMainActivity.kt` | Phase F2 (new file) |
| `feature-stream/.../widget/MapWidget.kt` | Phase G1 |
| `feature-stream/.../widget/VisionBubble.kt` | Phase G2 |
| `feature-stream/.../widget/ArMapWidget.kt` | Phase E2 |

## Existing utilities to reuse (do NOT recreate)

- `core-design/theme/PhantomTheme.kt` — `LocalPhantomTheme`, `LocalStateAccent`, `GlassCard`, `OrbView`.
- `core-net/crypto/*` — `Ed25519`, `X25519`, `Argon2id`, `AesGcm`, `Hkdf` (use for bridge auth).
- `core-net/PinHasher.kt` — already correct, no changes.
- `core-data/ProfileStore.kt` — `create/setActive/delete` already real.
- `core-data/PhantomDatabase.kt` — Room+SQLCipher, extend with new entities (`ContextSnapshot`, `SensorBatch`, `BridgePeer`) via migrations.
- `core-ai/ModelManager.kt` — extend for `hand_landmarker.task`, `face_landmarker.task`, `styletts2.onnx`.
- `core-ai/RoutedAIRouter.kt` — pattern to mirror for `RoutedTts` (already exists), and a new `RoutedSensorSink`.
- `app/.../net/PhantomApi.kt:91-105` — pattern for new endpoints.
- `app/.../net/PhantomLink.kt:55` — extend `subscribe(channels)` with new channel names per phase.
- `feature-stream/.../widget/NoticeBubble.kt` — reuse for all error states in G4.

## Build & feature flags

`app/build.gradle.kts` — add `buildConfigField` declarations:
```kotlin
buildConfigField("Boolean", "ENABLE_SENSOR",  "false")  // flipped after Phase B
buildConfigField("Boolean", "ENABLE_CONTEXT", "false")  // flipped after Phase C
buildConfigField("Boolean", "ENABLE_BRIDGE",  "false")  // flipped after Phase D
buildConfigField("Boolean", "ENABLE_VISION_PREMIUM", "false")  // flipped after Phase E
buildConfigField("Boolean", "ENABLE_WEAR_SYNC", "false")  // flipped after Phase F
```

Each phase ends by flipping its flag to `true` after verification passes.

## Verification (overall)

End-to-end after all phases:

```bash
./gradlew :app:assembleDebug :wear:assembleDebug
./gradlew :core-sensor:test :core-context:test :core-bridge:test :core-vision:test :core-voice:test
./gradlew :app:connectedAndroidTest    # instrumented integration tests
```

Manual end-to-end walkthrough:

1. Cold install on phone + Wear.
2. Complete onboarding (name, PIN, permissions, optional pair).
3. Pair to phantom-os server via QR — observe `/pair/claim` 200, JWT stored.
4. WS link establishes — vitals row populates from real sensor batches.
5. Send AI prompt — Gemini SSE response with context state attached (FOCUS/SENTINEL/GHOST).
6. Toggle WireGuard in settings — interface comes up.
7. AR widget anchors a proximity beacon in physical space.
8. Wear: orb mirrors phone state; PTT from Wear works.
9. Battery: 8h normal use ≤ 18% drain.
10. Crash-free session score ≥ 99.5% over 50 simulated sessions.

## Out of scope (explicitly)

- Removing or rewriting `core-ai`, `core-data`, `core-net`, `core-voice` STT — they are real and stable.
- New AI models beyond what `ModelManager` already supports.
- Server-side phantom-os work (this is the companion only).
- Translation/i18n (Ukrainian copy stays as-is).
- Full DI rewrite to Hilt — `AppContainer` manual DI is appropriate for ~10 nodes.
