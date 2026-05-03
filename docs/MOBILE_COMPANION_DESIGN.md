# PHANTOM Companion — UI Design Brief for Claude Code

> Парний документ до `docs/MOBILE_COMPANION.md`. Цей файл — **бриф для Claude Code**, з якого ШІ генерує Compose UI для кожного екрану. Не чергова "design system doc" — це prompt-template, що несе всі обмеження проєкту.
> Канонічне джерело токенів: `src/frontend/src/styles/tokens.css`. Якщо тут і там розходження — `tokens.css` правий, цей файл оновити.
> Канонічне джерело естетики: `docs/VISUAL_SYSTEM.md`. Прочитати ПЕРЕД генерацією.

---

## 0. Як використовувати цей бриф

При генерації Compose-екрану дай Claude цей файл цілком + конкретний `§ Wireframe` потрібного екрану. Жодних інших дизайн-документів не змішувати, інакше виходить generic Material You.

Заборонені фрази у промпті: "modern Android app", "use Material 3 best practices", "make it look polished" — вони штовхають генератор у Material You. Натомість писати: "use PhantomTheme tokens from §1", "follow Wireframe §3.X exactly", "honor anti-patterns from §6".

---

## 1. Design DNA → Compose theme

### 1.1 Themes

Три теми, перемикаються через CompositionLocal `LocalPhantomTheme`. Default — `sunrise-warm`. Значення HEX звірені з `tokens.css`.

```kotlin
data class PhantomThemeSpec(
    val id: String,
    val primary: Color,
    val primarySoft: Color,
    val primaryDeep: Color,
    val coral: Color,
    val coralDeep: Color,
    val surfaceBase: Color,
    val surfaceDeep: Color,
    val glassPanel: Color,    // alpha-tinted; rendered with backdrop blur
    val glowPrimary: Color,
)

val SunriseWarm = PhantomThemeSpec(
    id = "sunrise-warm",
    primary       = Color(0xFFF4AF25),
    primarySoft   = Color(0xFFFBC66A),
    primaryDeep   = Color(0xFFB07A10),
    coral         = Color(0xFFEF4444),
    coralDeep     = Color(0xFFB9201F),
    surfaceBase   = Color(0xFFF8F7F5),
    surfaceDeep   = Color(0xFFF5F1EA),
    glassPanel    = Color(0x99FFFFFF),   // rgba(255,255,255,0.60)
    glowPrimary   = Color(0x4DF4AF25),   // rgba(244,175,37,0.30)
)

val AmberNight = PhantomThemeSpec(
    id = "amber-night",
    primary       = Color(0xFFF4AF25),
    primarySoft   = Color(0xFFFBC66A),
    primaryDeep   = Color(0xFFFFC34A),
    coral         = Color(0xFFE35858),
    coralDeep     = Color(0xFF7F1D1D),
    surfaceBase   = Color(0xFF0E0A05),
    surfaceDeep   = Color(0xFF080502),
    glassPanel    = Color(0xA6140F08),   // rgba(20,15,8,0.65)
    glowPrimary   = Color(0x73F4AF25),   // rgba(244,175,37,0.45)
)

// CyberdeckCold — opt-in legacy. Cyan #22D3EE, surface #020617.
```

### 1.2 State accent (per SystemState)

Накладається ПОВЕРХ теми. Implementation: `CompositionLocal<StateAccent>` що повертає Color + motionScale.

| State    | accent (sunrise) | accent (amber-night) | motionScale | UI opacity |
|----------|------------------|----------------------|-------------|------------|
| SHADOW   | `#8A7F72` bronze | invert+lift          | 0.6         | 0.92       |
| FOCUS    | `#B07A10` deep amber | `#F4AF25`        | 1.0         | 1.0        |
| DIALOGUE | `#B07A10` amber  | `#F4AF25`            | 1.1         | 1.0        |
| SENTINEL | `#B9201F` coral-deep | `#E35858`        | 1.3         | 1.0        |
| GHOST    | `#16A34A` emerald | `#16A34A`           | 0.8         | 0.9        |
| DREAM    | `#B07A10` amber  | `#F4AF25`            | 0.4         | 0.75       |

