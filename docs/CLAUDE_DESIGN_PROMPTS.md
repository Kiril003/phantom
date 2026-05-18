# Claude Design — PHANTOM OS prompt library

Готові blocks для генерації компонентів через Claude Design. Як
користуватися:

1. **Спершу вставляй UNIVERSAL PRELUDE** (розділ §1).
2. Якщо surface — мобільний, додай **MOBILE ADDENDUM** (розділ §2).
3. Якщо surface — десктопний, додай **DESKTOP ADDENDUM** (розділ §3).
4. Додай конкретний **SURFACE REQUEST** з §4 (Mobile) або §5
   (Desktop). Це фіксує макет, поведінку, edge cases.
5. Якщо в тебе є **operator-supplied assets** (новий лого, шрифт,
   reference screen) — встав їх блоком §6 між adendum і surface
   request.

Один промпт = одна поверхня. Не зливай два surface-и в один запит.

---

## §1. Universal prelude (PHANTOM visual contract)

```
=== PHANTOM OS visual contract (REQUIRED) ===

VIEWPORT: specified per surface request. Always design pixel-exact.
DENSITY: information-first. Empty space is failure. Every pane has
information or a living animation. No "breathing room" headers above
20px tall. No decorative-only graphics.

THEME TOKENS (sunrise-warm + amber-night dual palette, light/dark):
- bgGradient: warm radial (#fff5e6 → #f3deb6) light /
              (#1a1308 → #0a0805) dark
- primary: #C97B16 (sunrise-warm) / #F4AF25 (amber-night)
- coral (alert): #E04A2E light / #FF7250 dark
- ink: text on bg | ink2: secondary | ink3: tertiary muted
- glassPanel, glassCard, glassElevated: layered glassmorphism with
  backdrop-blur:24px and 1px glassBorder
- accent-per-state: SHADOW=cool blue-grey, FOCUS=primary,
  DIALOGUE=warm coral-tint, SENTINEL=coral red, GHOST=green,
  DREAM=violet, BACKSTAGE=muted grey

LIVING UI: every component renders DIFFERENTLY per system state.
Don't deliver a static design — deliver state-conditioned variations.
SHADOW = collapsed/dimmed. SENTINEL = red-tinted, radar geometry.
DREAM = drifting/blurred. The component MUST acknowledge state in
its layout, not just its colors.

EXISTING COMPONENT LIBRARY — REUSE, DON'T REINVENT:
- GlassCard (level: subtle | card | elevated | hero)
- OrbView (animated identity orb, motion-scaled)
- StatePill (state name + accent dot)
- VitalsRow (bpm/breath/stress horizontal)
- PttButton (push-to-talk circle)
- PrimaryActionBar (full-width bottom CTA, 64px tall)
- Banner (info/success/warn/error, inline; replaces toaster)
- BottomNav v3 (5 tabs: Now/Voice/Map/Vault/Me, 56px, mobile only)
- GlobalStatusBar (44px, persistent every screen)
- UtilityDrawer (right-edge slide-in for secondary screens)
- EmptyState (icon + title + hint + optional CTA)
- Modal, Skeleton, MiniMap, Sparkline, AnimatedTabs

ANIMATIONS = INFORMATION. No decorative motion. Every transition
carries data. Use Framer Motion spring(damp:18-20, stiff:200-240)
defaults. Critical state changes: pulse 1× then settle.

ANTI-PATTERNS — NEVER PRODUCE:
- Settings tabs / segmented controls > 4 options (use list)
- Horizontal scroll except for "hosts strip" pattern
- Floating toaster for in-screen feedback (use Banner)
- Tooltips on hover (mobile-first)
- Heroes / banners taller than 64px on mobile, 96px on desktop
- Empty grid cells when there's data to show
- Decorative icons for the sake of icons
- Border-radius > 22px (glassmorphism caps at 22)

TOUCH TARGETS (mobile): min 44×44.

FONT SYSTEM:
- var(--mono) — ALL meta/labels/timestamps (uppercase, 0.18em
  letter-spacing, 9-11px sizes for chips, 13px for body labels)
- var(--serif) italic — assistant/AI lines, garden seed text
- var(--sans) — user input + body
- var(--display) — hero copy only (rare)

OUTPUT FORMAT: single self-contained HTML file with inline CSS + SVG.
NO external assets, NO npm imports. JSX skeleton in a <script
type="module" data-react> block at end so I can lift it into
src/components.

=== END VISUAL CONTRACT ===
```

---

## §2. Mobile addendum

