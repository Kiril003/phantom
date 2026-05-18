# Phase 1.5 Surface Ports — Order & Scope

## Context

`SurfaceId` enum (committed у Phase 1.5-0 `1bcceea`) реєструє 7 поверхонь. Три вже існують (Stream / Onboarding / Pair). Чотири — placeholders («ще не готово · приземлиться в Phase 1.5-X»):

- **Vault** — encrypted private space
- **Diary** — Decision Diary (foundation для Phase 3-E memory layers)
- **Motion** — devOnly motion catalog
- **Whisper** — Whisper Line presence channel

Phase 1.5-A (`f123bcd`, onboarding TTS narration) приземлила voice; цей план визначає **порядок 4 наступних surface-комітів** і scope кожного. Інший Claude Code чат виконує код по цьому документу. Операторський хост (Radxa SBC) не тягне паралельні агенти — **виконавець працює послідовно**, один phase = один atomic commit.

## Recommended Order

**1.5-B Vault → 1.5-C Whisper → 1.5-D Diary → 1.5-E Motion**

(Опціональний follow-up: **1.5-F AR Pair scanner** — ML Kit swap + AR brackets для existing Pair surface; не з 4 нових поверхонь, але висить у tech-debt з Phase 0 ZXing.)

### Чому такий порядок

1. **Vault first** — інфра вся готова: `VaultStore` (52 LoC, `core-data/.../vault/VaultStore.kt`) з `locked: StateFlow<Boolean>` + `lockNow()`, `VaultEntity`, `VaultDao`. Phase 1-F LockVault verb уже консумить `lockNow()` через `controlVerbs.lock_vault`. Залишилось приземлити **UI surface** який читає `getEntries()` + biometric unlock ceremony. **Один atomic commit, low risk, high operator value.** Закриває Phase 1-F loop (зараз `lockNow()` спрацьовує, але operator не має куди подивитися на vault content).
2. **Whisper second** — це найбільш **унікальна** фіча Phantom (1.5px gold-faint ambient drift, presence channel якого нема в Apple/Google/Replika). Per `docs/PRESENCE_AND_CHAT.md:601` ("separate surface, fullscreen mockup") — це **preview-mode surface**, не overlay-сервіс. Маркує product identity рано. Risk низький бо preview, не SYSTEM_ALERT_WINDOW.
3. **Diary third** — потребує нову Room schema (`decision_entries` table). Foundation для Phase 3-E episodic memory (per `docs/VISION_NEXT.md:109-112`). Локально-only у MVP; sync з phantom-os додасться окремою фазою коли backend публікує `decision_diary` channel.
4. **Motion last** — `devOnly = true` у `SurfaceId`, у release не видно. Catalog spring/easing demos — team-internal reference. Найдешевший, найменш value-add для operator → останній.

## Architectural Decisions (made — не переігрувати)

| Decision | Choice | Reason |
|---|---|---|
| Whisper scope | **Preview-only** (Phase 1.5-C) | Real always-on overlay (SYSTEM_ALERT_WINDOW + WindowManager + FLAG_SECURE) — окрема Phase 3-E. Surface показує 1.5px gold-faint stripe з cycling messages per `phase2.jsx#WhisperLineScene`. Operator одразу бачить як це виглядатиме без battery/permission risk. |
| Diary storage | **Local-only Room** | Нова таблиця `decision_entries(id, ts, title, context, status)` у `:core-data`. Server sync — окрема фаза коли phantom-os публікує `decision_diary/*` channel. Не блокуємо UI на backend. |
| Diary encryption | **Plain (поки не landed Vault unlock UX)** | Encrypt-via-Vault tempting, але потребує session-cache якого ще нема (per VaultStore.kt:18-19). MVP plain; encrypt-flag — Phase 3-F privacy. |
| Motion include | **Так, як 1.5-E** | DevOnly уже filter'иться у `SurfaceId.visible(isDebug)`. Release-build operator не побачить. Cost low, value team-internal motion-pattern reference (для всіх майбутніх анімацій). |
| AR Pair (1.5-F) | **Опційно, після 1.5-E** | Не з 4 нових поверхонь, але промпт уже написаний (ML Kit swap + AR brackets). Якщо буде час — bonus commit. |

