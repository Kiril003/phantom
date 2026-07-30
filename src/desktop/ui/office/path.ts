/** How a body gets from where it is to where the kernel put it. Pure geometry:
 *  one corridor between the lobby and the departments, and a dogleg onto it. */

import { AISLE_Z, DeskSlot, Vec2, ZoneId } from './layout';

const EPS = 0.08;

export const WALK_SPEED = 2.6;
export const TURN_RATE = 7.0;
/** Radians of limb swing per metre walked. */
export const CADENCE = 3.1;

function same(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.z - b.z) < EPS;
}

/**
 * Waypoints from `from` to a desk. Within one zone the walk is direct;
 * anywhere else it goes out to the corridor, along it, and back in — which is
 * both how an office reads and how two characters end up passing each other.
 */
export function route(from: Vec2, to: DeskSlot, fromZone: ZoneId | null): Vec2[] {
  const pts: Vec2[] = [];
  if (fromZone !== to.zone) {
    pts.push({ x: from.x, z: AISLE_Z });
    pts.push({ x: to.seat.x, z: AISLE_Z });
  }
  pts.push({ x: to.seat.x, z: to.seat.z });

  const out: Vec2[] = [];
  let prev = from;
  for (const p of pts) {
    if (same(prev, p)) continue;
    out.push(p);
    prev = p;
  }
  return out;
}

/** Yaw that points a body's local +z along (dx, dz). */
export function heading(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Rotate at most TURN_RATE·dt toward `target`, the short way round. */
export function turn(current: number, target: number, dt: number): number {
  const tau = Math.PI * 2;
  let delta = (((target - current + Math.PI) % tau) + tau) % tau - Math.PI;
  const max = TURN_RATE * dt;
  if (delta > max) delta = max;
  else if (delta < -max) delta = -max;
  return current + delta;
}

export interface Step {
  x: number;
  z: number;
  /** Waypoints consumed by this step. */
  advance: number;
  /** Distance actually travelled, for the walk cycle's phase. */
  moved: number;
}

/** Advance a body along its remaining waypoints by one frame's worth. */
export function step(x: number, z: number, points: readonly Vec2[], dt: number): Step {
  let budget = WALK_SPEED * dt;
  let advance = 0;
  let moved = 0;
  let cx = x;
  let cz = z;

  while (advance < points.length && budget > 0) {
    const target = points[advance];
    const dx = target.x - cx;
    const dz = target.z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist <= budget) {
      cx = target.x;
      cz = target.z;
      budget -= dist;
      moved += dist;
      advance += 1;
      continue;
    }
    const k = budget / dist;
    cx += dx * k;
    cz += dz * k;
    moved += budget;
    budget = 0;
  }

  return { x: cx, z: cz, advance, moved };
}