```
=== PHANTOM Companion (mobile) addendum ===

VIEWPORT: 360×740 (Samsung A56 baseline). Test on 412×892 (Pixel 7) —
component MUST not break.

SAFE AREAS: respect env(safe-area-inset-{top|bottom|left|right}).
Status bar 24-44px, gesture bar 16-24px. PrimaryActionBar:
padding-bottom: calc(10px + env(safe-area-inset-bottom)).

GLOBAL CHROME (already exists, do not redesign):
- GlobalStatusBar (44px) — top, persistent: avatar (→/me), connection
  dot+label (→/diag), host hint, clock, hamburger (→drawer)
- BottomNav v3 (5 tabs: Now/Voice/Map/Vault/Me) — 56px bottom
- UtilityDrawer — right-edge slide-in for: Senses, Driver, Ambient,
  Diag, Inbox, Comms, Showcase, Garden, Pulse, Substitute, Agents
- HandoffOverlay — global slide-up sheet for cross-device handoffs
- Toaster — only for cross-screen events (pair, profile switch). For
  in-screen feedback use Banner inline

VOICE-FIRST PRINCIPLE: every primary screen one-handable, thumb on
lower 60% of screen. PrimaryActionBar lives 56px above BottomNav (so
112px reserved at bottom). Top 200px = "glance only" — no primary
actions there.

USABLE AREA per screen (after 44 statusbar + 56 bottomnav, no
PrimaryActionBar): 360×640.
With PrimaryActionBar (64px): 360×576.

GESTURES:
- Long-press = 550ms (existing pattern in CommsScreen)
- Swipe to dismiss = 100px velocity threshold
- Pinch-zoom: native browser default, opt-out per-screen if needed

=== END mobile addendum ===
```

---

## §3. Desktop addendum

```
=== PHANTOM OS desktop addendum ===

VIEWPORT: 1024×600 fixed. NO scroll on primary screens. Sidebar
allowed up to 240px wide. Multi-pane allowed and encouraged.

CHROME (already exists):
- LeftRail (existing OperatorLayout) 64px — state pill, mode glyphs,
  navigation icons
- TopBar (existing) 48px — current state name, time, system stats
- Main content area: 960×504 maximum after chrome

INTERACTION: cursor + keyboard. Touch optional.

DENSITY MULTIPLIER: ×1.4 vs mobile. Where mobile shows 3 entities
per screen, desktop should show 7-8.

COMMON PATTERNS:
- 3-column split: 280 + 480 + 264 px main area
- 4-pane grid: 2×2 with each pane 480×252
- Side panel (draggable): up to 320px wide, snap-points at 240/320

=== END desktop addendum ===
```

---

## §4. Mobile surface requests

### 4.1 Memory Garden (/garden)

```
=== Surface request: Memory Garden (/garden) ===

PURPOSE: render the operator's `garden_seeds` (200+ facts each with
VAD emotion vector, time, geo, growth_factor) as a living blossom
field.

LAYOUT (360×640):
- Filter strip 360×52 sticky-top: 4 emotion-quadrant chips (joy/calm/
  tense/sad), time range select (today/week/month/all), species
  chip (event/belief/intent/observation/dream)
- Garden canvas 360×528: WebGL or SVG (≤200 seeds → SVG; >200 →
  defer to Canvas with throttled redraw)
- Bottom strip 360×60: [Random seed] [Reset filter] [DREAM-replay]

BLOSSOM SHAPE:
- Base 12×12 SVG petal (5 petals or 6 petals, irregular)
- Scale ×0.6..×3 by importance/growth_factor
- Color: HSL(valence×360, arousal×100%, 0.5 + dominance×0.2)
- Position: x = (now - time)/timeRange × 360 — newer right
            y = lat-normalized [0..1] × 528 — north top

INTERACTION:
- Pinch-zoom 0.5×–4×
- One-finger pan
- Tap blossom → slide-up bottom sheet (60% height) with GlassCard:
  - Fact text (var(--serif) italic)
  - Emotion badges: valence chip, arousal chip
  - Pollinators: 3-5 related seed mini-blossoms
  - Time + place
  - Actions: [Replant] [Prune] [Pollinate] [Promote to Sealed]
- Long-press blossom → multi-select mode for batch ops

EMPTY STATE: 5-10 ghost-outlined placeholder blossoms drifting
gently. Title "Поки тут пусто" + hint "Кожен факт що PHANTOM
запам'ятає виросте тут квіткою."

LIVING UI VARIANTS:
- DREAM: blossoms drift slowly, slight blur, last day's blooms fall
  as petals
- SENTINEL: filter strip turns coral, only high-arousal blossoms
  visible (others fade to outline)
- GHOST: blossoms become outlined silhouettes, colors muted

REUSE: GlassCard (sheet), Banner (status messages), filter chips
follow AnimatedTabs visual.

EDGE CASES:
- 0 seeds → empty state above
- 5000+ seeds → render in chunks via OffscreenCanvas, downscale to
  6×6 base
- WebGL unavailable → fallback to flat SVG with reduced bloom count
=== END ===
```

### 4.2 Now screen — Predictive cache + Inbox + Mind cache

