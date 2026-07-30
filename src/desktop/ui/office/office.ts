/** The Office controller — the only place the pure reducer state meets three.
 *
 *  It holds one Figure per agent the reducer says is on the floor, and nothing
 *  else. If the reducer drops an agent the body goes with it; if the reducer
 *  never saw a task, no body exists to see.
 *
 *  Every walk is a consequence of an event: a character appears at the door and
 *  crosses to the desk the reducer gave it, and crosses back to the door when
 *  its terminal event lands. Nothing paces. */

import { HubEnvelope } from '../types';
import { Figure } from './figure';
import { DOOR, DeskSlot, Vec2, ZoneId, slotAt, zone } from './layout';
import { CADENCE, heading, route, step, turn } from './path';
import { Agent, OfficeState, emptyOffice, liveCount, reduce, sweep } from './reducer';
import { OfficeScene } from './scene';

/** How long a finished character stays visible before the floor forgets it. */
const LINGER_MS = 7_000;
const SWEEP_TICK_MS = 1_200;
const GAIT_DECAY = 6.0;

interface Body {
  figure: Figure;
  zone: ZoneId;
  slot: number;
  x: number;
  z: number;
  facing: number;
  /** Where the body must end up looking once it stops. */
  rest: number;
  path: Vec2[];
  phase: number;
  gait: number;
  departing: boolean;
}

export class Office {
  private readonly scene: OfficeScene;
  private readonly bodies = new Map<string, Body>();
  private state: OfficeState = emptyOffice();
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.scene = new OfficeScene(root, { tick: (dt) => this.tick(dt) });
  }

  get available(): boolean {
    return this.scene.available;
  }

  ingest(env: HubEnvelope): void {
    const next = reduce(this.state, env);
    if (next === this.state) return;
    this.state = next;
    this.sync();
  }

  setShown(shown: boolean): void {
    this.scene.setShown(shown);
  }

  dispose(): void {
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    for (const b of this.bodies.values()) b.figure.dispose();
    this.bodies.clear();
    this.scene.dispose();
  }

  private sync(): void {
    if (!this.scene.available) return;

    for (const [taskId, body] of this.bodies) {
      if (this.state.agents.has(taskId)) continue;
      this.scene.lightDesk(slotAt(body.zone, body.slot), false);
      body.figure.dispose();
      this.bodies.delete(taskId);
    }

    for (const agent of this.state.agents.values()) this.reconcile(agent);

    this.scene.setPopulated(liveCount(this.state) > 0);
    this.scene.setAnimating(this.moving());
    this.scene.markDirty();
    this.scheduleSweep();
  }

  private reconcile(agent: Agent): void {
    let body = this.bodies.get(agent.taskId);
    const slot = slotAt(agent.zone, agent.slot);

    if (!body) {
      const figure = new Figure(zone(agent.zone).accent);
      figure.addTo(this.scene.stage);
      body = {
        figure,
        zone: agent.zone,
        slot: agent.slot,
        x: DOOR.x,
        z: DOOR.z,
        facing: Math.PI,
        rest: slot.facing,
        path: [],
        phase: 0,
        gait: 0,
        departing: false,
      };
      this.bodies.set(agent.taskId, body);
      figure.place(body.x, body.z, body.facing);
      this.walkTo(body, slot, 'lobby');
    }

    const gone = agent.leftAt !== null;
    if (gone && !body.departing) {
      body.departing = true;
      this.scene.lightDesk(slotAt(body.zone, body.slot), false);
      body.path = route({ x: body.x, z: body.z }, doorSlot(), body.zone);
      body.rest = 0;
    } else if (!gone && (body.zone !== agent.zone || body.slot !== agent.slot)) {
      this.scene.lightDesk(slotAt(body.zone, body.slot), false);
      this.walkTo(body, slot, body.zone);
      body.zone = agent.zone;
      body.slot = agent.slot;
      body.figure.setAccent(zone(agent.zone).accent);
    }

    body.figure.setOpacity(gone ? 0.45 : 1);
    body.figure.setGlow(gone ? 0.05 : 0.16);
    if (!gone && body.path.length === 0) this.scene.lightDesk(slot, true);
  }

  private walkTo(body: Body, slot: DeskSlot, fromZone: ZoneId | null): void {
    body.path = route({ x: body.x, z: body.z }, slot, fromZone);
    body.rest = slot.facing;
  }

  private moving(): boolean {
    for (const b of this.bodies.values()) {
      if (b.path.length > 0 || b.gait > 0.01) return true;
      if (Math.abs(shortest(b.rest - b.facing)) > 0.01) return true;
    }
    return false;
  }

  private tick(dt: number): void {
    for (const [taskId, body] of this.bodies) {
      if (body.path.length > 0) {
        const s = step(body.x, body.z, body.path, dt);
        const dx = s.x - body.x;
        const dz = s.z - body.z;
        body.x = s.x;
        body.z = s.z;
        if (s.advance > 0) body.path.splice(0, s.advance);
        if (s.moved > 1e-4) {
          body.facing = turn(body.facing, heading(dx, dz), dt);
          body.phase += s.moved * CADENCE;
          body.gait = Math.min(1, body.gait + dt * GAIT_DECAY);
        }
        if (body.path.length === 0) {
          const agent = this.state.agents.get(taskId);
          if (agent && agent.leftAt === null) this.scene.lightDesk(slotAt(agent.zone, agent.slot), true);
        }
      } else {
        body.gait = Math.max(0, body.gait - dt * GAIT_DECAY);
        body.facing = turn(body.facing, body.rest, dt);
        if (body.gait < 0.02) body.phase = 0;
      }

      body.figure.place(body.x, body.z, body.facing);
      body.figure.stride(body.phase, body.gait);
    }

    if (!this.moving()) this.scene.setAnimating(false);
  }

  private scheduleSweep(): void {
    if (this.sweepTimer) return;
    let pending = false;
    for (const a of this.state.agents.values()) {
      if (a.leftAt !== null) {
        pending = true;
        break;
      }
    }
    if (!pending) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      const next = sweep(this.state, Date.now(), LINGER_MS);
      if (next !== this.state) {
        this.state = next;
        this.sync();
      } else {
        this.scheduleSweep();
      }
    }, SWEEP_TICK_MS);
  }
}

function shortest(delta: number): number {
  const tau = Math.PI * 2;
  return (((delta + Math.PI) % tau) + tau) % tau - Math.PI;
}

function doorSlot(): DeskSlot {
  return { zone: 'lobby', index: -1, desk: DOOR, seat: DOOR, facing: 0 };
}
