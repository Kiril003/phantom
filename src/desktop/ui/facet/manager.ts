/** FacetManager — the render + lifecycle layer of the engine. It owns the
 *  registry, materializes shards into the Film (born-not-drawn), runs mortality
 *  and ghost traces, and exposes the six verbs. It never creates or resizes a
 *  window: every Facet is DOM inside the click-through, never-focused Film, so
 *  the mutter focus-immunity from Slice 1 holds by construction. */

import { applyVerb, isExpired } from './grammar';
import { placeFacet, Viewport } from './layout';
import { FacetKind, FacetState, GhostTrace, Plane, Rect, Verb } from './types';

export interface LedgerRow {
  id: string;
  at: number;
  tone: 'task' | 'warn' | 'system';
  text: string;
}
interface LedgerContent {
  rows: LedgerRow[];
}
interface WeatherContent {
  intensity: number;
  active: number;
  phrase: string;
}

const LEDGER_SIZE = { w: 360, h: 236 };
const WEATHER_SIZE = { w: 300, h: 100 };
const LEDGER_MAX_ROWS = 8;
const LEDGER_MORTAL_MS = 45_000;
const GHOST_FADE_MS = 12_000;
const MORTALITY_TICK_MS = 1_000;

let seq = 0;
const uid = (p: string): string => `${p}-${++seq}`;

interface Live {
  state: FacetState;
  el: HTMLElement;
}

export class FacetManager {
  private readonly facets = new Map<string, Live>();
  private readonly ghosts = new Map<string, HTMLElement>();
  private readonly layer: HTMLDivElement;
  private ledgerId: string | null = null;
  private weatherId: string | null = null;

  constructor(root: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'facet-layer';
    root.appendChild(this.layer);
    window.setInterval(() => this.sweep(), MORTALITY_TICK_MS);
  }