```
=== Surface request: NowScreen v2 (/now) ===

PURPOSE: dashboard combining: vitals snippet, predictive action
cache, latest 3 inbox lines, mind-cache 24h notes, quick actions.
Replaces older NowScreen v1 (Pulse+Inbox merger).

LAYOUT (360×640, no PrimaryActionBar this screen):
- Predictive card 360×96 — "Phantom передбачає…" GlassCard elevated
  with 1-2 pre-computed actions. Each row: action title (var(--mono)),
  reason ("ти зазвичай у цей час…"), [Commit] (primary chip)
  [Decline] (outline chip). If no predictions — DON'T render this
  card (skip it; do not show empty placeholder).
- Vitals strip 360×72 — VitalsRow + StatePill side by side
- Inbox glance 360×220 — last 3 proactive lines from
  `chat_messages.proactive=true`. Each line: timestamp (mono 9px),
  italic serif text, action chip if attached. Footer: "Усі →" link
  to /inbox
- Mind Cache 360×140 — "Занотовано на 24 год" header with mic-button
  on the right (60×60, long-press to add). Below: max 3 latest notes
  as horizontally-scrollable cards (260×100 each), each with
  TTL countdown ("21h" / "12h" / "2h") badge top-right
- Quick actions 360×96 — 4-cell grid (180×88 each in 2×2 wait, no:
  4 horizontal cells 90×88): [Voice] [Map] [Vault] [Senses]

NO PrimaryActionBar this screen — actions are inline.

LIVING UI:
- DREAM: predictive card replaced by Echo Chamber Detection card
  (alt-source quotes, muaro-blur)
- SENTINEL: vitals strip turns coral background, inbox filtered to
  high-arousal lines only
- GHOST: mind-cache section completely hidden (privacy)

REUSE: GlassCard, VitalsRow, StatePill, PrimaryActionBar (NO),
EmptyState (for inbox empty), Banner.

EDGE CASES:
- No predictions + no inbox + no mind notes → render only vitals +
  quick actions, full screen empty otherwise feels wrong → add a
  hero EmptyState with PHANTOM orb and "Спокійно. Жодних подій."
=== END ===
```

### 4.3 Pulse screen — SurfaceRegistry view (/pulse)

```
=== Surface request: PulseScreen (/pulse) ===

PURPOSE: show the SurfaceRegistry — every paired embodiment of
PHANTOM with state, location, attention, proximity. Operator can
manually focus a specific surface or send focus there.

LAYOUT (360×640):
- This-device hero card 360×120 — PhoneShell-style: avatar +
  identity row + "Цей пристрій" tag + connection state
- Section header 360×32 "Мережа PHANTOM-ів"
- Surface grid 360×appropriate: 2-column cards 168×140 (with 12px
  gap, 12px lateral padding):
  - Top-left of card: kind icon (32×32, glyph: 🖥 / 📱 / ⌚ / 👓 /
    📡 (esp32) / 🩹 (tactile))
  - Top-right: state pill (mini, 28px height)
  - Center: surface name + last_attention timestamp
  - Bottom: proximity bar (10px tall, fill = proximity 0..1)
  - On tap: bottom sheet with surface details + [Mirror here]
    [Send focus here] CTAs
- Bottom action 360×64: PrimaryActionBar [+ Pair new surface] which
  routes to /pair

LIVING UI:
- focused surface card: thicker accentBorder + pulsing dot in corner
- offline surface card: greyscaled, "офлайн з NN хв" instead of state pill

REUSE: GlassCard, PrimaryActionBar, StatePill (mini variant). New
component PhoneShell mini for surface card decoration.

EDGE CASES:
- Only this device paired → hero card + EmptyState below "Тільки
  цей пристрій. Спарити Wear/комп → /pair."
- 6+ surfaces → grid scrolls
=== END ===
```

### 4.4 Cognitive Continuity banner

```
=== Surface request: ContinuityBanner ===

PURPOSE: when operator picks up phone after switching from desktop,
banner offers to restore mental state (ThinkingFrame).

LAYOUT: position fixed below GlobalStatusBar, 360×56, slides down
on appear. After 30 seconds without interaction — slides up
(forgotten).

CONTENT:
- Left chip "→" with kind icon (chat / map / vault / voice)
- Center text: "Продовжити «{intent_label}» з десктопу?"
  (var(--sans), 13px)
- Right action [Підняти] primary chip 36px tall

LIVING UI: subtle pulsing border accent during the 30s window;
opacity fades from 1 → 0.4 over the window.

EDGE CASES:
- No frame to restore → banner doesn't render
- Multiple frames → show most recent only
=== END ===
```

### 4.5 Soul Print authenticator

```
=== Surface request: SoulPrintReauthModal ===

PURPOSE: surface when soul_score < 0.6 — ask operator to confirm
identity via biometric, with PIN fallback.

LAYOUT: modal sheet, 320 wide, centered, vertical:
- Hero icon 80×80 — abstract fingerprint shape
- Title "Це справді ти?" (var(--display) 22px)
- Subtitle: contributing factor breakdown — 5 mini-bars showing
  current vs baseline for voice/typing/gait/face/HRV
- Primary action: [Підтвердити біометрією] (PrimaryActionBar style)
- Secondary: "Ввести PIN" link

CRITICAL: don't make this feel hostile. Use warm tones. Operator may
have a cold so HRV is off — don't lecture.

CONTRIBUTING FACTOR BARS:
- Each bar: label (mono 9px) + current value 0..1 + baseline marker
- Color: green if within 0.15 of baseline, amber if 0.15-0.3 off,
  red if > 0.3 off

LIVING UI: rare to see; modal is dramatic — orb pulses red instead
of accent, but slowly (not aggressive).

REUSE: PrimaryActionBar styling, OrbView for hero, GlassCard.

EDGE CASES:
- Biometric unavailable → only PIN option
- Failed 3× → surface incident report + lock vault for 5 min
=== END ===
```

### 4.6 Time-Sliced Personas editor