## Per-Phase Scope

### Phase 1.5-B — Vault surface

**Acceptance:** Long-press на «ВАРТА» → tap "vault" pill → відкривається Vault screen. Якщо `vaultStore.locked.value == true` → показує biometric unlock ceremony (`BiometricPrompt` + GHOST-amber accent через `LocalStateAccent`). Якщо unlocked → list з `vaultStore.getEntries()` (`LazyColumn` glass cards, kind/title/preview). Tap entry → reveal-with-copy-timer (per `surfaces.jsx#VaultGate` lines 1-150). Tap «Замкнути» → `vaultStore.lockNow()` → screen морфить у locked state.

**Files:**
- create `feature-stream/.../ui/vault/VaultScreen.kt` (~250 LoC)
- create `feature-stream/.../ui/vault/VaultUnlockSheet.kt` (~120 LoC)
- create `feature-stream/.../vault/VaultViewModel.kt` (~100 LoC) — wires `VaultStore` + biometric result
- modify `app/src/main/java/local/phantom/companion/navigation/PhantomNavGraph.kt` — replace stub `composable("vault")` з real screen
- create `feature-stream/src/test/.../vault/VaultViewModelTest.kt` (~150 LoC) — locked → BiometricPrompt invoked, unlocked → entries flow, lockNow → state morph

**Reuse:** `core-data/.../vault/VaultStore.kt` (already exists, не torcaty), `androidx.biometric:biometric` (на classpath), `core-design` GlassCard / StatePill / `LocalStateAccent`.

**Verbatim copy:** з `surfaces.jsx#VaultGate` strings («торкнись щоб увійти», «біометрика підтверджена», «копія зникне через 8 с»). Українська. Lowercase.

**E2E gate:** установити на SM-A566B → long-press «ВАРТА» → "vault" → biometric prompt → тестова entry відображається → «Замкнути» → screen клемпує.

---

### Phase 1.5-C — Whisper Line preview surface

**Acceptance:** Long-press → "whisper" pill → відкривається fullscreen mockup. У верхній 2px stripe drift'ять messages з cycling array (per `phase2.jsx#WhisperLineScene` lines ~50-120). Settings row нижче: «звук» toggle, «частота» slider (slow/medium/fast), «фон» preview (light/dark). «Спробувати» button → triggers одне повідомлення з sound (`crystalNotice` analog через MediaPlayer). Note unten: «у Phase 3-E ця стрічка буде завжди-видима поверх будь-якого додатка».

**Files:**
- create `feature-stream/.../ui/whisper/WhisperPreviewScreen.kt` (~280 LoC)
- create `feature-stream/.../ui/whisper/WhisperLineRibbon.kt` (~120 LoC) — composable що drift'ить text горизонтально через `Animatable<Float>` з infinite linear repeat
- modify `PhantomNavGraph.kt` — replace stub `composable("whisper")`
- create `feature-stream/src/test/.../whisper/WhisperLineRibbonTest.kt` (~100 LoC) — frame-step assertions для drift offset; cycle-through-messages count

**Reuse:** `core-design` `GlassCard`, `LocalPhantomTheme.gold`. `androidx.media3` уже є для voice memo — sound через MediaPlayer SoundPool.

**Verbatim copy:** з `phase2.jsx#WhisperLineScene.messages` array (4 семпли) + settings strings. Українська.

**No live overlay-сервіс.** Чітко відмітити у footer: «зараз це лише preview · постійна стрічка зʼявиться у Phase 3-E коли буде завершений overlay-сервіс».

---

### Phase 1.5-D — Diary surface (Room + UI)

**Acceptance:** Long-press → "diary" pill → screen зі списком DecisionEntries. FAB «+ нове рішення» → bottom-sheet з трьома полями (title, context-multiline, status: «актуально» / «переглянути» / «завершено»). Save → entry appears у списку (sorted desc by timestamp). Tap entry → expandable card з повним context. Long-press entry → menu «видалити». Empty state: «ще немає рішень · phantom памʼятатиме твої вибори».