`motionScale` множиться на duration кожної анімації. `UI opacity` множиться на `alpha` глобального `Box`-контейнера.

### 1.3 Typography

Шрифти підвантажуємо через `androidx.compose.ui.text.font.GoogleFont` (один Provider, batch fetch у `App.onCreate`):

```kotlin
val provider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage   = "com.google.android.gms",
    certificates      = R.array.com_google_android_gms_fonts_certs,
)

val Display = FontFamily(Font(GoogleFont("Manrope"), provider, FontWeight.Normal),
                        Font(GoogleFont("Manrope"), provider, FontWeight.SemiBold),
                        Font(GoogleFont("Manrope"), provider, FontWeight.Bold))
val Body    = Display                                                   // тотожні
val Mono    = FontFamily(Font(GoogleFont("JetBrains Mono"), provider, FontWeight.Medium))
val Serif   = FontFamily(Font(GoogleFont("Playfair Display"), provider, FontWeight.SemiBold, FontStyle.Italic))
```

Дозволені ролі:

- **Display / Body** — Manrope (НЕ Space Grotesk; Space Grotesk допустимий лише як fallback у CSS на десктопі).
- **Mono (data only)** — JetBrains Mono. Це для координат, BPM, timestamps, MAC. Ніколи не для UI-текстів.
- **Serif italic (AI quotes only)** — Playfair Display Italic. Для phantom-AI відповідей, які вимагають "вагомості". Решта тексту — НЕ serif.

Type scale (sp): micro 11, label 13, body 15, title 18, subhead 22, head 28, display 36, hero 56.

### 1.4 Glass stack

Чотири рівні. У Compose реалізуємо через `Modifier.graphicsLayer { renderEffect = BlurEffect(blurDp.toPx(), blurDp.toPx(), TileMode.Clamp) }` + tint background. Доступно з API 31.

| Level    | blurDp | bg alpha (sunrise) | використання         |
|----------|--------|--------------------|----------------------|
| subtle   | 12     | 0.40               | hover/pressed states |
| panel    | 12     | 0.60               | основні контейнери   |
| card     | 24     | 0.70               | окремі картки        |
| elevated | 32     | 0.78               | модалки, sheets      |

**Fallback API < 31:** замість blur — frosted PNG noise overlay 4% alpha + tint. Виявляти `Build.VERSION.SDK_INT < 31` у `GlassCard` і повертати інший render path.

### 1.5 Spacing & radius

- Базова сітка: 4 dp. Вживані інкременти: 4, 8, 12, 16, 24, 32, 48.
- Radius: 12 (chip), 16 (card), 24 (panel), 32 (elevated), 999 (pill).
- Touch target: мінімум **48 dp** (a11y), бажано 56 dp для primary actions.

---

## 2. Component recipes

Кожен — props + state inputs + animation hooks. Ілюстрація у форматі "сигнатура → коротка специфіка".

### 2.1 `GlassCard`

```kotlin
@Composable
fun GlassCard(
    level: GlassLevel = GlassLevel.Panel,           // Subtle | Panel | Card | Elevated
    modifier: Modifier = Modifier,
    accentBorder: Boolean = false,                  // 1px primary accent on top edge only
    content: @Composable BoxScope.() -> Unit,
)
```

Реалізація: `Box` з `Modifier.background(theme.glassPanel.copy(alpha = level.bgAlpha))` + `RenderEffect` blur (API 31+). Inner `Modifier.border(1.dp, glassBorder, shape)`. Inset highlight через `drawWithContent` лінією `0..fullWidth, y=0` `glassHighlight`.

