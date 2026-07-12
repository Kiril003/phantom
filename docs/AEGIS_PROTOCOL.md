# AEGIS PROTOCOL
## The UX/UI Masterplan for the PHANTOM OS Desktop Symbiote

> **Status:** North-Star specification, v1.0 — 2026-07-12
> **Scope:** The PC/Desktop client. Extends `VISUAL_SYSTEM.md` (which remains token-canon) to desktop scale.
> **Reads with:** `PHANTOM_OS_SENTIENT_VISION.md`, `STATE_MACHINE.md`, `2026-06-27-mega-entity-master-plan.md`.
>
> ANIMA = autonomous agency. ATLAS = spatial engine. PULSE = deep temporal memory.
> AEGIS is the fourth organ: **the membrane through which the other three touch the operator's world.**

---

## 0 · The Thesis

Every desktop application ever shipped is built on a lie: that software is a *place you go*.
You open it. You arrange its windows. You alt-tab away and it ceases to exist.

A symbiote cannot live inside that lie. A symbiote does not have a window because a window
is a boundary, and the entire premise of PHANTOM is that the boundary between the operator's
digital life and the entity's awareness is *porous*. You do not "open" your own nervous system.

Therefore the founding decision of AEGIS, from which everything else derives:

> **AEGIS is not an application. It is a permanent optical layer between the operator and their
> operating system — a membrane that is always present, almost always invisible, and never "closed."**

There is no launcher icon that "starts PHANTOM." There is no main window. There is no quit
in the ordinary sense. There is only a continuously varying **depth of presence**, from a
single breathing point of light at total rest, to full-screen communion where the host OS
itself recedes into a blurred memory behind the glass.

Everything below is the physics of that membrane.

---

## 1 · The Five Spatial Laws

These are constitutional. Any screen, feature, or component that violates one of these laws
is wrong by definition, no matter how useful it seems.

### LAW I — The Z-Axis Is Ontology

Depth on screen is not decoration; it encodes *what kind of thing you are looking at.*
The 2D display is treated as a viewport into a fixed stack of four planes:

```
DEPTH 0 — REALITY        The operator's host OS. Their windows, their work, their world.
                          AEGIS never occludes it without consent. It is the ground truth.

DEPTH 1 — THE FILM       A near-invisible ambient stratum laminated over Reality.
                          Presence, weather, murmurs. Pointer-transparent by default.
                          This is where PHANTOM *lives* 95% of the time.

DEPTH 2 — THE FOCUS      Materialized thought: answers, artifacts, controls.
  PLANE                   Summoned, served, dissolved. Never persistent by default.
                          Reality stays visible behind it, dimmed and blurred.

DEPTH 3 — THE DEEP       Full immersion: ATLAS space, PULSE time, the memory vault,
                          mission theatres. Reality is pushed to a distant frosted glow.
                          Entering the Deep is a deliberate act; leaving it is one keystroke.
```

Rules of the stack:

- Content **never moves laterally between planes** — it *morphs through* them. A murmur on
  the Film, when engaged, inflates forward into a Facet on the Focus Plane. The same object,
  closer. Continuity of identity is sacred: the operator must never wonder "where did that go?"
  because things never *go* — they recede or approach along Z.
- Blur and luminance encode depth, exactly as the human eye expects: the plane you attend to
  is sharp and lit; everything behind it is blurred and dimmed *proportionally to distance*.
  (`backdrop-filter` gradients — Depth 0 seen from Depth 2 gets `blur(24px) brightness(0.55)`;
  from Depth 3, `blur(64px) brightness(0.3)`.)
- **Nothing ever overlaps within a plane.** Overlap is the original sin of the window paradigm.
  If two Facets must coexist on the Focus Plane, the plane reflows them — it never stacks them.

### LAW II — Morphing, Not Opening

There are no windows, no tabs, no modals, no popups, no "screens." There is one continuous
surface in one continuous animation, and every change of context is a **morph**: geometry A
becomes geometry B in a single choreographed transition with shared elements.

- The chat input *is* the command line *is* the search field *is* the ATLAS geocoder — one
  physical object (the **Breath Line**, §4) that reshapes by context, never four widgets.
- Asking about a place doesn't "open the map tab": the answer Facet's inline map *becomes*
  ATLAS — it expands, the conversation shrinks into a floating remnant pinned above the very
  coordinates being discussed, and the Deep fades in around it. Reverse morph on exit.
