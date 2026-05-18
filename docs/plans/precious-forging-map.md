# Plan: PHANTOM Companion v2 — Native Android Flagship

## Context

The user wants an ambitious Android app that mirrors the desktop `phantom-os` experience: each user creates their own profile, the app behaves as a real mini-OS (not a chat client), additional profiles can be linked to form an ecosystem, the camera is a control surface, the phone can drive a paired device and vice versa, and the eventual artefact is a freely-distributable APK.

The good news: this exact vision is already documented as the canonical 553-line `docs/MOBILE_PHANTOM_AMBITIOUS.md` (committed `b9ef9ea` 2026-05-02), and Phase 0 of that plan is already merged (`0b93dc4` 2026-05-03 — Gradle composite, 16 core+feature modules, `wear/`, `app/`). The current `phantom-companion/` Capacitor PWA is the v1 lite variant; it cannot deliver the ambitious vision (no foreground service, no TelecomManager, no on-device LLM, no StrongBox keys, no BLE/WiFi-Direct, no Wear OS). The native Compose v2 in `phantom-os/companion-android/` is the flagship.

This plan locks the existing roadmap in, names the next concrete delivery, and adds the public-release concerns that were previously out of scope.

### User decisions confirmed (this turn)

1. **PWA fate** — `phantom-companion/` frozen at v1 (maintenance only). All future mobile work moves to `companion-android/`.
2. **Distribution model** — Free APK, self-host. Each user runs their own `phantom-os` on their own Radxa/server. **No subscription, no payment processor, no cloud-hosted phantom-os offering.** Distribution via direct APK (Telegram channel, repo release, F-Droid).
3. **First public release cut** — After Phase 5 (Driver / cross-device). The WOW moment is phone-controls-desktop + desktop-pulls-phone-sensors; that demo is the launch.
4. **Timeline** — Honour the canonical ~24-week 8-phase plan. Quality over speed.

## Strategy (8-phase native build)

