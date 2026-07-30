import { describe, expect, it } from 'vitest';
import { AISLE_Z, DOOR, slotAt } from './layout';
import { TURN_RATE, WALK_SPEED, heading, route, step, turn } from './path';

describe('route', () => {
  it('walks straight to a desk in the zone the body is already in', () => {
    const slot = slotAt('engineering', 3);
    const pts = route({ x: slot.seat.x + 2, z: slot.seat.z + 2 }, slot, 'engineering');
    expect(pts).toEqual([{ x: slot.seat.x, z: slot.seat.z }]);
  });

  it('doglegs onto the corridor when crossing between zones', () => {
    const slot = slotAt('research', 0);
    const pts = route(DOOR, slot, 'lobby');
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: DOOR.x, z: AISLE_Z });
    expect(pts[1]).toEqual({ x: slot.seat.x, z: AISLE_Z });
    expect(pts[2]).toEqual({ x: slot.seat.x, z: slot.seat.z });
  });

  it('drops a waypoint the body is already standing on', () => {
    const slot = slotAt('qa', 0);
    const pts = route({ x: slot.seat.x, z: AISLE_Z }, slot, 'lobby');
    expect(pts).toEqual([{ x: slot.seat.x, z: slot.seat.z }]);
  });
});

describe('heading', () => {
  it('reads +z as forward', () => {
    expect(heading(0, 1)).toBeCloseTo(0);
    expect(heading(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(heading(0, -1)).toBeCloseTo(Math.PI);
  });
});

describe('turn', () => {
  it('crosses the wrap the short way', () => {
    const next = turn(Math.PI - 0.05, -Math.PI + 0.05, 1 / 60);
    expect(next).toBeGreaterThan(Math.PI - 0.05);
  });

  it('never rotates faster than the turn rate', () => {
    const dt = 1 / 60;
    expect(Math.abs(turn(0, Math.PI, dt))).toBeCloseTo(TURN_RATE * dt);
  });

  it('settles exactly on the target once inside the budget', () => {
    expect(turn(1.0, 1.001, 1)).toBeCloseTo(1.001);
  });
});

describe('step', () => {
  it('moves toward the next waypoint at walking pace', () => {
    const s = step(0, 0, [{ x: 0, z: 10 }], 0.5);
    expect(s.advance).toBe(0);
    expect(s.z).toBeCloseTo(WALK_SPEED * 0.5);
    expect(s.moved).toBeCloseTo(WALK_SPEED * 0.5);
  });

  it('consumes waypoints it reaches inside one frame', () => {
    const pts = [
      { x: 0, z: 1 },
      { x: 1, z: 1 },
    ];
    const s = step(0, 0, pts, 10);
    expect(s.advance).toBe(2);
    expect(s.x).toBeCloseTo(1);
    expect(s.z).toBeCloseTo(1);
    expect(s.moved).toBeCloseTo(2);
  });

  it('stands still with no waypoints left', () => {
    const s = step(3, 4, [], 1);
    expect(s).toEqual({ x: 3, z: 4, advance: 0, moved: 0 });
  });

  it('reaches the desk in finite frames', () => {
    const slot = slotAt('operations', 2);
    const pts = route(DOOR, slot, 'lobby');
    let x = DOOR.x;
    let z = DOOR.z;
    let frames = 0;
    while (pts.length > 0 && frames < 2_000) {
      const s = step(x, z, pts, 1 / 60);
      x = s.x;
      z = s.z;
      pts.splice(0, s.advance);
      frames += 1;
    }
    expect(pts).toHaveLength(0);
    expect(x).toBeCloseTo(slot.seat.x);
    expect(z).toBeCloseTo(slot.seat.z);
  });
});