```
=== Surface request: PersonasRing in MeScreen ===

PURPOSE: visualize and edit time-of-day persona overlays as a
24-hour compass ring.

LAYOUT: GlassCard 360×320, contains:
- Title row "Часові режими" (mono 10px, 0.22em letter-spacing)
- 24-hour ring 240×240 centered, with:
  - Outer ring 120px radius
  - 24 tick marks (4 highlighted: 0/6/12/18)
  - Colored arcs per persona slice — each arc = one time range
  - Current time marker = filled dot pulsing on the arc
  - Inner small label: current persona name + tone overlay summary
- Action row: [+ Додати слайс] button below ring
- Slice list 360×~120 vertical: each slice as a row with
  start-end time, persona name, tone summary, tap → edit modal

LIVING UI:
- DREAM: ring blurs slightly
- BACKSTAGE: ring fades to 40% opacity (privacy)

EDIT MODAL:
- Time picker (start, end) — wheel-style 24h
- Tone overlay sliders: warmth, brevity, formality, urgency
  (each -1 to +1)
- State bias presets: morning (FOCUS×1.5, DREAM×0), evening
  (DIALOGUE×1.3, SHADOW×0.7), custom

REUSE: GlassCard, sliders styled like existing settings sliders.

EDGE CASES:
- 0 slices → ring shows "default 24h" single arc, primary CTA "+
  Створити перший слайс"
- Overlapping slices → most-specific (shortest duration) wins;
  conflict marker on ring
=== END ===
```

### 4.7 Federated Voice (Whisper) settings

```
=== Surface request: WhisperSettings in MeScreen ===

PURPOSE: control PHANTOM-to-PHANTOM whisper consent + per-peer
allowlist.

LAYOUT: collapsible Section block (360×~280 when open):
- Master toggle: "Дозволити PHANTOM-ам спілкуватися навколо мене"
  (existing settings-toggle pattern)
- When OFF: subtitle "Жодних обмінів. PHANTOM мовчить біля чужих
  PHANTOM-ів."
- When ON:
  - Trust mode picker (radio): paranoid (require ROOT bio per
    exchange) | trusted (allowlist auto-accept) | gregarious
    (anyone in proximity, audit-only)
  - Allowlist 360×140: list of known peers, each row:
    name@phantom.host + last whisper timestamp + scope chips
    (read-state | read-context | read-mood) + [✕] revoke
  - "Виявлені поряд" 360×100: live mDNS-sniffed peers (refresh
    every 15s), each with [+ Allowlist]

LIVING UI:
- Active whisper happening NOW: tiny pulse dot in section header

REUSE: Section component (existing in MeScreen), GlassCard, chip
styling.

EDGE CASES:
- No discovered peers + empty allowlist → EmptyState "Поки нікого
  поряд. Whisper активується автоматично коли інший PHANTOM з
  довіри з'явиться."
=== END ===
```

### 4.8 Vault — Federated capability cards

```
=== Surface request: VaultScreen — federated cards section ===

PURPOSE: existing VaultScreen needs new section for cards shared TO
operator (not from), with explicit capability scope display.

INSERTION POINT: in existing VaultScreen, between "особистий vault"
section and "ghost · local only" section.

LAYOUT: new section 360×variable height:
- Header row: "↩ Спільне зі мною" (mono 10px) + count + filter
  chip (read-only / actionable)
- Card list — each shared card 360×~80:
  - Ribbon top-left: "shared by {name@host}" with avatar
  - Card label + kind chip
  - Scope badges horizontal: [read.label] [read.public]
    [use.email] etc — each badge has tooltip on tap
  - Expiry footer: "до {date}" mono 9px
  - Tap → expanded view with: capability scope detailed, [Use]
    (if use.* scope), [Request more] (initiates request to grantor)

LIVING UI:
- Capability about to expire (< 24h): amber border accent
- Revoked by grantor: card greys out, ribbon "revoked" + dismiss
  CTA

REUSE: existing VaultScreen card layout, GlassCard, Banner.

EDGE CASES:
- 0 shared cards → don't render section header at all (don't show
  empty)
=== END ===
```

### 4.9 Mind Cache mic + notes

```
=== Surface request: MindCache mic + notes (in NowScreen) ===

PURPOSE: 24h scratchpad — quick-note via mic-button or text, with
auto-promote indicator.

INTEGRATION: lives inside NowScreen v2 (see §4.2). This is the
component spec for that section.

LAYOUT: 360×140 GlassCard:
- Header row 360×24: "Занотовано на 24 год" (mono 10px) + counter
  "{n} нотатки" (mono 9px ink3, right-aligned)
- Mic button 60×60 absolute top-right: round button, accent color,
  mic glyph 24×24. Long-press 550ms → starts recording (visual:
  pulsing red ring + level meter via Waveform). Release → uploads
  to /mind-cache/note with audio MIME.
- Notes scroller 360×~100 horizontal: each note card 260×88 with
  16px gap:
  - Top-left: TTL chip (mono 9px) "21h" / "12h" / "2h" — color
    progresses from green → amber → red
  - Center: text snippet (sans 13px), max 3 lines
  - Bottom-right: source glyph (mic / text / inferred)
  - Tap card → expanded modal with full text + [Promote to Tactical]
    [Discard] actions

AUTO-PROMOTE INDICATOR: when note is being graded by garden_tick
for promotion, card shows soft bloom animation (radial gradient
glow expanding 0 → 1 → 0 over 1.5s, single shot)

LIVING UI:
- DREAM: notes drift, mic disabled (don't interrupt)
- BACKSTAGE: notes section fully hidden

REUSE: GlassCard, Waveform component, Banner for transcribe errors.

EDGE CASES:
- 0 notes → render section but with EmptyState compact "Утримуй мікро
  щоб занотувати на 24 год"
- 4+ notes → only show 3 most recent in scroller, tap "Усі →" goes
  to dedicated /mind-cache screen
=== END ===
```

