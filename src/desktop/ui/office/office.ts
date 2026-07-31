/** The Office controller — the only place the pure reducer state meets three.
 *
 *  It holds one Figure per agent the reducer says is on the floor, and nothing
 *  else. If the reducer drops an agent the body goes with it; if the reducer
 *  never saw a task, no body exists to see.
 *
 *  Every walk is a consequence of an event: a character appears at the door and
 *  crosses to the desk the reducer gave it, and crosses back to the door when
 *  its terminal event lands. Nothing paces. */

import { Object3D } from 'three';

import { HubEnvelope } from '../types';
import { AgentCard } from './card';
import { Figure } from './figure';
import { DOOR, DeskSlot, Vec2, ZoneId, centre, slotAt, zone } from './layout';
import { CADENCE, beside, heading, route, step, turn } from './path';
import { LOOKS } from './look';
import { Agent, Handover, OfficeState, Posture, emptyOffice, liveCount, reduce, sweep } from './reducer';
import { CameraVerb, OfficeScene } from './scene';

/** How long a finished character stays visible before the floor forgets it. */
const LINGER_MS = 7_000;
const SWEEP_TICK_MS = 1_200;
const GAIT_DECAY = 6.0;
/** Seconds a character stands at the desk it delivered to. */
const HANDOVER_HOLD_S = 2.4;

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
  /** Task id of the character being delivered to, while away from its desk. */
  errand: string | null;
  /** Seconds left standing still. */
  hold: number;
  posture: Posture;
  /** Seconds accumulated into the mark's breath. */
  pulse: number;
}

export class Office {
  private readonly scene: OfficeScene;
  private readonly bodies = new Map<string, Body>();
  private readonly delivered = new Set<string>();
  private readonly card: AgentCard;
  private state: OfficeState = emptyOffice();
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private selected: string | null = null;

  constructor(root: HTMLElement) {
    this.scene = new OfficeScene(root, {
      tick: (dt) => this.tick(dt),
      onPick: (object) => this.select(taskIdOf(object)),
    });
    this.card = new AgentCard(root);
  }

  get available(): boolean {
    return this.scene.available;
  }

  moveCamera(verb: CameraVerb): void {
    this.scene.moveCamera(verb);
  }

  /** Step the inspection along the floor; past the last character it clears,
   *  so the operator can always get the office back to just the office. */
  cycleSelection(dir: 1 | -1): void {
    const ids = [...this.state.agents.keys()];
    if (ids.length === 0) {
      this.select(null);
      return;
    }
    const at = this.selected === null ? -1 : ids.indexOf(this.selected);
    const next = at + dir;
    this.select(next < 0 || next >= ids.length ? null : ids[next]);
  }