| Phase | Deliverable | Status | Public release? |
|---|---|---|---|
| 0 | Gradle composite scaffold (16 modules), splash, theme tokens | DONE (`0b93dc4`) | — |
| 1 | Identity: 5-step onboarding, PIN/Argon2id/biometric/voice-print, multi-profile switcher, SQLCipher per profile | NEXT | — |
| 2 | First Body: Pulse + Voice + Map + Comms + Vault wired to live `phantom-os` over WS, sensor batches, PTT round-trip | | — |
| 3 | Senses: CameraX, MediaPipe FaceMesh + Hands, ML Kit OCR, MapLibre native, ARCore SENTINEL overlay, geofence, PPG HRV | | — |
| 4 | Brain on Edge: ONNX Runtime Mobile, Gemma 3n-E4B INT4 (~2.6 GB), whisper-tiny, StyleTTS2, hybrid router (Gemini → local sensitive → host's Ollama → on-device) | | — |
| **5** | **Driver: phone keyboard/trackpad + screen mirror + file drop + agent verbs into desktop; desktop pulls phone sensors / mirrors notifications** | | **FIRST PUBLIC APK** |
| 6 | Mesh & Wear: Wear OS module, mDNS host discovery, BLE LE Audio, Ed25519 pair-challenges between phones | | v1.1 update |
| 7 | Hub Mode: optional launcher, lock-screen Familiar widget, Quick Tile, Accessibility Service, Always-On-Display | | v1.2 update |
| 8 | Telecom (opt-in): TelecomManager, SMS/RCS bridge, call transcription, smart screening, voicemail | | v1.3 update |

Phase 5 is the launch milestone: the cross-device control loop is what makes this read as a mini-OS rather than a fancy chat client. Everything before Phase 5 is preparation for that demo; everything after is iterative growth.

## Multi-profile + ecosystem (already designed)

`companion-android/core-data/PhantomDatabase.kt` already has `ProfileEntity` (Argon2id PIN, biometric flag, NFC UID, voice-print hash, role ROOT/OPERATOR/GUEST, behavioral_model encrypted) and `PairedHostEntity` (composite key `(profile_id, host_id)`, capabilities CSV). One profile → many Radxa hosts; one device → many profiles. Long-press avatar → biometric → SQLCipher unlocks the chosen profile. This matches the user's "підв'язати інший профіль (додатково чи початково)" request directly.

`phantom-os` backend already supports multi-user (`User` table, ROOT/OPERATOR/GUEST RBAC, per-user `chat_sessions/memories/vault_cards/alarms/timers/map_pois/location_history`, user_id-scoped WS broadcasts). Backend-side migration is small: add `User.profiles[]` join, `WSClient.profile_id` filter on broadcast, `ContextEngine.active_body` snapshot field — all listed in MOBILE_PHANTOM_AMBITIOUS §439-450.

## Camera + cross-device control (Phase 3 + Phase 5)

Phase 3 plumbs the camera as a sensor: FaceMesh → desktop Familiar peek/wave, Hands → `agent.gesture` verb, ML Kit OCR → chat input, ARCore + MapLibre → SENTINEL map overlay, RGB PPG → 30s heart-rate sample folded into existing sensor batches. The Vision foreground service is on-demand only (never 24/7).

Phase 5 implements drive verbs: `drive.key`, `drive.click`, `drive.upload`, `drive.screen` (RTSP ~150ms), `drive.voice_route` (phone as Bluetooth mic). Every verb is gated by `require_root_approval=True` and a `~/.phantom/drive-policy.toml` whitelist; every invocation is audit-logged. New backend file: `phantom-os/src/backend/api/routes_drive.py`.

## Public-release track (kicks in after Phase 4, gates Phase 5 launch)

This is what makes the Phase 5 APK genuinely shippable to strangers, even without payment processing.

1. **Release signing** — `phantom.keystore` already exists at repo root. Wire `signingConfigs.release` in `companion-android/app/build.gradle.kts` and gate behind `KEYSTORE_PATH` env (mirrors the existing `phantom-companion/scripts/build-apk.sh` pattern).
2. **R8 / ProGuard** — enable minification + resource shrinking on release; keep ONNX, Room, Ktor, MediaPipe reflective surfaces.
3. **AAB pipeline** — `./gradlew :app:bundleRelease` produces `.aab` for F-Droid / Play sideload; reuse the aarch64 aapt2 override the existing build script already wires.
4. **Versioning** — `versionCode = MAJOR*10000 + MINOR*100 + PATCH`; semver tag drives both `phantom-os` backend and APK in lockstep; new `phantom-os/scripts/release-apk.sh`.
5. **Crash + analytics** — fully optional, default OFF. Local crash dumps survive on-device; nothing leaves until the user explicitly opts in. Aligns with existing privacy posture (Vault local-only, GHOST never syncs, no telemetry by default).
6. **Legal** — bundled in-app ToS + privacy policy with explicit GHOST/face-data clauses, viewable offline, rev-locked per APK release. Self-host posture means the privacy policy is short and honest: "your data lives on your Radxa."
7. **Distribution** — direct APK first (Telegram / repo release / personal site), F-Droid second. F-Droid is feasible because there are no proprietary deps in the offline build path; Gemini is opt-in cloud, Crashlytics is opt-in, ARCore is the only Google component and is already present on most Android.
8. **First-run host bootstrap** — onboarding ships with a "Don't have a Radxa yet?" link to the `phantom-os` install instructions on the project repo. The companion is useless without a paired host, so the bootstrap path is part of the product.

## Critical files to modify (Phase 1, the next concrete step)

- `phantom-os/companion-android/core-data/src/main/java/local/phantom/companion/core/data/PhantomDatabase.kt` — entities present; add DAOs.
- `phantom-os/companion-android/core-data/src/main/java/local/phantom/companion/core/data/profile/` — new: `ProfileDao`, `ProfileRepository`, Argon2id wrapper.
- `phantom-os/companion-android/feature-onboarding/` — new: 5-screen Compose flow (name → PIN → biometric → voice-print → pair).
- `phantom-os/companion-android/core-net/` — port Argon2id + Ed25519 + X25519 from `phantom-companion/src/services/cryptoUtils.ts`.
- `phantom-os/companion-android/core-design/` — already has GlassCard / OrbView / StatePill / VitalsRow / PttButton; reuse, do not rewrite.
- `phantom-os/src/backend/db/models.py` — add `User.profiles[]` join.
- `phantom-os/src/backend/api/websocket_hub.py` — accept `profile_id` on subscribe, filter broadcasts.
- `phantom-os/src/backend/api/routes_pair.py` — return `profile_id` in claim response.

## Reusable existing assets

- Pair crypto: `phantom-companion/src/services/cryptoUtils.ts` (X25519/Ed25519/HKDF/AES-GCM) → port to `core-net/PairCrypto.kt`.
- QR strategy: `phantom-companion/src/services/qrScanner.ts` (BarcodeDetector + jsQR fallback, fixed today) → replace with ML Kit Barcode in `core-vision/`.
- STT/TTS contracts: `phantom-os/src/backend/api/routes_voice.py` (`/voice/stt`, `/voice/tts`, `/voice/status`) → reuse over Ktor in `core-voice/`.
- Vault contract: `phantom-os/src/backend/api/routes_vault.py` (`POST /vault/cards`, etc.) → mirror in `feature-vault/` with local SQLCipher cache.
- Familiar / state machine: `phantom-os` `SystemState` constants → mirror in `core-context/`.
- Design vocabulary (sunrise-warm + amber-night palettes, GlassCard, accent-per-state) — already ported into `core-design/`.

## Freeze PWA at v1

`phantom-companion/` (Capacitor) stays in maintenance: bug-fix only (today's QR scanner + NSC fix is the last functional change). README updated to mark it as the lite variant for guests / iOS visitors / kiosk testing. No more roadmap items added there — the old Phase 6 list (ARCore, Telecom, Wear OS, BLE, Decision Transformer push) is officially dead weight, since native v2 owns those.

## Verification

- **Phase 1 done when:** install APK; create 2 profiles in <90s each; switch via long-press avatar with biometric; verify ProfileA's vault invisible from ProfileB; PIN Argon2id round-trip survives device reboot; `./gradlew :feature-onboarding:test` green; backend `pytest` green.
- **Phase 2 done when:** pair to running `phantom-os` via QR in <5s; live Pulse vitals stream over WS; PTT round-trip latency <800ms (whisper REST today, streaming Phase 4); Vault create/read/update round-trip with backend; offline mode shows last snapshot.
- **Phase 3 done when:** FaceMesh moves desktop Familiar; AR overlay renders in SENTINEL state; OCR populates chat input; PPG returns plausible HR (60–100 bpm at rest); CameraX foreground service auto-stops when not in use.
- **Phase 4 done when:** airplane mode + Gemma 3n responds to a Ukrainian chat in <10s first token; hybrid router degrades correctly across network/host states; on-device whisper transcribes a 5s clip in <2s.
- **Phase 5 done when (= public-release gate):** phone types into desktop's active terminal window with <100ms perceived latency; ROOT-approval prompt fires on phone for sensitive verbs; audit log on backend records every drive call; signed `.aab` builds reproducibly; ProGuard rules survive R8 minify; ToS + privacy visible offline; versionCode matches git tag; uninstall + reinstall preserves no PII.
- **Per phase additionally:** `./gradlew :app:connectedDebugAndroidTest` integration tests pass; manual smoke on a real Android device; backend `pytest` for any new `routes_*.py` files.