### 2.2 `OrbView`

```kotlin
@Composable
fun OrbView(
    state: SystemState,
    motionScale: Float,
    audioLevel: Float = 0f,                         // 0..1, drives radial pulse
    modifier: Modifier = Modifier,
)
```

`Canvas` 1:1; кругла градієнтна заливка `accentRadial` (state-driven). Breath cycle: `rememberInfiniteTransition` → `scale 1.00 → 1.05`, period `2000 ms / motionScale`. Для DIALOGUE додається друге кільце pulse 1200 ms. Audio-reactive: радіус кільця = `1 + audioLevel * 0.18`.

### 2.3 `FamiliarCanvas`

```kotlin
@Composable
fun FamiliarCanvas(
    pose: FamiliarPose,                              // Idle, Floating, Pointing, Peeking, Sleeping, Waving, Vanishing
    mood: FamiliarMood = FamiliarMood.Neutral,
    target: Offset? = null,                          // for Pointing
    modifier: Modifier = Modifier,
)
```

Render path:

- API ≥ 31 та SoC tier ≥ "mid" → Filament `SurfaceView`, GLB asset.
- Інакше → Skottie/Lottie JSON-аналог поз (готується дизайн-командою як 7 окремих лоті).

Розмір: 96 × 132 dp у portrait, scale-up 1.3× коли pose ∈ {Pointing, Waving}.

### 2.4 `StateAccent` (CompositionLocal)

Provider лінії `accent: Color` + `motionScale: Float` у дерево. Проставляється на корені App за поточним SystemState із WS-підписки. Усі компоненти, що використовують accent, читають саме звідси.

```kotlin
val LocalStateAccent = compositionLocalOf { StateAccentDefaults }
```

### 2.5 `VitalsRow`

```kotlin
@Composable
fun VitalsRow(
    bpm: Int?,
    breathBpm: Int?,
    stress: Float?,                                  // 0..1
    modifier: Modifier = Modifier,
)
```

Три chip-картки `GlassCard(level = Subtle)`, кожна 1/3 ширини. Mono для чисел. micro-spark sparkline 24 dp висоти, останні 60 точок (з rolling buffer Room).

### 2.6 `PttButton`

```kotlin
@Composable
fun PttButton(
    state: PttState,                                 // Idle | Capturing | AwaitingFinal | Speaking
    audioLevel: Float,
    onPress: () -> Unit,
    onRelease: () -> Unit,
    modifier: Modifier = Modifier,
)
```

96 dp circle, primary accent radial. Hold-state — outer ring `audioLevel`-reactive. AwaitingFinal — pulse 600 ms. Speaking — TTS playback в-тему, ring обертається 360° за 4 s. Haptic: short tick на onPress, medium на final, long на rejected.

### 2.7 `StatePill`

`Row` 32 dp висоти, primary accent dot 8 dp + label uppercase tracking-widest (Mono). Tap → expand bottom-sheet з `standing_orders` preview.

---

## 3. Wireframes (6 screens, ASCII)

Координати — у блоках сітки 4 dp. Кожен екран має `Scaffold` з `BottomNavigation` 80 dp.

**Bottom nav tabs (5):** Pulse · Voice · Map · **Comms** · Vault. (Chat поглинено у Comms — Phantom-розмови це один із сегментів цього табу разом із Calls / SMS / IM-bridges.)

**InCall** — окремий full-screen overlay поза навігацією, ховає bottom-nav на час розмови.

### 3.1 Pulse (replaces SHADOW)