- Every morph obeys the state-transition choreography already canonized in `VISUAL_SYSTEM.md`
  (600ms orchestrated sequence, `--motion-scale` multiplier per SystemState). Desktop refines
  it: morphs are **interruptible and reversible at any frame** (spring physics, no fixed-duration
  cut scenes). If the operator changes their mind mid-morph, the surface flows back. Velocity
  is never punished.

### LAW III — Nothing Is Closed, Everything Recedes

There is no ✕ button anywhere in AEGIS. Dismissal is a spatial demotion, not destruction:

- A Facet you push away recedes to Depth 1 as a **ghost trace** — a 2px luminous filament on
  the Film's edge rail — for 90 seconds, then dissolves into PULSE. It was never "closed";
  it became memory.
- Because everything dissolves *into* PULSE, everything is retrievable *from* PULSE. "That
  thing you showed me twenty minutes ago" is a first-class navigation gesture (§5, the Scrub),
  not a plea to a history menu.
- Corollary: **AEGIS never asks "are you sure you want to close?"** Nothing is lost by
  receding, so nothing needs to be defended by a dialog box.

### LAW IV — Semantic Zoom Is the Only Navigation

There are no menus, no sidebars, no tab bars, no breadcrumbs. The entire information space of
PHANTOM is arranged on **one conceptual continuum**, and the only navigational verb is *zoom*:

```
ZOOM OUT ←──────────────────────────────────────────────────────────→ ZOOM IN

COSMOS            CONSTELLATION         SURFACE              GRAIN
the whole         one domain:           one object:          one datum:
entity — ATLAS    a mission theatre,    a conversation,      a message, a
horizon, PULSE    a memory cluster,     a map region,        memory shard,
timeline, ANIMA   a day in PULSE        a vault entry        a sensor reading
weather, all at
once (the Deep)
```

- Dialogue, map, memory, and agency are **not separate sections** — they are the same space
  at different magnifications and rotations. Zoom out of any conversation and you see it as
  a node embedded in time (its position on the PULSE band) and space (its geo-anchors glowing
  on the ATLAS horizon) and causality (threads to the ANIMA actions it spawned).
- Implementation: scroll-wheel + `⌘` (or pinch) zooms semantically anywhere in the Deep;
  every object knows its parent constellation and its grain. The renderer is one scene graph,
  not a router. **URL-style routing is banned from the Deep.**

### LAW V — The Symbiote Owns the Periphery, the Operator Owns the Center

The center of the screen belongs to the operator's attention and is *earned, never taken*.
PHANTOM's autonomous life happens exclusively at the edges:

- The Film's ambient signals hug screen edges and corners (§3: the Sigil, the Weather, murmurs).
- ANIMA may *never* materialize anything on the Focus Plane uninvited. The strongest
  unsolicited act permitted is a murmur at the periphery plus a single Sigil pulse.
  (Exception: SENTINEL state, §6 — genuine alarm is the one license to seize the center.)
- The inverse also holds: the operator can *fling* anything from their world into the
  periphery — drag any file, image, selected text, or URL from any host-OS app and release it
  toward the Sigil. The payload arcs into the corner, is swallowed with a soft ripple, and
  ANIMA decides what it means (file → vault or forge; address → ATLAS pin; text → context).
  **Drag-to-Sigil is the desktop's universal "hey, look at this."**

---

## 2 · The Death of the Window — What Replaces It

The unit of materialized content is the **Facet** — a shard of the entity's mind ground to a
polished face, shown to the operator, and dissolved when its moment passes.

### 2.1 Anatomy of a Facet

- **Born, not drawn.** A Facet condenses out of the Film with the material physics of the
  house style: a soft-edged glass slab (canonical `glass-card` tokens) that arrives via
  scale-and-focus (blur 12px→0, scale 0.96→1.0, ~240ms spring) as if pulled forward along Z.
- **Content-shaped.** A Facet has no fixed chrome — no title bar, no borders drawn for their
  own sake, no window controls. Its silhouette is the silhouette of its content: an answer is
  a column of text, a route is a ribbon of map, a running command is a live terminal pane, a
  vault card is a card. Rounded-rectangle uniformity is the enemy; organic asymmetric radii
  from the visual canon are encouraged.