**Files:**
- create `core-data/src/main/.../diary/DecisionEntry.kt` (~30 LoC, Room `@Entity`)
- create `core-data/src/main/.../diary/DecisionEntryDao.kt` (~40 LoC)
- create `core-data/src/main/.../diary/DiaryStore.kt` (~50 LoC) — Flow façade як VaultStore
- modify `core-data/src/main/.../PhantomDatabase.kt` — додати entity, version bump (Room `Migration` з `CREATE TABLE`)
- modify `app/.../data/AppContainer.kt` — wire `DiaryStore`
- create `feature-stream/.../ui/diary/DiaryScreen.kt` (~280 LoC)
- create `feature-stream/.../ui/diary/DecisionEditorSheet.kt` (~140 LoC)
- create `feature-stream/.../diary/DiaryViewModel.kt` (~80 LoC)
- modify `PhantomNavGraph.kt` — real `composable("diary")`
- create `core-data/src/test/.../diary/DecisionEntryDaoTest.kt` + `DiaryStoreTest.kt` (~120 LoC, in-memory Room)
- create `feature-stream/src/test/.../diary/DiaryViewModelTest.kt` (~100 LoC)

**Schema (final, не переігрувати):**
```kotlin
@Entity(tableName = "decision_entries")
data class DecisionEntry(
    @PrimaryKey val id: String,         // UUID
    val createdAt: Long,                // epoch ms
    val title: String,                  // ≤ 80 chars
    val context: String,                // ≤ 1000 chars, reasons + details
    val status: String,                 // "актуально" | "переглянути" | "завершено"
)
```

**Verbatim copy:** з `surfaces.jsx#DecisionDiary` mockData strings (4 sample entries для preview/empty-fallback). Status enum strings — українська lowercase verbatim.

**Migration:** Room schema export уже увімкнений у `:core-data` (per repo). Bump database version → автоматично generates migration JSON. Add `Migration(N → N+1)` з `CREATE TABLE IF NOT EXISTS decision_entries(...)`.

**Не sync з phantom-os.** Поки backend route не існує. Майбутня phase: `decision_diary/created|updated` WS channel.

---

### Phase 1.5-E — Motion catalog (devOnly)

**Acceptance:** Build з `BuildConfig.DEBUG = true` → SurfaceTray показує "motion" pill; release build — pill зникає. Tap → screen з grid of motion-demos (spring-bounce, ease-out, breathing, pulse-gold, slide-morph, etc.) per `surfaces.jsx#MotionCatalogScene`. Tap demo → fires animation у preview area; sound (`spikeAlert`/`crystalNotice`) plays якщо «звук» toggle on. Кожна demo card показує params (stiffness/damping/duration).

**Files:**
- create `feature-stream/.../ui/motion/MotionCatalogScreen.kt` (~350 LoC)
- create `feature-stream/.../ui/motion/MotionDemo.kt` (~200 LoC) — sealed class з ~12 demo types
- modify `PhantomNavGraph.kt` — `composable("motion")` gated by `BuildConfig.DEBUG`
- create `feature-stream/src/test/.../motion/MotionDemoTest.kt` (~80 LoC) — assert kожна demo має finite duration + valid params

**No backend integration.** Pure visual playground. Тестові assertions — на data-class params, не на animation timing (flaky).

**Reuse:** `core-design` MotionTokens (якщо існує) або hardcode params verbatim з прототипу.

---

### Phase 1.5-F (опційно) — AR Pair scanner upgrade

Промпт уже написаний попередньою сесією (зберіг у memory). Swap ZXing → ML Kit `BarcodeScanner` (вже у `:core-vision`), AR-brackets з sine-wave drift → snap-to-cornerPoints через `Animatable<Offset>` spring(180, 0.75). 600ms snap → gold ripple → existing `claimFromQrJson(rawValue)`.

**E2E gate:** Phase-0 verified pair flow — re-test на SM-A566B перед closing.