```
┌──────────────────────────────────────┐
│ status bar (system, transparent)     │
├──────────────────────────────────────┤
│ ┌────┐  ┌────┐  ┌────┐               │  ← VitalsRow (BPM | breath | stress)
│ │ 72 │  │ 14 │  │.32 │               │     GlassCard(Subtle), 56 dp tall
│ │bpm │  │brth│  │stre│               │
│ └────┘  └────┘  └────┘               │
│                                      │
│         ╭─────────────╮              │  ← OrbView 70% width
│        (   FAMILIAR    )             │     Center, 240 dp
│         ╰─────────────╯              │
│                                      │
│  ┌────────────────────────────────┐  │  ← StatePill expanded
│  │ ◉ FOCUS · 2 standing orders ▾ │  │     GlassCard(Panel), 64 dp
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │  ← Next 1 hour suggestion
│  │ NEXT 1H                       │  │     GlassCard(Card), 96 dp
│  │ "Кнопка кави о 09:14, BPM     │  │     Serif italic body
│  │  паде 12% за 18 хв спіймати"  │  │
│  └────────────────────────────────┘  │
│                                              │
│                                  ╭──╮│  ← Familiar peek (96×132)
│                                 (◉ ⌐) │     Modifier.align(BottomEnd)
│                                  ╰──╯│
├──────────────────────────────────────┤
│ ◉ Pulse  Voice  Map  Comms  Vault   │  ← BottomNav (current accent on Pulse)
└──────────────────────────────────────┘
```

Focus order: VitalsRow → OrbView → StatePill → Suggestion → Familiar (a11y).

### 3.2 Voice (replaces DIALOGUE)

```
┌──────────────────────────────────────┐
│ Transcript scrolls upward             │  Mono 13sp, max 8 lines visible.
│                                       │  Latest line: primary accent.
│   "…привіт фантом готова до           │  Older lines: ink-secondary.
│     запуску wardriving сесії"          │
│                                       │
│                                       │
│            ╭───────────╮              │  ← Big OrbView 60% width, 280 dp.
│           (   FAMILIAR  )             │     Familiar pose=Pointing under
│            ╰───────────╯              │     final result.
│                                       │
│                                       │
│                                       │
│             ╭──────╮                  │  ← PttButton 96 dp circle, ring
│            │  ◉◉◉   │                 │     audio-reactive. Hold-to-talk.
│             ╰──────╯                  │     Long-press → continuous mode.
│                                       │
│            HOLD TO SPEAK              │
│                                       │
├──────────────────────────────────────┤
│   Pulse  ◉ Voice  Map  Comms  Vault  │
└──────────────────────────────────────┘
```

Swipe-up на PttButton → відкрити inline ChatComposer.

### 3.3 Map (replaces SENTINEL + wardriving)

```
┌──────────────────────────────────────┐
│ ┌──────────────────────────────────┐  │  ← Layer pill (segmented)
│ │ Wardrive  POIs  Heatmap  GPS    │  │     GlassCard(Subtle), 40 dp
│ └──────────────────────────────────┘  │
│                                       │
│                                       │
│                                       │  ← MapLibre full-bleed.
│         (Map tiles render)            │     Markers tinted state-accent.
│                                       │
│                                       │
│                                       │
│                                       │
│                                       │
│                                       │
│                              ╭──╮     │  ← FAB AR-toggle (Tier-2)
│                             │ AR │    │     56 dp, glass-elevated
│                              ╰──╯     │
│                                       │
│ ▲────────────────────────────────────│  ← Bottom-sheet draggable
│ │ THREATS · 3                        │     Threat rows with coral accent
│ │ • PROXIMITY 5m  ▸                  │     when state=SENTINEL.
│ │ • UNKNOWN BSSID 32m  ▸             │
│ │ • GEOFENCE EXIT 12m  ▸             │
├──────────────────────────────────────┤
│   Pulse  Voice  ◉ Map  Comms  Vault  │
└──────────────────────────────────────┘
```

### 3.4 Comms (Calls / SMS / Phantom Chat / IM)