  select(taskId: string | null): void {
    this.selected = taskId !== null && this.state.agents.has(taskId) ? taskId : null;
    this.scene.setInspect(this.selected !== null);
    if (this.selected === null) {
      this.card.hide();
      this.scene.clearSelection();
      return;
    }
    const agent = this.state.agents.get(this.selected)!;
    this.card.show(agent);
    const body = this.bodies.get(this.selected);
    if (body) this.scene.markSelection(body.x, body.z);
    this.scene.markDirty();
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
    this.card.dispose();
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
    this.deliver();

    if (this.selected !== null) {
      const agent = this.state.agents.get(this.selected);
      if (agent) this.card.show(agent);
      else this.select(null);
    }

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
        errand: null,
        hold: 0,
        posture: agent.posture,
        pulse: 0,
      };
      figure.root.userData.taskId = agent.taskId;
      this.bodies.set(agent.taskId, body);
      figure.place(body.x, body.z, body.facing);
      this.walkTo(body, slot, 'lobby');
    }

    const gone = agent.leftAt !== null;
    if (gone && !body.departing) {
      body.departing = true;
      body.errand = null;
      body.hold = 0;
      this.scene.lightDesk(slotAt(body.zone, body.slot), false);
      body.path = route({ x: body.x, z: body.z }, doorSlot(), body.zone);
      body.rest = 0;
    } else if (!gone && !body.errand && (body.zone !== agent.zone || body.slot !== agent.slot)) {
      this.scene.lightDesk(slotAt(body.zone, body.slot), false);
      this.walkTo(body, slot, body.zone);
      body.zone = agent.zone;
      body.slot = agent.slot;
      body.figure.setAccent(zone(agent.zone).accent);
    }

    body.figure.setOpacity(gone ? 0.45 : 1);
    this.wear(body, agent);
    if (!gone && !body.errand && body.path.length === 0) this.scene.lightDesk(slot, true);
  }

  /** Put the kernel's own word for what this task is doing onto the body. */
  private wear(body: Body, agent: Agent): void {
    const look = LOOKS[agent.posture];
    if (body.posture !== agent.posture) {
      body.posture = agent.posture;
      body.pulse = 0;
    }
    body.figure.setAccent(look.tint ?? zone(agent.zone).accent);
    body.figure.setGlow(look.glow);
    body.figure.setHeadPitch(look.headPitch);
    body.figure.setMark(look.mark);
    if (look.mark !== null && look.pulse === 0) body.figure.setMarkPhase(0.55);
    if (!body.errand && !body.departing) {
      const home = slotAt(agent.zone, agent.slot);
      body.rest = look.faceOperator ? 0 : home.facing;
    }
  }

  private walkTo(body: Body, slot: DeskSlot, fromZone: ZoneId | null): void {
    body.path = route({ x: body.x, z: body.z }, slot, fromZone);
    body.rest = slot.facing;
  }

  /** One walk per `team.message` the kernel broadcast, and only when both ends
   *  of it are characters standing on this floor. */
  private deliver(): void {
    for (const h of this.state.handovers) {
      if (this.delivered.has(h.id)) continue;
      this.delivered.add(h.id);
      this.startErrand(h);
    }
    if (this.delivered.size <= 64) return;
    const live = new Set(this.state.handovers.map((h) => h.id));
    for (const id of this.delivered) if (!live.has(id)) this.delivered.delete(id);
  }

  private startErrand(h: Handover): void {
    if (!h.fromTaskId || !h.toTaskId || h.fromTaskId === h.toTaskId) return;
    const from = this.bodies.get(h.fromTaskId);
    const to = this.bodies.get(h.toTaskId);
    const toAgent = this.state.agents.get(h.toTaskId);
    if (!from || !to || !toAgent) return;
    if (from.departing || to.departing || from.errand) return;

    const desk = slotAt(toAgent.zone, toAgent.slot);
    const side: 1 | -1 = desk.seat.x > centre(zone(toAgent.zone)).x ? -1 : 1;
    const stand = beside(desk, side);

    this.scene.lightDesk(slotAt(from.zone, from.slot), false);
    from.errand = h.toTaskId;
    from.hold = HANDOVER_HOLD_S;
    from.path = route({ x: from.x, z: from.z }, stand, from.zone);
    from.rest = stand.facing;
    to.rest = heading(stand.seat.x - to.x, stand.seat.z - to.z);
  }

  private endErrand(taskId: string, body: Body): void {
    const receiverId = body.errand;
    const receiver = receiverId ? this.bodies.get(receiverId) : null;
    const receiverAgent = receiverId ? this.state.agents.get(receiverId) : null;
    if (receiver && receiverAgent) {
      receiver.rest = slotAt(receiverAgent.zone, receiverAgent.slot).facing;
    }
    body.errand = null;
    body.hold = 0;

    const agent = this.state.agents.get(taskId);
    if (!agent || agent.leftAt !== null) return;
    const home = slotAt(agent.zone, agent.slot);
    body.path = route({ x: body.x, z: body.z }, home, receiverAgent?.zone ?? null);
    body.rest = home.facing;
  }

  private moving(): boolean {
    for (const b of this.bodies.values()) {
      if (b.path.length > 0 || b.gait > 0.01 || b.hold > 0) return true;
      if (LOOKS[b.posture].pulse > 0) return true;
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
        if (body.path.length === 0 && !body.errand) {
          const agent = this.state.agents.get(taskId);
          if (agent && agent.leftAt === null) this.scene.lightDesk(slotAt(agent.zone, agent.slot), true);
        }
      } else {
        if (body.errand && body.hold > 0) {
          body.hold -= dt;
          if (body.hold <= 0) this.endErrand(taskId, body);
        }
        body.gait = Math.max(0, body.gait - dt * GAIT_DECAY);
        body.facing = turn(body.facing, body.rest, dt);
        if (body.gait < 0.02) body.phase = 0;
      }

      const look = LOOKS[body.posture];
      if (look.pulse > 0) {
        body.pulse += dt * look.pulse;
        body.figure.setMarkPhase((Math.sin(body.pulse * Math.PI * 2) + 1) / 2);
      }
      body.figure.setUpright(body.gait > 0.3);
      body.figure.place(body.x, body.z, body.facing);
      body.figure.stride(body.phase, body.gait);
      if (taskId === this.selected) this.scene.markSelection(body.x, body.z);
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

function taskIdOf(object: Object3D | null): string | null {
  let node: Object3D | null = object;
  while (node) {
    const id = node.userData.taskId;
    if (typeof id === 'string') return id;
    node = node.parent;
  }
  return null;
}

function doorSlot(): DeskSlot {
  return { zone: 'lobby', index: -1, desk: DOOR, seat: DOOR, facing: 0 };
}