### 4.10 Backstage Mode UI

```
=== Surface request: BackstageMode listener + summary ===

PURPOSE: silent listener active during DIALOGUE-with-other-human
state. Visual is mostly absent — only signature + post-conversation
summary.

VISUAL SIGNATURE (active state):
- GlobalStatusBar opacity → 60%
- StatusBar dot: soft-grey, no animation
- Mic icon (new chip in StatusBar, between connection-dot and
  clock): 14×14, pulsing 1×/sec to confirm "I'm listening"
- NO toaster, NO banner during. NEVER interrupt.

SUMMARY MODAL (post-conversation):
- Triggers when BACKSTAGE state ends + transcribed length > 60s
- Modal: "Я почув. Ось що зрозумів"
- Body GlassCard:
  - Participants chip row (1-N detected voices)
  - Conversation duration + location + time
  - Key facts list 3-7 bullets, each with "[Save fact]" inline
  - Promises detected list with "[Schedule]" CTAs
  - Free-text summary ~3 sentences
- Footer actions: [Save all] [Discard all] [Selective] (toggles per
  bullet)

PRIVACY:
- All transcription on-device (whisper-tiny). NEVER uploaded.
- Modal can be dismissed; transcript auto-deletes after dismiss.

LIVING UI:
- Variant: if operator marked BACKSTAGE as "do not record" via voice
  command — visual signature doesn't appear, no summary

REUSE: Modal, GlassCard, Banner for save confirmations.
=== END ===
```

### 4.11 Predictive Action card

```
=== Surface request: PredictiveActionCard component ===

PURPOSE: NowScreen top card showing 1-2 pre-computed actions Phantom
predicts operator will want.

LAYOUT: 360×96 GlassCard elevated, accent border = primary:
- Header row: "PHANTOM ПЕРЕДБАЧАЄ" (mono 10px primary, 0.22em)
  + "{confidence}%" mini chip on right
- Body 1-2 stacked rows, each ~36px tall:
  - Action title (sans 14px, 600 weight)
  - Reason inline: "ти зазвичай {context}" (mono 10px ink3)
  - Right-aligned chips: [Commit] (primary fill) [Decline] (outline)

INTERACTION:
- Commit → dispatches the action, shows Banner success
- Decline → trains the Decision Transformer (POST /predictive/feedback
  with negative weight). Card fades out 240ms.

LIVING UI:
- DREAM: card replaced by EchoChamberCard variant (different colors,
  alt-source styling)
- SENTINEL: card hidden (no time for predictions during alarm)

EDGE CASES:
- 0 predictions → render NOTHING. Don't keep empty card.
- 1 prediction with confidence < 30% → don't render
=== END ===
```

### 4.12 Echo Chamber card (DREAM only)

```
=== Surface request: EchoChamberCard (DREAM state, NowScreen) ===

PURPOSE: surface 1-3 alt-source perspectives when echo-chamber Gini
> 0.7. Only renders in DREAM state.

LAYOUT: 360×140 GlassCard subtle, muaro-blur background image:
- Header "ОСЬ ЩО ПИШУТЬ ПО-ІНШОМУ" (mono 10px primary)
- 1-3 alt-source quotes, each 1-2 lines (var(--serif) italic):
  - Source attribution mono 9px ink3
  - Quote text serif italic 13px ink2

INTERACTION:
- Tap quote → opens source URL in browser (via deeplink)
- Long-press quote → "Зберегти у Memory Garden як seed"

LIVING UI:
- ONLY renders in DREAM state. Other states completely hide.
- Soft drift animation: each quote moves 4px up/down independently
  on 8s sine wave

REUSE: GlassCard, var(--serif) italic.
=== END ===
```

### 4.13 Crisis Drill flow

```
=== Surface request: CrisisDrillScreen (/me Розробник section) ===

PURPOSE: 5-step modal walking through DR rehearsal.

STEPS (modal sequence, NOT a screen):
1. Intro: "Drill rehearsal. Безпечно — це симуляція."
   [Розпочати] [Скасувати]
2. Backup check: live progress bar during integrity verify
3. Mirror restore: simulate restore-from-backup with checkpoints
4. Service flip: simulate fail-over to Cloud Mirror (or local
   Radxa-mirror if no cloud)
5. Recovery: simulate operator login + state recovery
6. Post-mortem: generated PDF preview, [Download] [Share to phantom]

EACH STEP MODAL: GlassCard centered 320×400:
- Step number "Крок {n}/5" mono 10px
- Step title + description
- Live indicator: simulated progress bar OR check-list with
  animated ✓ as items complete
- Footer: [Далі] [Перервати]

LIVING UI:
- The drill itself is dramatic — orb turns coral during steps,
  StatusBar shows "DRILL" badge between dot and clock

REUSE: Modal, OrbView, PrimaryActionBar.

EDGE CASES:
- Real backup integrity failure during drill → drill ABORTS, surfaces
  real banner "Реальна проблема: {error}. Не drill — це справжнє."
- Operator interrupts → drill state saved, can resume from same step
=== END ===
```

