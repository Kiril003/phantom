/** The Deep — render + camera driver (Stratum 3 scaffold).
 *
 *  This is deliberately NOT the isometric ATLAS render. It is the descent made
 *  observable: the camera state machine driven by rAF, the Surface falling away,
 *  a floor rising to meet the operator, and the aim handed back intact on
 *  surfacing. The heavy render lands on this foundation later — if the dive
 *  cannot survive without it, the render would only bury the bug.
 *
 *  It creates no window and takes no focus: the Deep is DOM inside the same
 *  click-through Film, so the host OS keeps its keyboard throughout. */

import { ascend, DeepState, depthOf, descend, initial, inTransit, tick } from './descent';

export interface DeepHooks {
  /** The Facet currently holding the aim — it becomes the dive's anchor. */
  aim: () => string | null;
  /** Hand the aim back when we surface; focus survives the dive. */
  restore: (id: string | null) => void;
  /** The Surface recedes as the camera descends past it, and returns on the
   *  way up. Law III: it is never closed, and never merely hidden. */
  recede: () => void;
  resurface: () => void;
  /** Report the band so the Breath Line can name where the operator is. */
  report?: (depth: string) => void;
}

export class Deep {
  private state: DeepState = initial();
  private readonly floor: HTMLDivElement;
  private readonly root: HTMLElement;
  /** Full-viewport wash, animated only while the camera moves — it is what makes
   *  the dive visible at all on this stack. See deep.css. */
  private readonly veil: HTMLDivElement;
  private raf = 0;
  private last = 0;

  constructor(root: HTMLElement, private readonly hooks: DeepHooks) {
    this.root = root;
    this.veil = document.createElement('div');
    this.veil.className = 'film-veil';
    root.appendChild(this.veil);
    this.floor = document.createElement('div');
    this.floor.className = 'atlas-floor';
    // The scaffold's floor: a horizon and a grid, nothing more. The isometric
    // world is built on top of this, not instead of it.
    this.floor.innerHTML =
      '<div class="atlas-horizon"></div><div class="atlas-grid"></div>' +
      '<div class="atlas-label">ATLAS</div><div class="atlas-anchor"></div>';
    root.appendChild(this.floor);
    this.paint();
  }

  descend(): void {
    const anchor = this.hooks.aim();
    const next = descend(this.state, anchor);
    if (next === this.state) return; // already diving or below — never double-fire
    this.state = next;
    this.run();
  }

  ascend(): void {
    const next = ascend(this.state);
    if (next === this.state) return;
    this.state = next;
    this.run();
  }

  private run(): void {
    if (this.raf) return;
    this.last = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(64, now - this.last); // a stalled tab must not teleport
      this.last = now;
      const before = this.state.phase;
      this.state = tick(this.state, dt);
      this.paint();

      if (before !== 'surface' && this.state.phase === 'surface') {
        // Surfaced: give the aim back exactly as it was left.
        this.hooks.restore(this.state.restoreTarget);
      }

      if (inTransit(this.state)) {
        this.raf = requestAnimationFrame(step);
      } else {
        this.raf = 0;
        this.paint();
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Write to the DOM only when something actually changed.
   *
   *  Two hard lessons from this board, both learned the same way — as smeared
   *  ghost copies of the Surface:
   *
   *  1. Per-frame JS-driven transforms do not invalidate here. Compositing is
   *     off (it must be — see main.rs), so layer promotion is broken and each
   *     frame paints over the last instead of replacing it. CSS *transitions*
   *     webkit animates itself are invalidated correctly, so the camera below
   *     publishes a phase and lets the stylesheet interpolate. The state machine
   *     stays the single source of truth; CSS is merely how it is drawn.
   *  2. Rewriting textContent every frame leaves stale glyphs behind. Write the
   *     anchor's name once, when it changes. */
  private paint(): void {
    const { camera, phase } = this.state;

    if (this.root.dataset.phase !== phase) {
      this.root.dataset.phase = phase;
      this.root.dataset.depth = String(depthOf(camera.z));

      // The Surface *recedes* as the camera falls past it, and condenses back on
      // the way up. It is emphatically not hidden — see `surfaceRecede()`: hiding
      // a shard here does not clear its pixels, only its own dissolve does.
      if (phase === 'descending') this.hooks.recede();
      else if (phase === 'ascending') this.hooks.resurface();

      // Damage the whole viewport for the length of the transition, or none of
      // this is drawn: the floor never fades in and the Surface stays burned on
      // the glass. This is the load-bearing line of the dive. See deep.css.
      this.veil.classList.remove('pulse');
      void this.veil.offsetWidth;
      this.veil.classList.add('pulse');

      this.hooks.report?.(phase === 'atlas' ? 'atlas' : phase === 'surface' ? '' : 'diving');
    }

    const label = camera.anchor ? `▸ ${camera.anchor}` : '';
    const anchor = this.floor.querySelector('.atlas-anchor');
    if (anchor && anchor.textContent !== label) anchor.textContent = label;
  }
}
