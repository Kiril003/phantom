import { describe, expect, it } from 'vitest';
import { FLOOR, ZONES, allSlots, slotAt, slotsOf, zone } from './layout';

const inside = (v: { x: number; z: number }, z: ReturnType<typeof zone>): boolean =>
  v.x >= z.x0 && v.x <= z.x1 && v.z >= z.z0 && v.z <= z.z1;

describe('office layout', () => {
  it('names the five departments plus a lobby', () => {
    expect(ZONES.map((z) => z.id).sort()).toEqual(
      ['engineering', 'lobby', 'operations', 'product', 'qa', 'research'],
    );
  });

  it('keeps every zone inside the floor', () => {
    for (const z of ZONES) {
      expect(z.x0).toBeGreaterThanOrEqual(FLOOR.x0);
      expect(z.x1).toBeLessThanOrEqual(FLOOR.x1);
      expect(z.z0).toBeGreaterThanOrEqual(FLOOR.z0);
      expect(z.z1).toBeLessThanOrEqual(FLOOR.z1);
    }
  });

  it('never overlaps two zones', () => {
    for (let i = 0; i < ZONES.length; i += 1) {
      for (let j = i + 1; j < ZONES.length; j += 1) {
        const a = ZONES[i];
        const b = ZONES[j];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
        expect(overlap).toBe(false);
      }
    }
  });

  it('puts every desk and seat inside its own zone', () => {
    for (const slot of allSlots()) {
      const z = zone(slot.zone);
      expect(inside(slot.desk, z)).toBe(true);
      expect(inside(slot.seat, z)).toBe(true);
    }
  });

  it('gives each slot a distinct desk', () => {
    const keys = allSlots().map((s) => `${s.desk.x.toFixed(3)}/${s.desk.z.toFixed(3)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('still seats an agent past the last desk instead of dropping it', () => {
    const n = slotsOf('engineering').length;
    const over = slotAt('engineering', n + 2);
    expect(over.index).toBe(n + 2);
    expect(inside(over.seat, zone('engineering'))).toBe(true);
  });
});