```
┌──────────────────────────────────────┐
│ ◀ Comms                         ⋮    │  ← Top bar 56 dp, glass-panel.
│ ┌────┬────┬────────┬────────────┐    │  ← Segmented tabs (4)
│ │CALL│ SMS│PHANTOM │ TG/SIG/WA │    │     glass-card(Subtle), 40 dp.
│ └────┴────┴────────┴────────────┘    │     Active: state-accent fill.
│                                       │
│ ┌──────────────────────────────────┐ │  ← Conversation row (Calls).
│ │ ◉ Олег К.            10:42  ▸   │ │     Avatar, last activity time.
│ │  call · 4:18 · "поговорили…"    │ │     Mono timestamp.
│ │  AI summary: "узгодили зустріч" │ │     Italic Playfair AI summary.
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ⊘ +380… (unknown)    08:11  ▸   │ │  ← Spam-screened.
│ │  voicemail · 18s ✱hot✱          │ │     Coral accent left-border.
│ │  AI: "хоче продати solar panels"│ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ◉ PHANTOM            now    ▸   │ │  ← Phantom Chat conversation.
│ │  "next 1h: BPM падає, кава?"    │ │     Accent state-color border.
│ └──────────────────────────────────┘ │
│                                       │
│                            ╭──╮      │  ← FAB compose (call/sms/chat)
│                           │ + │      │     56 dp, accent.
│                            ╰──╯      │
├──────────────────────────────────────┤
│  Pulse  Voice  Map  ◉ Comms  Vault   │
└──────────────────────────────────────┘
```

Segments behaviour: `CALL` filter → only `Call` rows; `SMS` → SMS threads; `PHANTOM` → existing `/chat/message` sessions; `TG/SIG/WA` → Notification-Listener bridges (read-only + suggested replies).

Open conversation → drill-down screen (not separately wireframed) — message list reuses existing chat layout (AI msg = glass-card with accent border-left; user msg = accent-fill bubble); composer 56 dp glass-elevated з mic-icon long-press = dictation. Над клавіатурою — chip-rows з AI-suggested replies (max 3, swipe to dismiss).

### 3.5 Vault (GHOST)

```
┌──────────────────────────────────────┐
│      [biometric splash before mount]  │
├──────────────────────────────────────┤
│   GHOST · LOCAL ONLY                  │  ← Header, emerald accent.
│   3 records · 0 synced                │     Mono caption.
│                                       │
│ ┌──────────────────────────────────┐  │
│ │ NOTE  yesterday 23:14         🔒 │  │  ← Card, glass-card level.
│ │ "Координати схрону..."           │  │     Tap → reveal w/ biometric.
│ │ ─ promote to MemoryFact          │  │     Long-press → menu.
│ └──────────────────────────────────┘  │
│ ┌──────────────────────────────────┐  │
│ │ PHOTO  today 03:11 · 2.4 MB   🔒 │  │
│ │ [thumbnail blurred until unlock] │  │
│ └──────────────────────────────────┘  │
│ ┌──────────────────────────────────┐  │
│ │ AUDIO MEMO  today 10:42 · 0:32 🔒 │ │
│ │ ▶ play (after unlock)            │  │
│ └──────────────────────────────────┘  │
│                                       │
│                            ╭──╮       │  ← FAB add (note/photo/audio)
│                           │ + │       │     56 dp, accent emerald.
│                            ╰──╯       │
├──────────────────────────────────────┤
│   Pulse  Voice  Map  Comms  ◉ Vault  │
└──────────────────────────────────────┘
```

---

### 3.6 InCall (full-screen overlay, поза навігацією)

