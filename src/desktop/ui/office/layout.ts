/** The floor plan, as data. Zone rectangles and desk slots live here and
 *  nowhere else, so the office can be re-shaped without touching the renderer
 *  or the character code. Pure — no three, no DOM. */

export type ZoneId =
  | 'lobby'
  | 'engineering'
  | 'product'
  | 'qa'
  | 'research'
  | 'operations';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Zone {
  id: ZoneId;
  label: string;
  accent: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface DeskSlot {
  zone: ZoneId;
  index: number;
  desk: Vec2;
  seat: Vec2;
  /** Yaw for the seated body, radians; 0 looks down +z, toward the operator. */
  facing: number;
}

export const FLOOR = { x0: -15.5, z0: -10.5, x1: 15.5, z1: 10.5 };

/** The corridor every walk crosses: departments behind it, lobby in front. */
export const AISLE_Z = 0.8;

/** Where a character enters the floor from. */
export const DOOR: Vec2 = { x: 0, z: FLOOR.z1 - 0.6 };

const DEPT_COLS = 2;
const DEPT_ROWS = 3;
const LOBBY_SLOTS = 4;
const SEAT_GAP = 0.85;

export const ZONES: readonly Zone[] = [
  { id: 'engineering', label: 'ІНЖЕНЕРІЯ', accent: 0xf4af25, x0: -14.7, z0: -9.8, x1: -9.3, z1: -0.6 },
  { id: 'product', label: 'ПРОДУКТ', accent: 0xfb923c, x0: -8.7, z0: -9.8, x1: -3.3, z1: -0.6 },
  { id: 'qa', label: 'ЯКІСТЬ', accent: 0xa3b18a, x0: -2.7, z0: -9.8, x1: 2.7, z1: -0.6 },
  { id: 'research', label: 'ДОСЛІДЖЕННЯ', accent: 0x90a8c3, x0: 3.3, z0: -9.8, x1: 8.7, z1: -0.6 },
  { id: 'operations', label: 'ОПЕРАЦІЇ', accent: 0xc9ada7, x0: 9.3, z0: -9.8, x1: 14.7, z1: -0.6 },
  { id: 'lobby', label: 'ХОЛ', accent: 0xfde9b8, x0: -7.2, z0: 2.6, x1: 7.2, z1: 8.4 },
];

export function zone(id: ZoneId): Zone {
  const z = ZONES.find((v) => v.id === id);
  if (!z) throw new Error(`unknown zone ${id}`);
  return z;
}

export function centre(z: Zone): Vec2 {
  return { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 };
}

function deptSlots(z: Zone): DeskSlot[] {
  const slots: DeskSlot[] = [];
  const w = z.x1 - z.x0;
  const d = z.z1 - z.z0;
  for (let r = 0; r < DEPT_ROWS; r += 1) {
    for (let c = 0; c < DEPT_COLS; c += 1) {
      const x = z.x0 + (w * (c + 0.5)) / DEPT_COLS;
      const dz = z.z0 + (d * (r + 0.5)) / DEPT_ROWS;
      slots.push({
        zone: z.id,
        index: slots.length,
        desk: { x, z: dz },
        seat: { x, z: dz + SEAT_GAP },
        facing: Math.PI,
      });
    }
  }
  return slots;
}

function lobbySlots(z: Zone): DeskSlot[] {
  const slots: DeskSlot[] = [];
  const w = z.x1 - z.x0;
  const dz = (z.z0 + z.z1) / 2;
  for (let c = 0; c < LOBBY_SLOTS; c += 1) {
    const x = z.x0 + (w * (c + 0.5)) / LOBBY_SLOTS;
    slots.push({
      zone: z.id,
      index: c,
      desk: { x, z: dz - SEAT_GAP },
      seat: { x, z: dz },
      facing: 0,
    });
  }
  return slots;
}

const SLOTS: Record<ZoneId, DeskSlot[]> = ZONES.reduce(
  (acc, z) => {
    acc[z.id] = z.id === 'lobby' ? lobbySlots(z) : deptSlots(z);
    return acc;
  },
  {} as Record<ZoneId, DeskSlot[]>,
);

export function slotsOf(id: ZoneId): readonly DeskSlot[] {
  return SLOTS[id];
}

export function allSlots(): readonly DeskSlot[] {
  return ZONES.flatMap((z) => SLOTS[z.id]);
}

/**
 * The slot a character with this occupancy index gets. Past the last desk the
 * zone takes standees along its front edge rather than dropping the character —
 * an agent the kernel really started must never be invisible.
 */
export function slotAt(id: ZoneId, index: number): DeskSlot {
  const desks = SLOTS[id];
  if (index < desks.length) return desks[index];
  const z = zone(id);
  const overflow = index - desks.length;
  const step = 1.1;
  const x = Math.max(
    z.x0 + 0.5,
    Math.min(z.x1 - 0.5, z.x0 + 0.5 + (overflow % 5) * step),
  );
  return {
    zone: id,
    index,
    desk: { x, z: z.z1 - 1.4 },
    seat: { x, z: z.z1 - 0.5 },
    facing: id === 'lobby' ? 0 : Math.PI,
  };
}