### 4.14 Sensory Substitution (/substitute)

```
=== Surface request: SensorySubstituteScreen (/substitute) ===

PURPOSE: video → audio scene description engine UI.

LAYOUT (360×640 minus chrome):
- Top section 360×80: source picker as horizontal AnimatedTabs:
  [Камера] [Dashcam] [Shared link] [Інше]
- Live preview 360×240: video frame at 30% opacity (just for sanity)
- Settings GlassCard 360×140:
  - Voice picker (TTS voices) — list of 3-5 available voices
  - Verbosity slider: terse / normal / detailed (3-stop)
  - Pause-on-silence threshold: 1s / 3s / 5s / off
- Live narration audio strip 360×60: Waveform component +
  current-text caption at bottom (var(--serif) 13px italic)
- PrimaryActionBar [Старт] / [Стоп]

LIVING UI:
- Active narration: caption text glows briefly when new sentence
  generated

EDGE CASES:
- No camera permission → EmptyState with [Дозволити] CTA
- Source unreachable → Banner error, fallback to camera
=== END ===
```

### 4.15 Agent Markets (/agents)

```
=== Surface request: AgentMarketsScreen (/agents) ===

PURPOSE: manage operator's agents — own, team-assembled, importable
bundles.

LAYOUT (360×640, with PrimaryActionBar):
- Header strip 360×52: AnimatedTabs [Мої] [Команда] [Імпорт]
- Content 360×460 — list per tab:
  • Мої: list of operator's agents, each card 360×104:
    - Avatar 56×56 left
    - Name + capabilities chips middle
    - Last-run timestamp footer mono 9px
    - Right column: [Run] (primary) [...] (overflow → Edit, Export)
  • Команда: agents currently assembled into active teams
  • Імпорт: file-picker drag zone OR list of available bundles
    on local registry
- PrimaryActionBar contextual:
  • Мої tab: [+ Створити агента] → opens Studio
  • Команда tab: [Зібрати команду] → assemble flow
  • Імпорт tab: [Обрати bundle файл]

IMPORT FLOW:
- File picker → reads .phantom-agent-bundle-v1.zip
- Verifies signature
- Modal showing: agent name, author, required capabilities,
  required MCP servers, [Прийняти ризик] (ROOT bio confirm) [Скасувати]
- Success: agent added to "Мої" tab

LIVING UI:
- During import: progress + signature verify steps
- Currently-running agent: pulsing ring on avatar in list

REUSE: GlassCard, PrimaryActionBar, AnimatedTabs, Modal.

EDGE CASES:
- Bundle signature invalid → BLOCK import, surface error
- Required MCP server unavailable → warn but allow import (agent
  partial)
- Operator already has agent with same id → ask overwrite/keep both
=== END ===
```

### 4.16 Interruption Budget detail

```
=== Surface request: InterruptionBudgetSheet (StatusBar tap) ===

PURPOSE: when operator taps the budget droplet in GlobalStatusBar,
slide up a sheet with current budget + history + deferred items.

LAYOUT: bottom sheet 360×500 slide-up:
- Hero strip 360×80: large droplet visual showing current /30,
  pulsing if > 15, shrinking if < 5
- History 360×200: 24-hour timeline showing every interruption
  cost (small ticks on x-axis with timestamp tooltip)
- Deferred items list 360×220: items PHANTOM held back, each row:
  - Title + reason ("утримав через budget")
  - Deferred timestamp
  - [Surface now] inline action

LIVING UI:
- Budget < 5: droplet looks visibly low, history bar redder

REUSE: Modal (sheet variant), GlassCard, Banner.

EDGE CASES:
- 0 deferred items → don't show that section
- Budget at 30 (max) → hero shows "повний — Phantom тиху годину"
=== END ===
```

---

## §5. Desktop surface requests

### 5.1 Agent Bridge (operator console)