```
┌──────────────────────────────────────┐
│ status bar (transparent)              │
│                                       │
│        ╭─────────────────╮            │  ← Caller avatar 96 dp circle,
│       (    Олег К.        )           │     state-accent ring 4 dp,
│        ╰─────────────────╯            │     pulse 1200 ms while ringing.
│                                       │
│            Олег Кравченко             │  ← Display name, 22 sp Manrope.
│            +380 67 ___ __ __          │  ← Number, JetBrains Mono 13 sp.
│                                       │
│       INCOMING · 0:08                 │  ← State pill, accent.
│                                       │
│  ┌──────────────────────────────────┐ │  ← AI context card, glass-card.
│  │ PHANTOM context                  │ │
│  │ • last call 2 days ago, 4:18     │ │     Bullet rows in mono 13.
│  │ • last sms: "ok, чекаю"          │ │     Italic Playfair AI summary
│  │ • тон останніх 3 розмов: spокій  │ │     of relationship.
│  │ AI: "імовірно про зустріч у пт"  │ │
│  └──────────────────────────────────┘ │
│                                       │
│            ╭───────╮                  │  ← Familiar pose=Pointing
│           (FAMILIAR)                  │     toward avatar, 96×132.
│            ╰───────╯                  │
│                                       │
│ ┌──────┐    ┌──────┐    ┌──────┐      │  ← Action row, 56 dp circles.
│ │decline│   │ AI   │    │answer│      │     • decline: coral fill.
│ │   ✕  │   │screen│    │   ✓  │      │     • AI screen: amber, taps →
│ │      │   │  ⚙   │    │      │      │       PHANTOM picks up, asks
│ └──────┘    └──────┘    └──────┘      │       "хто це і з чого?",
│                                       │       you read transcript live.
│ during call (after answer):           │     • answer: emerald fill.
│ ┌──────────────────────────────────┐ │
│ │ live transcript scrolls here     │ │  ← Once connected, screen morphs:
│ │ "Олег: привіт, я по тому проєкту"│ │     transcript area expands,
│ │ "ти: давай о пів на п'ять"       │ │     action row becomes mute /
│ └──────────────────────────────────┘ │     hold / speaker / hangup.
│  [mute] [hold] [speaker] [hangup]    │
└──────────────────────────────────────┘
```

Behaviour:

- Implements `InCallService` (Android Telecom). Activity has `showWhenLocked=true`, `turnScreenOn=true`.
- While ringing: PhantomCanvas pulse + Familiar peek; mic muted by default.
- "AI screen" button → answer call with mic muted, PHANTOM TTS asks (через `AudioTrack` напрямок=earpiece-mix), live transcript appears, user can take over with single tap.
- After answer: WS to `/ws/voice?mode=call_capture` opens; `partial`/`final` rendered as transcript rows; on hangup, server returns `CallSummary` and inserts row into Comms tab.
- Decline: standard `Connection.onReject()`.
- All visual elements honor `LocalStateAccent` (SENTINEL during incident-mode, GHOST → entire AI overlay hidden, plain system UI shown).

---

## 4. Motion specs

Усі тривалості мультиплікуються на `motionScale` із `LocalStateAccent`.

- **Breath cycle (orb).** `rememberInfiniteTransition` → `targetValue 1.0 ↔ 1.05`, `2000 ms`, `LinearEasing`.
- **State transition (accent + motionScale).** `AnimatedContent` з `SizeTransform(clip = false)`, `tween(durationMillis = 320, easing = FastOutSlowIn)`. Accent — `animateColorAsState` з тим же tween.
- **PTT pulse (AwaitingFinal).** `rememberInfiniteTransition` → `alpha 0.4 ↔ 1.0`, `600 ms`, `EaseInOut`.
- **Familiar floating drift.** Bezier path 4-control points, period 6500 ms (idle), 4500 ms (when state=DIALOGUE). Animation handled inside `FamiliarCanvas` (not Compose-level).
- **Bottom-sheet drag.** `swipeable` modifier, anchors {0%, 35%, 75%}, `tween(280)` snap.
- **Page transitions (BottomNav).** `NavHost` with `EnterTransition.fadeIn(180) + slideInHorizontally`, відстань 24 dp, `FastOutSlowIn`.

---

## 5. Accessibility

