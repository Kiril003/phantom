# PHANTOM Familiar

The Familiar is PHANTOM OS's signature character: an articulated glassmorphism humanoid entity (~110x138px). 
It embodies the Sunrise aesthetic using a layered translucent body, amber glowing joints (`#f4af25`), and a core crystal. 
It uses procedural animation and Inverse Kinematics (IK) to interact naturally with the UI. Friendly, organic, never spooky. 
Lives as an App-level overlay above content (z=35) and below modals (z=40). Pointer-events: none — ambient, never steals touch.

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

> Refine the PHANTOM Familiar character on a 1024×600 canvas. Sunrise
> palette: cream surfaces (#fdf6e9), amber primary #f4af25, orange #fb923c,
> warm-dark text #1a1612. The creature is a humanoid entity (~110x138px)
> with seven named pose states drawn side-by-side, each labelled. The body
> consists of glassmorphism segments (blur, translucent fills) joined by 
> glowing amber nodes. Core torso features an amber crystal. Inverse 
> Kinematics handles limb positioning. Drop-shadow tinted #f4af25 at 22% opacity.
>
> Poses to refine:
>   1. **idle** — hovering, gentle breath bob, relaxed limbs.
>   2. **floating** — similar to idle, but drifting via Bezier path, legs swept back slightly.
>   3. **pointing** — head turned toward target, torso engaged, one arm 
>      extended using 2-segment IK to trace a glowing amber beam to the target.
>   4. **peeking** — clip body to upper half, hands gripping the edge of the viewport.
>   5. **sleeping** — seated cross-legged on the floor, head bowed forward, hands in lap, three
>      `z` letters rising in serif italic, fading.
>   6. **waving** — calm gesture, one hand waving on a procedural loop, dignified posture.
>   7. **vanishing** — glass body dissolves (opacity 0) and is replaced by upward-drifting amber energy ribbons.
