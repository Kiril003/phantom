/** The Office controller — the only place the pure reducer state meets three.
 *
 *  It holds one Figure per agent the reducer says is on the floor, and nothing
 *  else. If the reducer drops an agent the body goes with it; if the reducer
 *  never saw a task, no body exists to see. */

import { HubEnvelope } from '../types';
import { Figure } from './figure';
import { ZoneId, slotAt, zone } from './layout';
import { Agent, OfficeState, emptyOffice, liveCount, reduce, sweep } from './reducer';
import { OfficeScene } from './scene';

/** How long a finished character stays visible before the floor forgets it. */
const LINGER_MS = 6_000;
const SWEEP_TICK_MS = 1_200;

interface Body {
  figure: Figure;
  zone: ZoneId;
  slot: number;
}

export class Office {
  private readonly scene: OfficeScene;
  private readonly bodies = new Map<string, Body>();
  private state: OfficeState = emptyOffice();
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.scene = new OfficeScene(root);
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

    for (const agent of this.state.agents.values()) {
      this.place(agent);
    }

    this.scene.setPopulated(liveCount(this.state) > 0);
    this.scene.markDirty();
    this.scheduleSweep();
  }

  private place(agent: Agent): void {
    let body = this.bodies.get(agent.taskId);
    if (!body) {
      const figure = new Figure(zone(agent.zone).accent);
      figure.addTo(this.scene.stage);
      body = { figure, zone: agent.zone, slot: agent.slot };
      this.bodies.set(agent.taskId, body);
    }

    const slot = slotAt(agent.zone, agent.slot);
    body.figure.placeAt(slot.seat.x, slot.seat.z, slot.facing);
    body.zone = agent.zone;
    body.slot = agent.slot;

    const gone = agent.leftAt !== null;
    body.figure.setOpacity(gone ? 0.4 : 1);
    body.figure.setGlow(gone ? 0.05 : 0.16);
    this.scene.lightDesk(slot, !gone);
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