- `contentDescription` обов'язково на: OrbView ("PHANTOM orb, state=FOCUS, motion calm"), FamiliarCanvas ("Familiar pose=Waving"), PttButton ("Push to talk to PHANTOM, hold").
- StatePill — dual-mode: visual (color+text) + non-visual (vibration pattern на transition entry, per-state distinct: FOCUS=single short, DIALOGUE=two short, SENTINEL=long+short+long).
- Минімум touch target 48 dp; primary actions — 56 dp.
- Підтримка `Settings.System.ANIMATOR_DURATION_SCALE`: усі anim multiplied by `motionScale * systemDurationScale`.
- Підтримка `Configuration.fontScale` через `androidx.compose.ui.unit.sp` без хардкоду.
- TalkBack: live-region на transcript (Voice tab), `LiveRegionMode.Polite`.
- Reduce-motion (через `accessibility.disableAnimations`): orb breath → static; familiar → fade-in/out only.

---

## 6. Anti-patterns (явно заборонене)

- НЕ використовувати **Material You / dynamic color** (`androidx.compose.material3.dynamicLightColorScheme`) — ламає state-accent логіку.
- НЕ ставити сірий `TopAppBar` з Material defaults — top-bar повинен бути GlassCard(Panel) або взагалі без bar (Voice screen).
- НЕ використовувати дефолтні `AlertDialog` / `Snackbar` — лише GlassCard-based modals (`level = Elevated`) і toast-pill з accent border.
- НЕ вмикати дефолтний Android splash logo — використовувати `Theme.SplashScreen` з кастомним PHANTOM monogram (з frontend `/public/icons/phantom.svg`).
- НЕ використовувати Material Icons — лише `lucide-android` (port існуючого lucide-react з frontend) або custom SVG. Material Symbols допустимі ЛИШЕ для системних дій (back arrow, share) і навіть тоді — тінтовані accent-кольором.
- НЕ ставити Activity-state у composable — все через ViewModel state-holders + `collectAsStateWithLifecycle`.
- НЕ використовувати Material `BottomNavigation` як є — кастомний компонент із GlassCard рядком + ручний рендер 5 tabs.
- НЕ показувати "loading spinner" Material — натомість breath-cycle на OrbView (як на десктопі).
- НЕ робити Cyberdeck-cold темою default — sunrise-warm дефолт; cyberdeck-cold лише через явний opt-in у Settings (як на десктопі).
- НЕ використовувати serif body text. Playfair Italic — ЛИШЕ для AI quotes, які явно позначені роллю `phantom-thought`.
- НЕ дозволяти `EditText` з системним cursor styling — кастомний caret accent-кольором, monospace placeholder.

---

## 7. Що подати Claude Code разом з цим брифом

При запиті "згенеруй екран X" подавай:

1. Повний цей файл (`MOBILE_COMPANION_DESIGN.md`).
2. Конкретний `§3.X Wireframe`.
3. ViewModel signature (state holder + intent handler).
4. WS channel і payload-схема, з якими екран з'єднаний.
5. Список вже існуючих core-компонентів, що мають бути перевикористані (`GlassCard`, `OrbView`, …) — щоб Claude їх не дублював.

Не подавати: дизайн-системи інших проєктів, Material 3 cookbook, generic Android tutorials. Інакше DNA розчиняється.

---

## 8. Open questions (для оператора)

- Чи ми хочемо primary fonts від Google Fonts API runtime-fetch, чи bundled у APK? Bundled = +800 KB APK, але миттєвий старт. Рекомендую bundled для Manrope+Mono, runtime для Playfair (рідко вживаний).
- Filament APK delta (~6 MB) vs Skottie-only fallback — ROOT повинен підтвердити фічу-flag для 3D Familiar (default on на Android 12+ та Pixel 6+).
- Watch UI — мінімальний MVP лише state pill, чи відразу "compact dialogue" (transcript на zoom)? Рекомендую state pill як Phase 3 alpha.
