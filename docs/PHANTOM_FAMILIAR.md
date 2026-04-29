# PHANTOM Familiar

The Familiar is PHANTOM OS's signature character: a small (~50px) wisp/spirit
creature in the spirit of a candle-flame ghost. Drop-shape body in translucent
gradient (white core → amber halo), two dot eyes, a 3-particle tail, and a soft
amber drop-shadow. Friendly, never spooky. Lives as an App-level overlay above
content (z=35) and below modals (z=40). Pointer-events: none — ambient, never
steals touch.

## Pose taxonomy

| Pose         | Visual                                                       | Default duration |
| ------------ | ------------------------------------------------------------ | ---------------: |
| `idle`       | Hovers in place, gentle bob.                                 | 4500 ms          |
| `floating`   | Drifts along a Bezier path from edge to target.              | 6500 ms          |
| `pointing`   | Extends a tendril toward a DOM element / coordinate.         | 4000 ms          |
| `peeking`    | Half-emerged from the bottom edge, only one eye visible.     | 3500 ms          |
| `sleeping`   | Eyes closed, slow breath, tiny `zZz` rising.                 | 8000 ms          |
| `waving`     | Side-to-side body sway with a raised tendril (hello/bye).    | 3000 ms          |
| `vanishing`  | Fades to mist particles spreading outward.                   | 1200 ms          |

## Trigger taxonomy

| Trigger              | When                                                | Default pose         |
| -------------------- | --------------------------------------------------- | -------------------- |
| `state-transition`   | Any `uiStore.systemState` change (gated by rarity). | `floating`           |
| `first-feature-hint` | First time a feature is opened (one-shot per key). | `pointing` at anchor |
| `idle-timeout`       | 5 minutes of no user input.                         | `sleeping`           |
| `ai-summon`          | AI-emitted `phantom_manifest` chat scene OR WS push. | `waving`             |
| `easter-egg`         | Settings → "Test summon" button.                    | `waving`             |
| `greeting`           | Login transition `authenticated: false → true`.    | `waving`             |

`ai-summon` and `easter-egg` bypass the rarity gate AND the cooldown so the
operator never feels the feature is broken when summoning explicitly.

## Settings

`Settings › Profile / Personality → PHANTOM Familiar`

- **Rarity selector** — `off | rare | normal | often`
  - `off` — never appears (test summon still works).
  - `rare` — 1-in-8 attempts pass.
  - `normal` — 1-in-3 attempts pass.
  - `often` — 2-in-3 attempts pass.
- **Test summon** — fires `manifest('easter-egg', { force: true })`.
- **Reduce-motion** — automatically honoured: when
  `prefers-reduced-motion: reduce` is set the wisp fades in/out at the anchor
  point with no Bezier path, no rotation, no bob.

The rarity choice is persisted in `localStorage['phantom-familiar-rarity']`;
seen feature hints are persisted in `localStorage['phantom-familiar-hints-seen']`.

## Backend

`POST /api/v1/familiar/manifest` (ROOT/OPERATOR-only) accepts
`{pose, message?, duration_ms?, target?}` and broadcasts a
`familiar.manifestation` WS event. The frontend `wsHandlers` listener turns
that into a `familiarStore.manifest('ai-summon', …)` call.

The AI scene registry (`backend/ai/scenes.py`) exposes the
`PhantomManifestSceneData` Pydantic model so the AI runtime can include a
`{kind: 'phantom_manifest', data: {...}}` arm in any chat reply. The
chat-router's `PhantomManifestScene` component renders a small caption card
in the transcript and triggers the overlay creature on mount.

## Design batch-3 prompt (paste into claude.ai/design)

> Refine the PHANTOM Familiar wisp character on a 1024×600 canvas. Sunrise
> palette: cream surfaces (#fdf6e9), amber primary #f4af25, orange #fb923c,
> warm-dark text #1a1612. The creature is a single small entity (~50px)
> with seven named pose states drawn side-by-side, each labelled. Body is
> a teardrop shape in translucent radial gradient (white core fading to
> amber halo); two black dot eyes; three trailing tail-particles in
> amber. Soft drop-shadow tinted #f4af25 at 40% opacity.
>
> Poses to refine:
>   1. **idle** — hovering, gentle bob, both eyes open.
>   2. **floating** — same body, motion-blur trail behind, suggesting drift.
>   3. **pointing** — body unchanged, tendril extending right with a glowing
>      tip; design hint: tendril should look molten, not mechanical.
>   4. **peeking** — clip body to upper half, one eye visible, suggest
>      climbing-out-of-frame.
>   5. **sleeping** — closed-eye lids (short horizontal strokes), three
>      `z` letters rising in Manrope bold, fading.
>   6. **waving** — body tilted -8°, raised tendril at upper-right with
>      glow tip.
>   7. **vanishing** — body at 40% opacity dissolving outward into 6
>      mist-particles in a radial spread.
>
> For each pose include a 1-line animation hint underneath (e.g. "idle:
> bob ±1.5px every 2.6s"). Output as a single SVG that can be split into
> seven `<g>` groups by pose, with stable `id="pose-idle"` etc.
> Keep the creature playful and friendly — candle-flame ghost, not horror.