```
=== Surface request: AgentBridge — desktop operator console ===

PURPOSE: replace existing AgentReportScreen + AgentTimeline +
DecisionCard + PlanTree. New multi-pane "operator bridge" that
shows agent's full live capabilities, morphs by phase
(plan/exec/review).

VIEWPORT: 1024×600 desktop (no scroll on root).

HEADER STRIP 1024×44:
- Goal title (sans 16px) | phase pill PLAN/EXEC/REVIEW (mini StatePill)
  | step counter "3/8" mono | timer 02:14 mono | cost "$1.4k" mono
  | pause/abort buttons right-aligned

MAIN GRID 1024×500 (after header) — split adaptive:

PHASE = PLAN:
┌─ Plan Tree 380×400 ─┬─ Trajectory 364×400 ─┬─ Artifact 280×400 ─┐
└─────────────────────┴───────────────────────┴────────────────────┘
┌─ Specialists Grid 1024×60 ──────────────────────────────────────┐
└──────────────────────────────────────────────────────────────────┘

PHASE = EXEC:
┌─ Plan Tree 280×400 ─┬─ Trajectory 480×400 ─┬─ Artifact 264×400 ─┐
└─────────────────────┴───────────────────────┴────────────────────┘
┌─ Tool Lane 720×60 ──────┬─ Async Panel 304×60 ────────────────────┐
└──────────────────────────┴────────────────────────────────────────┘

PHASE = REVIEW:
┌─ Plan summary 280×400 ─┬─ Trajectory 264×400 ─┬─ Artifact 480×400 ─┐
└────────────────────────┴───────────────────────┴────────────────────┘
┌─ Lesson Distilled 1024×60 ───────────────────────────────────────┐
└──────────────────────────────────────────────────────────────────┘

PANES (each spec):

PLAN TREE:
- Hierarchical goal tree, indented
- Each node: ✓ / ◐ / ○ glyph + title + estimated cost mini-chip
- Active node: pulsing accent border
- Drag to re-prioritize
- Double-click → expand/collapse

TRAJECTORY:
- Vertical scroll, virtualized
- Each step = DecisionCard (existing) — BUT enhanced:
  - Header: step n + author specialist avatar + timestamp
  - Body: input → reasoning → action verb (mono) → result
  - Footer: cost token chip + duration chip + [Re-route from here]
    [Ask council] [Send to phone]
- Active step: accent border pulse

ARTIFACT:
- Three modes auto-selected by content type:
  • code → Monaco with diff (added/removed lines tinted)
  • file-tree → folder hierarchy
  • text → markdown render
- Header: artifact name + type + [Send to phone] button

SPECIALISTS GRID:
- 4×6 grid of 24 chips (23 roles + planner)
- Each chip 80×30: avatar 16×16 + role mono name + state dot
- States: idle (grey) / thinking (amber pulsing) / acting (primary)
  / blocked (coral) / done (green check)
- Hover tooltip: role description + current task
- Click → filter trajectory by this specialist

TOOL LANE (EXEC phase only):
- Last 8 tool calls visible, scroll horizontally for older
- Each call: provider icon (mcp/agent/drive/vault/garden) + verb name
  + status dot (pending/done/failed)
- Click call → expands to show args+result inline

ASYNC PANEL:
- Multiplexer that picks ONE active sub-pane based on what's active
  this moment:
  • COUNCIL — when high-risk action is voting: 5 specialist avatars
    + per-agent stance + tally bar
  • APPROVAL — when phone-side approval pending: device + payload
    + waiting indicator
  • MEMORY — when garden access happened recently: 3 hit-blossoms
    visualized
  • COST — when nothing else active: rolling token+latency timeline
- Tab-bar across top to switch manually if needed

LESSON DISTILLED (REVIEW phase only):
- 1-sentence summary (var(--display) 16px)
- 3 bullets (sans 13px)
- [Promote to Memory Garden] [Discard] [Edit] CTAs

LIVING UI:
- DREAM: console still works but accent shifts violet
- SENTINEL: Plan Tree turns coral, only critical-path nodes visible
- PAUSED: Async Panel expands to full width, all other panes muted

REUSE: existing DecisionCard (with extensions), Monaco editor,
GlassCard.

EDGE CASES:
- No active goal → render hero EmptyState "Жодного активного завдання.
  Дай goal в чаті щоб запустити агента."
- Single-step trajectory → don't morph to EXEC layout, keep PLAN
- Agent crashed → red banner top + Async Panel shows error stack
  + [Retry from last good step] CTA
=== END ===
```

### 5.2 Memory Garden desktop

```
=== Surface request: MemoryGarden desktop (/garden) ===

VIEWPORT: 1024×600. Reuse mobile blossom mechanics but bigger
density, multi-pane interaction.

LAYOUT:
- Top filter ribbon 1024×56 — same chips as mobile but inline,
  more options visible
- Garden canvas 768×504 — main area, WebGL
- Right sidebar 256×504 — inspector panel:
  - Selected blossom details
  - Pollinators list (clickable)
  - Time-anchor mini-chart
  - Action bar [Replant] [Prune] [Promote] [Pollinate]
  - At bottom: "Last week's blooms" timeline

INTERACTION (desktop):
- Cursor pan/zoom (drag + scroll)
- Click blossom → inspector loads (no modal)
- Multi-select: shift+click or rectangle drag
- Keyboard: Esc clears selection, Cmd+A selects all visible

LIVING UI: same variants as mobile but renderable at higher density
(up to 5000 blossoms with WebGL).

REUSE: GlassCard for inspector, garden canvas shared with mobile.
=== END ===
```

### 5.3 Time-travel timeline (/timeline)