  private viewport(): Viewport {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  /** Reserved zones the self-layout must never cover (constraint 2). The Breath
   *  Line is a separate centered window; the Sigil + murmur lane own the
   *  bottom-right corner. */
  private reserved(): Rect[] {
    const vp = this.viewport();
    const bw = Math.min(760, vp.w * 0.6);
    return [
      { x: (vp.w - bw) / 2, y: vp.h * 0.28, w: bw, h: vp.h * 0.46 },
      { x: vp.w - 360, y: vp.h - 168, w: 360, h: 168 },
    ];
  }

  private occupied(exceptId?: string): Rect[] {
    const out: Rect[] = [];
    for (const [id, f] of this.facets) if (id !== exceptId) out.push(f.state.rect);
    return out;
  }

  private place(size: { w: number; h: number }, exceptId?: string): Rect {
    return placeFacet(this.viewport(), size, this.reserved(), this.occupied(exceptId), {
      margin: 24,
    });
  }

  // ── Materialization ────────────────────────────────────────────────────

  private materialize(
    kind: FacetKind,
    size: { w: number; h: number },
    content: unknown,
    mortalMs: number | null,
  ): string {
    const now = Date.now();
    const rect = this.place(size);
    const state: FacetState = {
      id: uid(kind),
      kind,
      plane: Plane.FILM,
      pinned: false,
      tracing: false,
      mortalMs,
      bornAt: now,
      touchedAt: now,
      rect,
      content,
    };
    const el = document.createElement('div');
    el.className = `facet facet-${kind}`;
    this.position(el, rect);
    this.facets.set(state.id, { state, el });
    this.render(state.id);
    this.layer.appendChild(el);
    // Born, not drawn — condense out of the Film on the next frame.
    requestAnimationFrame(() => el.classList.add('born'));
    return state.id;
  }

  private position(el: HTMLElement, rect: Rect): void {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
  }

  // ── ANIMA-driven surface (fed by main.ts from the WS hub) ────────────────

  ledgerEvent(row: LedgerRow): void {
    if (!this.ledgerId || !this.facets.has(this.ledgerId)) {
      this.ledgerId = this.materialize(
        'ledger',
        LEDGER_SIZE,
        { rows: [] } as LedgerContent,
        LEDGER_MORTAL_MS,
      );
    }
    const f = this.facets.get(this.ledgerId)!;
    const rows = [...(f.state.content as LedgerContent).rows, row].slice(-LEDGER_MAX_ROWS);
    f.state = { ...f.state, content: { rows }, touchedAt: Date.now() };
    this.render(this.ledgerId);
  }

  /** Weather (§3.2) as light, not a task list. `active` in-flight tasks set the
   *  intensity; when it hits zero the shard recedes into a ghost trace. */
  weather(active: number, phrase: string, nearingDone = false): void {
    if (active <= 0) {
      if (this.weatherId) {
        this.verb(this.weatherId, Verb.Recede);
        this.weatherId = null;
      }
      return;
    }
    const intensity = Math.min(1, 0.25 + active * 0.22 + (nearingDone ? 0.3 : 0));
    const content: WeatherContent = { intensity, active, phrase };
    if (!this.weatherId || !this.facets.has(this.weatherId)) {
      this.weatherId = this.materialize('weather', WEATHER_SIZE, content, null);
    } else {
      const f = this.facets.get(this.weatherId)!;
      f.state = { ...f.state, content, touchedAt: Date.now() };
      this.render(this.weatherId);
    }
  }

  // ── Verb application ─────────────────────────────────────────────────────

  verb(id: string, v: Verb, arg?: unknown): void {
    const f = this.facets.get(id);
    if (!f) return;
    const res = applyVerb(f.state, v, Date.now(), arg);
    if (res.kind === 'update') {
      f.state = res.state;
      this.render(id);
    } else if (res.kind === 'dissolve') {
      this.dissolve(id, res.ghost);
    } else {
      f.state = res.state;
      this.render(id);
      const rect = this.place({ w: f.state.rect.w, h: f.state.rect.h });
      const el = document.createElement('div');
      el.className = `facet facet-${res.sibling.kind}`;
      this.position(el, rect);
      this.facets.set(res.sibling.id, { state: { ...res.sibling, rect }, el });
      this.render(res.sibling.id);
      this.layer.appendChild(el);
      requestAnimationFrame(() => el.classList.add('born'));
    }
  }

  private dissolve(id: string, ghost: GhostTrace): void {
    const f = this.facets.get(id);
    if (!f) return;
    f.el.classList.remove('born');
    f.el.classList.add('receding');
    const el = f.el;
    window.setTimeout(() => el.remove(), 340);
    this.facets.delete(id);
    if (this.ledgerId === id) this.ledgerId = null;
    if (this.weatherId === id) this.weatherId = null;
    this.renderGhost(ghost);
  }

  private renderGhost(g: GhostTrace): void {
    const el = document.createElement('div');
    el.className = 'ghost-trace';
    el.style.left = `${g.x}px`;
    el.style.top = `${g.y}px`;
    el.style.width = `${g.w}px`;
    this.layer.appendChild(el);
    this.ghosts.set(g.id, el);
    requestAnimationFrame(() => el.classList.add('settled'));
    window.setTimeout(() => {
      el.remove();
      this.ghosts.delete(g.id);
    }, GHOST_FADE_MS);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, f] of [...this.facets]) {
      if (isExpired(f.state, now)) this.verb(id, Verb.Recede);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(id: string): void {
    const f = this.facets.get(id);
    if (!f) return;
    const { state, el } = f;
    el.dataset.plane = String(state.plane);
    el.classList.toggle('pinned', state.pinned);
    el.classList.toggle('tracing', state.tracing);
    el.innerHTML = state.kind === 'ledger' ? ledgerHTML(state) : weatherHTML(state);
  }

  // ── Verification surface (inert unless invoked; used for live board test) ─

  expose(): void {
    (window as unknown as { __aegis?: unknown }).__aegis = {
      demo: (): void => this.demo(),
      verb: (id: string, v: Verb, arg?: unknown): void => this.verb(id, v, arg),
      ids: (): string[] => [...this.facets.keys()],
    };
  }

  private demo(): void {
    const goals = ['harvesting three feeds', 'consolidating memory', 'watching air quality'];
    let n = 0;
    this.weather(1, goals[0]);
    const iv = window.setInterval(() => {
      n += 1;
      // Feed: each event is material given to the Ledger.
      this.ledgerEvent({
        id: uid('row'),
        at: Date.now(),
        tone: n % 4 === 0 ? 'warn' : 'task',
        text: `${goals[n % goals.length]} · крок ${n}`,
      });
      this.weather(Math.min(3, 1 + Math.floor(n / 2)), goals[n % goals.length], n >= 6);

      const led = this.ledgerId;
      if (n === 3 && led) {
        // Trace: exhale the provenance thread. Pin: promote to a Fixture.
        // Approach: pull it one plane closer, out of the Film.
        this.verb(led, Verb.Trace);
        this.verb(led, Verb.Pin);
        this.verb(led, Verb.Approach);
      }
      if (n === 5 && led) {
        // Cleave: split a sub-element into its own sibling, which the layout
        // engine must find free space for — never over a sibling or the line.
        this.verb(led, Verb.Cleave, {
          rows: [
            { id: uid('row'), at: Date.now(), tone: 'system', text: 'відколото — власний шар' },
          ],
        });
      }
      if (n >= 7) {
        window.clearInterval(iv);
        // Labor ends: the Weather recedes from the Film into a ghost trace.
        window.setTimeout(() => this.weather(0, ''), 2_500);
      }
    }, 1_200);
  }
}

function ledgerHTML(s: FacetState): string {
  const rows = (s.content as LedgerContent).rows
    .map(
      (r) =>
        `<div class="ledger-row tone-${r.tone}"><span class="ledger-dot"></span>` +
        `<span class="ledger-text">${escapeHtml(r.text)}</span></div>`,
    )
    .join('');
  const fixture = s.pinned ? '<span class="facet-fixture">✦</span>' : '';
  const thread = s.tracing ? '<div class="facet-thread"></div>' : '';
  return `<div class="facet-title">Ledger${fixture}</div><div class="ledger-rows">${rows}</div>${thread}`;
}

function weatherHTML(s: FacetState): string {
  const c = s.content as WeatherContent;
  const pct = Math.round(c.intensity * 100);
  const thread = s.tracing ? '<div class="facet-thread"></div>' : '';
  return (
    `<div class="weather-aurora" style="--intensity:${c.intensity}"></div>` +
    `<div class="weather-body"><div class="facet-title">Weather</div>` +
    `<div class="weather-phrase">${escapeHtml(c.phrase)}</div>` +
    `<div class="weather-meter"><span style="width:${pct}%"></span></div></div>${thread}`
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}