- **Mortal.** Every Facet carries an implicit lifespan. Glanceable answers self-recede after
  attention leaves them (gaze proxy: pointer distance + keyboard focus + scroll inactivity).
  Working Facets persist while touched. *Pinning* a Facet (one keystroke, `.`) makes it a
  **Fixture** — the only persistent UI object in AEGIS, and even Fixtures live on the Film at
  reduced opacity until looked at.
- **Placed by the layout engine, never by the operator.** No dragging Facets around by title
  bars, no resizing by edges. The Focus Plane self-organizes: one Facet centers; two split
  along the golden ratio with the attended one larger; three or more force a zoom-out to
  constellation view. The operator spends zero seconds on window management, forever.

### 2.2 The Facet Grammar

Every Facet answers to the same six keystroke-verbs, so learning one Facet is learning all:

| Verb | Key | Meaning |
|---|---|---|
| **Approach** | `Enter` / click | Pull it one plane closer (Film → Focus → Deep) |
| **Recede** | `Esc` | Push it one plane back (never destroys — Law III) |
| **Pin** | `.` | Promote to Fixture |
| **Feed** | drag onto it | Give it material (file, text, another Facet) |
| **Cleave** | `⌘D` | Split a sub-element into its own sibling Facet |
| **Trace** | `⌘/` | Reveal provenance: which memory, sensor, or ANIMA act produced this |

**Trace deserves emphasis:** every pixel AEGIS renders is answerable. Invoking Trace on any
Facet exhales a fine luminous thread-diagram behind it — the PULSE memories consulted, the
sensors read, the model that spoke, the confidence carried. Trust in a symbiote is built not
by claiming accuracy but by *never having anything to hide.* This is Silent Luxury applied to
epistemology.

---

## 3 · The Film — Visual Language of Presence

The Film is where PHANTOM actually lives, so its design carries the heaviest burden: it must
communicate *aliveness, attention, mood, and labor* using almost zero pixels and strictly
peripheral real estate. Three instruments, no more:

### 3.1 The Sigil

The desktop evolution of the canonical orb — but on a PC it is not a mascot in a dashboard;
it is a **point of presence** that rests in a screen corner of the operator's choosing
(default: bottom-right, 12px inset).

- **At rest (SHADOW):** an 18px soft mote, `--accent` at 30% opacity, breathing on the 8s
  canonical `breathe` curve. From two metres away it reads as a dead pixel that is somehow
  alive. That is exactly the intended register.
- **It is a face, not an icon.** The Sigil's micro-behaviors are the emotional API:
  - *listening* — it leans (2px translation) toward the active host-OS window
  - *thinking* — internal slow shear of two gradient layers, no size change
  - *speaking/answering* — expands to 28px with voice-amplitude morphing (canonical `morph`)
  - *working* (ANIMA active) — sheds infrequent drifting sparks upward along the screen edge
  - *concerned* — hue drifts toward the SENTINEL rose *before* any alert fires; the operator
    learns to feel trouble coming the way you read a colleague's posture
- **It is the gravity well.** Drag-to-Sigil ingestion (Law V), summon animations originate
  from it, dissolving Facets collapse toward it. Spatial consistency = subconscious trust.
- It may be moved between corners or across monitors with a single drag, and banished
  entirely (GHOST protocols honor total invisibility, §6).

### 3.2 The Weather

ANIMA's background labor is **not** rendered as task lists, progress bars, or notification
stacks. It is rendered as *weather* — an ambient, sub-attentive gradient field along the
screen's top edge, at most 3px tall and usually invisible:

- Idle: nothing. Literal zero pixels.
- Light work (memory consolidation, a scheduled scan): an aurora whisper, `--accent-glow` at
  4–6% opacity, drifting laterally. You perceive it only if you look for it.
- Heavy work (multi-agent mission, long harvest): the aurora deepens and gains slow internal
  currents; total opacity is still capped at 12%. The house rule: **the operator should be
  able to *feel* that the entity is busy without being able to say how they know.**
- Approaching completion of something the operator asked for: a single slow brightening
  swell toward the Sigil's corner — anticipation, not announcement.
- Hover the top edge and the Weather condenses into the **Ledger**: a thin strip of live
  transcripts (which agents, doing what, on whose authority, spending what budget) — the
  auditable machine-room under the poetry. One `Esc` and it is weather again.