Виконавець стартує цю фазу **тільки якщо 1.5-B/C/D/E зелені та operator погодив**.

## Reused Patterns (do not re-invent)

| Pattern | File | Use in |
|---|---|---|
| `Store` façade над DAO + StateFlow | `core-data/.../vault/VaultStore.kt` | DiaryStore (1.5-D) |
| TTS narration triggered by state | `feature-onboarding/.../ui/OnboardingNarration.kt` | Vault unlock success "хей" line (optional) |
| Verbatim copy from prototype + verbatim test | `feature-onboarding/src/test/.../OnboardingNarrationTest.kt` | All 4 phases — pin every Ukrainian string |
| Long-press → tray → navigate | `feature-stream/.../ui/SurfaceTray.kt` | Already wired; nothing to change |
| Stub destination → real composable swap | `app/.../navigation/PhantomNavGraph.kt` | Each phase replaces ONE `composable(routePath)` block atomically |
| `LocalStateAccent` morph on emotion | `feature-stream/.../ui/StreamScreen.kt` (Phase 1-D) | Vault uses GHOST-amber accent when locked; Diary uses default; Whisper uses theme.gold |

## Constraints (не порушувати)

1. **Один phase = один atomic commit.** Build green + tests green per phase. Operator пише `git log -p` щоб ревʼювнути.
2. **Read-before-edit.** Edit hook reject'ить якщо файл не прочитаний.
3. **Verbatim Ukrainian.** Copy з прототипу `/tmp/phantom-design-4/phantom-app2/project/{surfaces,phase2,phase3}.jsx` — слово в слово, lowercase, ти-form, без paraphrase.
4. **Жодних паралельних `Agent(subagent_type=...)` тулзів** в одному message. Хост не тягне (per `host_agent_concurrency.md` memory). Sequential дозволені, параллельні — ні.
5. **`./gradlew test :app:assembleDebug :app:lintDebug`** зелено перед коммітом. На SM-A566B reinstall перед закриттям phase якщо UI-touching (1.5-B має biometric — обовʼязково; 1.5-C/D/E — опційно).
6. **No design re-generation.** Прототип у `/tmp/phantom-design-4/` — read-only ground truth. Якщо щось не translate'иться 1:1 у Compose — pause і запитай operator.
7. **No dependency bumps.** 155 stale deps existing — окрема фаза.

## Verification

Per-phase smoke (без E2E):
```bash
cd /home/radxa/programming/my_own/phantom_ai/PHANTOM_OS_BLUEPRINT/phantom-companion
./gradlew :feature-stream:testDebugUnitTest :core-data:testDebugUnitTest
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
```

E2E (Vault обовʼязково; інші — оператор сам):
```bash
./scripts/build_apk.sh
TS=$(date +%H%M)
cp app/build/outputs/apk/debug/app-debug.apk ~/Downloads/phantom-companion-1.5-B-$TS.apk
adb install -r ~/Downloads/phantom-companion-1.5-B-$TS.apk
adb shell am start -n local.phantom.companion/.MainActivity
# Long-press «ВАРТА» → tap «vault» → biometric prompt
# Якщо crash: adb logcat -v threadtime --pid=$(adb shell pidof local.phantom.companion) | grep -E "FATAL|AndroidRuntime"
```

Final state when all 4 phases done:
- `git log --oneline f123bcd..HEAD` показує **4-5 коммітів** Phase 1.5-{B,C,D,E[,F]}
- `./gradlew test` всі зелені (~340 unit-tests, +30 нових)
- SurfaceTray на debug build має 7 pills, всі ведуть на робочі screens (без stub fallback)
- ROADMAP.md оновлений з ✅ позначками per phase

## Reporting Format

Виконавець повертає після КОЖНОГО phase, 3-5 sentences:
1. Phase ID + 1-line scope
2. Files changed (counts + перші 3-4 paths)
3. Test result (X/Y green) + build result
4. Anything surprising (proposes memory entry якщо так)
5. Naming next phase OR pausing

Брак ніяких narrate-tool-calls. Operator чита diff через `git log -p` якщо треба деталі.
