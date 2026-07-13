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
interface AnswerContent {
  question: string;
  text: string;
}
interface DossierContent {
  title: string;
  lines: string[];
}
export interface MonitorTask {
  id: string;
  goal: string;
  since: number;
}
interface MonitorContent {
  tasks: MonitorTask[];
}

const LEDGER_SIZE = { w: 360, h: 236 };
const WEATHER_SIZE = { w: 300, h: 100 };
const ANSWER_SIZE = { w: 380, h: 200 };
const DOSSIER_SIZE = { w: 340, h: 200 };
const MONITOR_SIZE = { w: 340, h: 180 };
const LEDGER_MAX_ROWS = 8;
const LEDGER_MORTAL_MS = 45_000;
const ANSWER_MORTAL_MS = 90_000;
const DOSSIER_MORTAL_MS = 90_000;
const GHOST_FADE_MS = 12_000;
const MORTALITY_TICK_MS = 1_000;
const ILLUMINATE_MS = 700;

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
  private monitorId: string | null = null;
  /** The shard a keyboard verb lands on. Illuminated so the operator always
   *  knows which glass is listening (objective 3). */
  private targetId: string | null = null;
  private onTarget: ((label: string | null) => void) | null = null;

  constructor(root: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'facet-layer';
    root.appendChild(this.layer);
    window.setInterval(() => this.sweep(), MORTALITY_TICK_MS);
  }

  /** Report the current target back to the Breath Line so it can name what it
   *  is about to command. */
  setTargetReporter(cb: (label: string | null) => void): void {
    this.onTarget = cb;
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
    // The newest shard takes the aim: verbs land on what just appeared.
    this.setTarget(state.id);
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

  // ── Targeting + illumination (objective 3) ───────────────────────────────

  private setTarget(id: string | null): void {
    const prev = this.targetId;
    this.targetId = id && this.facets.has(id) ? id : null;
    if (prev && prev !== this.targetId) this.render(prev);
    if (this.targetId) this.render(this.targetId);
    this.onTarget?.(this.targetLabel());
  }

  private targetLabel(): string | null {
    const f = this.targetId ? this.facets.get(this.targetId) : undefined;
    return f ? f.state.kind : null;
  }

  /** Walk the shards in materialization order. */
  cycleTarget(dir: 1 | -1): void {
    const ids = [...this.facets.keys()];
    if (ids.length === 0) {
      this.setTarget(null);
      return;
    }
    const at = this.targetId ? ids.indexOf(this.targetId) : -1;
    const next = ids[(((at + dir) % ids.length) + ids.length) % ids.length]!;
    this.setTarget(next);
    this.illuminate(next);
  }

  /** Apply a verb to the illuminated target — the whole point of the bridge.
   *  Feed's material is shaped to the shard it lands on: the grammar stays
   *  kind-agnostic, so the kind semantics live here. */
  verbOnTarget(v: Verb, arg?: unknown): void {
    if (!this.targetId) return;
    const id = this.targetId;
    const f = this.facets.get(id);
    if (!f) return;
    this.illuminate(id);
    const material = v === Verb.Feed ? shapeMaterial(f.state.kind, String(arg ?? '')) : arg;
    // Nothing sensible to give this shard — the illumination still confirms the
    // key was heard, but the Facet is left untouched.
    if (v === Verb.Feed && material === null) return;
    this.verb(id, v, material);
  }

  /** A temporal luminance shift in the glass: the shard receiving the command
   *  brightens for a beat, so a verb is never fired blindly. */
  private illuminate(id: string): void {
    const f = this.facets.get(id);
    if (!f) return;
    f.el.classList.remove('verb-hit');
    // Reflow so the animation restarts even on a repeated verb.
    void f.el.offsetWidth;
    f.el.classList.add('verb-hit');
    window.setTimeout(() => f.el.classList.remove('verb-hit'), ILLUMINATE_MS);
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
    if (this.monitorId === id) this.monitorId = null;
    // The aim never dangles on a dissolved shard.
    if (this.targetId === id) this.setTarget([...this.facets.keys()][0] ?? null);
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
      // The monitor is a live instrument — its elapsed times tick.
      else if (f.state.kind === 'monitor') this.render(id);
    }
  }

  // ── Spawned from the Breath Line (objective 1) ───────────────────────────

  spawnAnswer(question: string, text: string): void {
    this.materialize('answer', ANSWER_SIZE, { question, text } as AnswerContent, ANSWER_MORTAL_MS);
  }

  spawnDossier(title: string, lines: string[]): void {
    this.materialize('dossier', DOSSIER_SIZE, { title, lines } as DossierContent, DOSSIER_MORTAL_MS);
  }

  /** The process monitor is a Fixture-grade instrument: immortal while it lives,
   *  updated in place as tasks come and go. */
  spawnMonitor(tasks: MonitorTask[]): void {
    if (this.monitorId && this.facets.has(this.monitorId)) {
      this.setTarget(this.monitorId);
      this.updateMonitor(tasks);
      return;
    }
    this.monitorId = this.materialize('monitor', MONITOR_SIZE, { tasks } as MonitorContent, null);
  }

  updateMonitor(tasks: MonitorTask[]): void {
    if (!this.monitorId) return;
    const f = this.facets.get(this.monitorId);
    if (!f) return;
    f.state = { ...f.state, content: { tasks } as MonitorContent, touchedAt: Date.now() };
    this.render(this.monitorId);
  }

  /** `/log` pulls the recent ANIMA transcript into its own shard. */
  spawnLog(rows: LedgerRow[]): void {
    this.materialize(
      'ledger',
      LEDGER_SIZE,
      { rows: rows.slice(-LEDGER_MAX_ROWS) } as LedgerContent,
      LEDGER_MORTAL_MS,
    );
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(id: string): void {
    const f = this.facets.get(id);
    if (!f) return;
    const { state, el } = f;
    el.dataset.plane = String(state.plane);
    el.classList.toggle('pinned', state.pinned);
    el.classList.toggle('tracing', state.tracing);
    el.classList.toggle('targeted', this.targetId === state.id);
    el.innerHTML = bodyHTML(state);
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

/** What it means to feed each kind. A Ledger takes a line of transcript, a
 *  Dossier takes a fact; the Weather and the Monitor are instruments read from
 *  the world, not written to by hand, and an Answer is what it was. */
function shapeMaterial(kind: FacetKind, text: string): unknown | null {
  const t = text.trim();
  if (!t) return null;
  switch (kind) {
    case 'ledger':
      return { id: uid('row'), at: Date.now(), tone: 'system', text: t } satisfies LedgerRow;
    case 'dossier':
      return t;
    default:
      return null;
  }
}

function bodyHTML(s: FacetState): string {
  switch (s.kind) {
    case 'ledger':
      return ledgerHTML(s);
    case 'weather':
      return weatherHTML(s);
    case 'answer':
      return answerHTML(s);
    case 'dossier':
      return dossierHTML(s);
    case 'monitor':
      return monitorHTML(s);
  }
}

/** Every shard wears the same furniture: its name, its Fixture mark, and its
 *  provenance thread when Traced — learning one Facet is learning all. */
function chrome(s: FacetState, title: string): { head: string; thread: string } {
  const fixture = s.pinned ? '<span class="facet-fixture">✦</span>' : '';
  return {
    head: `<div class="facet-title">${title}${fixture}</div>`,
    thread: s.tracing ? '<div class="facet-thread"></div>' : '',
  };
}

function answerHTML(s: FacetState): string {
  const c = s.content as AnswerContent;
  const { head, thread } = chrome(s, 'Answer');
  return (
    `${head}<div class="answer-question">${escapeHtml(c.question)}</div>` +
    `<div class="answer-text">${escapeHtml(c.text)}</div>${thread}`
  );
}

function dossierHTML(s: FacetState): string {
  const c = s.content as DossierContent;
  const { head, thread } = chrome(s, 'Dossier');
  const lines = (c.lines ?? [])
    .map((l) => `<div class="dossier-line">${escapeHtml(String(l))}</div>`)
    .join('');
  return (
    `${head}<div class="dossier-name">${escapeHtml(c.title)}</div>` +
    `<div class="dossier-lines">${lines}</div>${thread}`
  );
}

function monitorHTML(s: FacetState): string {
  const c = s.content as MonitorContent;
  const { head, thread } = chrome(s, 'Monitor');
  const now = Date.now();
  const tasks = c.tasks ?? [];
  const body = tasks.length
    ? tasks
        .map(
          (t) =>
            `<div class="monitor-row"><span class="monitor-pip"></span>` +
            `<span class="monitor-goal">${escapeHtml(t.goal)}</span>` +
            `<span class="monitor-age">${Math.max(0, Math.round((now - t.since) / 1000))}s</span></div>`,
        )
        .join('')
    : '<div class="monitor-idle">нічого не виконується</div>';
  return `${head}<div class="monitor-rows">${body}</div>${thread}`;
}

function ledgerHTML(s: FacetState): string {
  const rows = ((s.content as LedgerContent).rows ?? [])
    .map(
      (r) =>
        `<div class="ledger-row tone-${r.tone}"><span class="ledger-dot"></span>` +
        `<span class="ledger-text">${escapeHtml(r.text)}</span></div>`,
    )
    .join('');
  const { head, thread } = chrome(s, 'Ledger');
  return `${head}<div class="ledger-rows">${rows}</div>${thread}`;
}

function weatherHTML(s: FacetState): string {
  const c = s.content as WeatherContent;
  const pct = Math.round(c.intensity * 100);
  const { head, thread } = chrome(s, 'Weather');
  return (
    `<div class="weather-aurora" style="--intensity:${c.intensity}"></div>` +
    `<div class="weather-body">${head}` +
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