```
=== Surface request: TimelineScreen (/timeline) — desktop only ===

PURPOSE: scroll-back through full history of state transitions,
chat turns, sensor batches, vault accesses. Click any frame →
restore working memory at that moment.

LAYOUT (1024×600):
- Top filter strip 1024×52 — date range, event types, surface
  filter
- Timeline canvas 720×548 — vertical virtualized list:
  - Each row 56px: timestamp (mono 11px) | event-type chip |
    state-color sidebar (4px) | event summary (sans 13px) |
    surface chip
  - Group header rows show hour boundaries
- Right detail panel 304×548 — selected event:
  - Full event payload formatted
  - "What was on screen at this moment" mini-screenshot reconstruction
  - Reachable entities (chat session, vault card, garden seed) as
    deeplink chips
  - [Restore mental state] CTA

INTERACTION:
- Mouse wheel scrolls timeline
- Click event → loads detail panel
- Cmd+click → multi-select for export
- Double-click → "restore" — actually restores all surfaces to
  that moment (read-only replay)

LIVING UI: not really applicable — timeline is metadata. But subtle
state-color sidebar reflects historical state at each point.

EDGE CASES:
- 100k+ events → virtualize aggressively, keep scroll smooth
- Restore conflicts (e.g., open chat session was deleted) →
  surface gracefully with placeholder "session no longer exists"
=== END ===
```

---

## §6. Operator-supplied assets template

Якщо у тебе вже є нові ассети — встав цей блок між addendum-ом і
surface request:

```
=== ADDITIONAL DESIGN ASSETS (operator-supplied) ===

LOGO:
<inline svg or path>

NEW FONT TOKENS:
- var(--display-2) = "Inter Display", weight 700-900, used for
  blossom names + artifact titles
- var(--mono-condensed) = "JetBrains Mono", letter-spacing tighter
  for cost timeline

NEW COLOR TOKENS:
- --shimmer-warm: linear-gradient(135deg, #C97B16, #F4AF25, #C97B16)
  used for predictive cards
- --garden-petal-default: #f7e3c5 (light) / #4d3217 (dark)

NEW MOTION PRESETS:
- spring(damp:14, stiff:180) = "garden bloom", used for blossom
  scale-in
- spring(damp:22, stiff:300) = "snap" for council vote results

REFERENCE SCREENS (operator's previous design iterations):
- <link or attached image>
- <link or attached image>

OBSERVED PATTERN OPERATOR LIKES:
- Soft amber glow on focused element (not just border, full
  16px halo with low opacity)
- Sharp corner radii on top of cards, soft on bottom (creates
  "growing from below" feel)
- Iconography: line glyphs only, never filled solids

OBSERVED PATTERN OPERATOR DISLIKES:
- Bright color floods (always tinted, never pure)
- Pop-in/pop-out modal animations (use slide instead)
- Icon-only buttons without labels on desktop

=== END ASSETS ===
```

---

## §7. Quick checklist before sending to Claude Design

1. Universal prelude inserted? (§1)
2. Mobile or desktop addendum picked? (§2 / §3)
3. Operator-supplied assets pasted if you have any? (§6)
4. Specific surface request copied? (§4 / §5)
5. Output format reminder at the end ("single HTML, inline CSS+SVG,
   JSX skeleton at bottom")?

If yes to all 5 — send. Expect output in 30-90 seconds. Lift JSX
skeleton into `src/components/`, replace placeholder logic with real
state hooks, ship.

---

## §8. Recommended sending order (sequence for full upgrade)

If you're going to redesign from scratch using this library, follow
this order to avoid component dependencies missing:

1. NowScreen v2 (§4.2) — depends on existing primitives only
2. PulseScreen / SurfaceRegistry (§4.3) — needs PhoneShell mini variant
3. Memory Garden mobile (§4.1) — needs garden canvas component
4. Memory Garden desktop (§5.2) — reuses mobile canvas
5. Mind Cache widgets (§4.9) — reuses Waveform
6. Backstage Mode UI (§4.10) — small + isolated
7. Predictive + Echo Chamber cards (§4.11, §4.12) — render in NowScreen
8. Soul Print modal (§4.5) — global, render once
9. Time-Sliced Personas (§4.6) — embed in MeScreen
10. Whisper settings (§4.7) — embed in MeScreen
11. Cognitive Continuity banner (§4.4) — global
12. Vault federated section (§4.8) — extend VaultScreen
13. Agent Markets (§4.15) — new screen
14. Sensory Substitution (§4.14) — new screen
15. Crisis Drill (§4.13) — new screen, modal-driven
16. Interruption Budget sheet (§4.16) — global on tap
17. Agent Bridge desktop (§5.1) — biggest, do last
18. Time-travel timeline (§5.3) — final

Each surface should be one Claude Design round. Don't try to bundle.

---

## §9. After Claude Design — integration checklist

For each generated component:

1. Lift JSX skeleton into `src/components/<feature>/` (mobile) or
   `src/frontend/src/components/<feature>/` (desktop)
2. Replace any inline data with proper zustand store hooks
3. Type strictly — add `Props` interface, no `any`
4. Theme prop must come from `useThemeContext()` and respect
   `themeOverride` for showcase
5. Add to BottomNav (mobile) / OperatorLayout (desktop) if it's
   a primary screen
6. Add legacy redirect if replacing existing route
7. Write at least 3 vitest cases: empty state, normal data,
   edge case
8. Update `src/i18n/strings.ts` with new copy keys (UA + EN)
9. Build APK + smoke test on real device
10. Commit atomically

This file is canonical — when adding a new feature spec, append it
here with version bump in the changelog below.

---

## §10. Changelog

- 2026-05-04 — initial release. 16 mobile surfaces + 3 desktop
  surfaces + universal contract + send order + integration
  checklist.