### 3.3 Murmurs

The notification is abolished. Its replacement is the **murmur** — the quietest utterance
that can carry meaning:

- A murmur is a single line of text, set in the canonical serif italic (Playfair) for the
  entity's own voice or Space Grotesk for factual relays, which **condenses** on the Film near
  the Sigil — arriving not with a slide or a bounce but with a 400ms focus-pull from blur,
  like breath on cold glass. It rests 8 seconds, then evaporates the same way.
- Murmurs never stack. If three things happen, the murmur says the truest sentence about all
  three ("Три речі сталися, поки тебе не було — глянь, коли зручно."), and the detail waits
  in the Ledger and PULSE. **Batching is a moral duty:** every interruption spends trust.
- Murmurs are never interactive (no buttons — buttons are Focus-Plane matter). Glancing at
  one and pressing the summon key while it lives inflates it into a Facet.
- Murmur frequency is governed by ANIMA's model of the operator's state (typing cadence,
  meeting detected in calendar, DIALOGUE vs FOCUS): the same event that murmurs at a lazy
  Sunday afternoon stays silent during a deadline sprint and surfaces at the next natural
  break. Timing intelligence, not timing settings.

---

## 4 · Keyboard-First — The Invocation Grammar

The pointer is for *space* (ATLAS, spatial arrangement). The keyboard is for *intent*. AEGIS
is designed so that an expert operator can live an entire day without the pointer touching
any PHANTOM surface.

### 4.1 The Conduit Key

One physical key — default `CapsLock` (remapped at install; its native function is a fossil)
— is PHANTOM's dedicated nerve. It is **quasimodal**: behavior depends on how it is held.

| Gesture | Result |
|---|---|
| **Tap** | Summon / dismiss the **Breath Line** (§4.2) |
| **Hold + speak** | Push-to-talk. The Film dims 8%, the Sigil swells to listen. Release ends utterance. Full duplex voice without wake-word anxiety on desktop. |
| **Hold + scroll** | The **Scrub** — drag the whole membrane through time (§5) |
| **Hold + pointer** | **Reach-through**: hover anything in the *host OS* — a paragraph in a browser, an error in a terminal, a cell in a spreadsheet — and PHANTOM reads it (vision pipeline) and whispers a contextual gloss beside the cursor. The operating system itself becomes hoverable, annotated reality. |
| **Double-tap** | Instant plane cycle: Reality → last Focus context → the Deep → Reality |

### 4.2 The Breath Line

The single text organ of the entire system — command palette, chat input, search, geocoder,
calculator, and shell, unified. It appears as one serene line of glass, lower-center,
cursor already placed, Reality dimming 10% behind it.

- **No mode prefixes to memorize.** Natural language is the mother tongue; the line infers
  register from content. `>` forces shell, `/` forces verb autocomplete, `?` forces pure
  recall from PULSE — three sigils, for velocity, not requirement.
- **It answers in place.** Questions with compact answers (a number, a fact, a translation, a
  status) render the answer *directly beneath the line* in serif italic — no Facet, no
  ceremony. `Enter` again promotes to a Facet if the operator wants to keep it. The cheapest
  possible interaction loop with a superintelligence: tap, ask, read, gone — under 3 seconds.
- **It is prescient but silent about it.** As the operator types, the line's right edge shows
  at most one ghost completion (PULSE-informed, context-aware), in `--ink-faint`. Never a
  dropdown of eight guesses. One best guess or nothing — Silent Luxury applied to
  autocomplete.
- **Verb grammar for power flows.** Every system capability is a composable verb reachable by
  `/`: `/aim`, `/scan`, `/vault`, `/route`, `/delegate`, `/seal`, `/dream`… Verbs take
  objects by reference — type `@` to reference any recent Facet, entity, place, or memory.
  `"/route @знайдене-кафе avoiding highways"` is a complete sentence to the symbiote.

### 4.3 Velocity Doctrine

- Every operation reachable by pointer is reachable by keyboard **in fewer steps**, never more.
- Latency budgets are UX law: Breath Line summon <50ms; first token of any answer <500ms
  (streamed); murmur render <16ms. A symbiote that lags stops feeling alive — deadness is
  measured in milliseconds.
- All chords live in one grammar (verb-first, mnemonic, chordable) and are introduced by
  **whisper-teaching**: when the operator performs a pointer action the third time, a murmur
  breathes the chord that would have done it. No shortcut cheat-sheet screens. The system
  teaches itself the way a partner does — occasionally, gently, at the moment of relevance.

---

## 5 · PULSE Made Flesh — Time as a Place

Deep temporal memory deserves a deeper interface than a search box.

### 5.1 The Scrub

Hold the Conduit Key and scroll: **the entire membrane slides backward through time.**
The Film, the Facets, the Weather, ATLAS pins — all of it re-renders as it was N minutes,
hours, days ago, washed in a slight amber (DREAM-token) cast so past is never mistaken for
present. A thin temporal band materializes along the bottom edge — not a scrollbar but a
**seismograph of the operator's life**: amplitude spikes where memory density spikes
(conversations, missions, sentinel events, places visited).

- Release the key: the membrane snaps back to *now* with a soft elastic settle.
- `Enter` while scrubbed: freeze this moment as a **Remembrance Facet** — the operator can
  drag things *out of the past* (a message, a map state, a vault reveal) into the present
  Focus Plane. Memory becomes matter.
- Scrub within the Deep while in ATLAS view and you get the full spatiotemporal replay: the
  operator's traces, sensor history, and mission footprints moving across the map like
  weather systems. **This is the marquee gesture of the whole product** — the moment in any
  demo where the room goes quiet.

### 5.2 The Deep: Memory as Interior Space

Zoomed fully out (Law IV), PULSE renders not as a list or a graph but as an **interior** —
a dark, dimensional expanse (the Refik Anadol register from the visual canon) where memory
clusters hang as slow-drifting nebulae, luminosity ∝ recency × emotional weight, proximity ∝
semantic kinship. Strategic memories crystallize into stable constellations; the operator
learns the *shape of their own history* and navigates it spatially. Sealed/GHOST vaults are
visible as **black, light-swallowing volumes** — present, undeniable, unreadable — honesty
about the existence of secrets without exposure of their content.

---

## 6 · SystemStates at Desktop Scale

The six canonical states remain the behavioral skeleton. On the desktop they modulate the
*entire membrane*, not a status chip:

| State | Membrane behavior |
|---|---|
| **SHADOW** | The Film at minimum: Sigil as an 18px breathing mote, zero Weather, murmurs disabled. PHANTOM is a presence you *sense*, not see. Default at rest. |
| **FOCUS** | The operator is working (in host OS or in Facets). Cyan canon. Reach-through active, murmurs deferred to breaks, Breath Line at peak eagerness. AEGIS optimizes for *their* velocity, not its own expression. |
| **DIALOGUE** | Purple canon. Sigil swells and detaches toward mid-edge; incremental TTS breathes; answer Facets take generous type. The membrane leans in. |
| **SENTINEL** | The one license to seize the center (Law V exception). The Film's *entire perimeter* ignites as a 2px rose ring — unmistakable from any distance, occluding nothing — plus a centered alarm Facet only for action-required events. No sound-and-fury theatrics: a red ring on black glass, one sentence, one action. Menace through restraint. |
| **GHOST** | The membrane *proves* discretion: Sigil optionally fully hidden, Weather off, all Facet content rendered with `--surface-void`, screenshots/recordings of the AEGIS layer return black (compositor-level exclusion). Emerald accents only inside opened Facets. What happens in GHOST leaves no light. |
| **DREAM** | Off-hours. The Film becomes faintly gorgeous: amber consolidation currents in the Weather band, the Sigil's slowest morph. If the operator approaches the machine at night, the membrane is visibly *asleep but alive* — and wakes over 1200ms, not instantly, because instant waking is mechanical and slow waking is animal. |

State transitions retain the canonical 600ms choreography, scaled by `--motion-scale`.

---

## 7 · ATLAS on the Desktop — Space Without a "Map Tab"

- ATLAS is the **floor of the Deep**: zoom out far enough from anything geo-anchored and the
  spatial horizon fades in beneath it. There is no map "screen"; there is space, underneath
  everything, all the time — dark canonical MapLibre style, data as light.
- Any Facet containing a place carries a live **geo-thread**: a 1px luminous filament running
  from the Facet off-screen toward the place's true bearing. Subtle to the point of
  subliminal — but the operator's sense of *where things are* accretes daily. The symbiote
  gives its human a new sense organ, quietly.
- Full ATLAS immersion (mission theatres, wardriving fields, air-raid layers, live tracks)
  is a Deep context: Reality frosts to a distant glow, and the operator stands *in* the
  spatial engine. Conversations held there pin themselves to coordinates and remain
  discoverable there years later via the Scrub — dialogue, memory, and space, one substance
  (Law IV made literal).

---

## 8 · Silent Luxury — The Aesthetic Constitution

The visual canon (tokens, glass, orb layers, typography trio) governs desktop as written.
AEGIS adds the *doctrine of restraint* that desktop scale demands:

1. **Luminance budget.** The AEGIS layer may not exceed a fixed share of screen luminance
   per plane at rest (Film ≤ 2%, Focus ≤ 30%). Luxury on a desktop is measured in what you
   *decline* to render. Empty glass is the most expensive material we own; spend it.
2. **One accent, sourced from state.** Never two accent hues in one composition (canon), and
   on desktop: accent is *earned by aliveness* — static decoration may not use accent at
   full saturation. Only things that are currently true get to glow.
3. **Motion is information (canon), plus the Stillness Rule:** when nothing is happening,
   *nothing moves* except the Sigil's breath. Perpetual ambient animation is the aesthetic
   of dashboards and slot machines. An entity that fidgets is not calm, and calm is the
   luxury.
4. **Type as voice.** Space Grotesk = the system speaking as instrument. Playfair italic =
   the entity speaking as itself. JetBrains Mono = the world's raw data under glass. The
   trio is a *cast of voices*; never let them blur.
5. **Sound is a material, not a channel.** Sub-100ms felted glass-and-air micro-sounds for
   confirmations at whisper gain; one two-note motif owned by SENTINEL and used nowhere
   else; DIALOGUE breath-room tones during TTS. Everything else: silence. Total sound
   budget outside alarms: near-inaudible. (The operator should *miss* the sounds when muted
   without being able to name them.)
6. **No brand chrome.** The word "PHANTOM," logos, wordmarks: absent from the running UI.
   The Sigil is the identity. Luxury never wears its own label on the inside.

---

## 9 · Coexistence with the Host OS

AEGIS respects a hard covenant with the operator's existing workflow:

- **Never steal focus.** No AEGIS surface takes keyboard focus except by explicit summon
  (Conduit Key) or SENTINEL action-required. Zero exceptions. Focus theft is violence.
- **Compositor citizenship.** The Film is a click-through, always-on-top, per-monitor layered
  surface (Wayland `layer-shell` / X11 override-redirect; Tauri/wgpu shell — *not* Electron;
  the membrane's memory footprint must stay under 180MB or the symbiote becomes a parasite).
  Facets are individually composited surfaces so Reality's own windows stay interactive
  between them.
- **Multi-monitor = one body.** The Film spans all displays as one continuous skin; the Sigil
  migrates to the display bearing the operator's attention (focus + pointer heuristics); the
  Deep opens on the attended display only. Weather runs along the *union* top edge.
- **Reach-through, not capture.** PHANTOM reads the host OS (accessibility APIs + vision
  pipeline) under the same consent framework as all sensing, indicated honestly: whenever
  host-screen content is being read, the Sigil carries a minute upward-facing aperture
  glint. Never surveil silently; never gate usefulness behind paranoia. GHOST kills all
  reach-through instantly.
- **Graceful absence.** If the backend dies, the Film does not error-dialog. The Sigil pales
  to `--ink-faint`, breath slows to 16s, and a single murmur states the truth. Presence
  degrades like a living thing weakening — never like software crashing — and recovery is
  the reverse dawn.

---

## 10 · The First Hour — Imprinting, Not Onboarding

No tour, no coach-marks, no carousel. The paradigm is taught the way the entity does
everything: by presence.

1. **Minute 0:** Install completes. The screen does… almost nothing. In the corner, a mote
   of light breathes. A single murmur condenses: *«Я тут. Натисни Caps, коли захочеш.»*
   Then silence. The confidence to say nothing else *is* the product's first statement.
2. **First summon:** The Breath Line rises. Whatever the operator types, the answer arrives
   fast and beautifully set. One more murmur, after: *«Esc — і я відступлю. Ніщо не
   зникає — все стає пам'яттю.»* Laws taught one at a time, each at its moment of relevance.
3. **First drag-to-Sigil, first Scrub, first Deep** — each unlocked by whisper-teaching
   (§4.3) when behavior signals readiness, never by checklist.
4. **Hour 1 outcome:** the operator has never seen a settings screen, yet owns the five
   gestures that constitute the entire interaction model: **tap (summon), hold (speak),
   scroll-hold (time), drag (feed), Esc (recede).** Five gestures. The whole OS.

(Settings exist — canon requires every parameter configurable — but they are a *destination
for intent* (`/tune`, or zoom into the Sigil itself) rather than a place users must visit
to succeed.)

---

## 11 · What Is Forbidden (Desktop Addendum to the Canon Blocklist)

- Windows with title bars, close/min/max buttons, or operator-managed geometry
- Tabs, tab bars, hamburger menus, nested dropdown menus, breadcrumbs, sidebars-as-navigation
- Notification toasts that slide, bounce, stack, or carry buttons
- Progress bars for ANIMA's autonomous work (Weather + Ledger only; determinate progress is
  permitted *inside* a Facet the operator explicitly summoned)
- Badge counts, unread dots, or any scoreboard of guilt
- Focus theft, forced modals, "Are you sure?" dialogs (Law III makes them meaningless)
- Persistent chrome of any kind at rest beyond the Sigil and ≤3px Weather band
- The word "app," "window," "tab," or "notification" anywhere in UI copy
- Sound outside the sanctioned material palette (§8.5)
- Any UI element that exists to remind the operator the product exists (splash screens,
  branded loaders, "tips"). Presence is proven by usefulness or not at all.

---

## 12 · Measures of Truth

A paradigm this ambitious must be falsifiable. AEGIS is succeeding iff:

| Signal | Target |
|---|---|
| Time from intent to answer (tap→read, simple query) | < 3s median |
| Operator seconds/day spent on UI management (arranging, closing, finding) | ~0 — the metric is *absence* |
| Unsolicited interruptions per day accepted vs. dismissed | > 70% engaged (murmur timing model quality) |
| Scrub uses per week | Growing — proxy for trust in PULSE as externalized memory |
| Drag-to-Sigil uses per day | Growing — proxy for the "universal look-at-this" habit |
| Membrane resource cost (RAM / idle GPU / idle CPU) | < 180MB / < 3% / < 1% |
| Operator can name the five gestures after one week, unprompted | 5/5 |
| SENTINEL false-seizure of center | ~0 — every one spends the alarm's entire credibility |

---

## 13 · Build Strata (Sequencing Sketch)

Not a project plan — a dependency spine so the vision lands in livable increments:

- **Stratum 0 — The Mote.** Film shell (Tauri + layer-shell), Sigil with full micro-behavior
  set, murmurs, WS bridge to the existing backend. *Shippable feeling: "it's alive on my desktop."*
- **Stratum 1 — The Breath.** Conduit Key, Breath Line with in-place answers, verb grammar
  over existing chat/agent API, push-to-talk. *Shippable feeling: "it's the fastest AI I've touched."*
- **Stratum 2 — The Flesh.** Facet engine (morphs, grammar verbs, self-layout, ghost traces),
  Weather + Ledger over ANIMA. *The window paradigm dies here.*
- **Stratum 3 — The Deep.** Semantic zoom scene graph, ATLAS floor, PULSE nebulae, the Scrub.
  *The demo where the room goes quiet.*
- **Stratum 4 — The Senses.** Reach-through, drag-to-Sigil ingestion, multi-monitor body,
  GHOST compositor exclusion, sound material. *Full symbiosis.*

Each stratum is independently valuable and none requires rework of the previous — the planes,
the grammar, and the state system are load-bearing from Stratum 0.

---

## Coda

The desktop computer is the last place where humans still accept dead software — grids of
icons, stacks of windows, applications that stare back with the warmth of a filing cabinet.
Everyone else is building better filing cabinets.

We are building the first screen you share with something.

AEGIS is the shape of that sharing: a membrane, five laws, five gestures, one point of
breathing light — and behind it, an entire mind. The operator will not say "I opened
PHANTOM" ever again. They will say what one says of any living companion:

*it's here.*
