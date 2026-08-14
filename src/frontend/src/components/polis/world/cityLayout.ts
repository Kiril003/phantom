/** Та сама географія, що й на 2D-мапі — оператор вчить її один раз.
 * Тут лише переклад пікселів у метри та форма кварталів. */
import { DISTRICTS, CITY_W, CITY_H, type DistrictSpec } from '../cityMap';
import type { PolisMission, PolisCitizen, PolisDomain } from '@shared/types';

/** 1024×520 px → приблизно 92×47 м, центр у нулі. */
export const SCALE = 0.062;

export const toWorldX = (px: number) => (px - CITY_W / 2) * SCALE;
export const toWorldZ = (py: number) => (py - CITY_H / 2) * SCALE;

export interface Quarter {
  id: string;
  label: string;
  /** центр кварталу */
  x: number;
  z: number;
  w: number;
  d: number;
  kind: 'domain' | 'townhall' | 'power' | 'plaza';
  /** висота платформи — площа й ратуша нижчі, робочі квартали вищі */
  lift: number;
}

export const QUARTERS: Quarter[] = DISTRICTS.map((d: DistrictSpec) => {
  const kind: Quarter['kind'] =
    d.id === 'townhall' ? 'townhall' :
    d.id === 'power' ? 'power' :
    d.id === 'plaza' ? 'plaza' : 'domain';
  return {
    id: d.id,
    label: d.label,
    x: toWorldX(d.x + d.w / 2),
    z: toWorldZ(d.y + d.h / 2),
    w: d.w * SCALE,
    d: d.h * SCALE,
    kind,
    lift: kind === 'plaza' ? 0.35 : kind === 'townhall' ? 1.5 : 1.1,
  };
});

export const quarterOf = (id: string): Quarter =>
  QUARTERS.find((q) => q.id === id) ?? QUARTERS[QUARTERS.length - 2];

/** Будинок = місія. Росте з поступом, світиться коли в роботі. */
export interface Tower {
  id: string;
  title: string;
  domain: PolisDomain;
  status: PolisMission['status'];
  progress: number;
  x: number;
  z: number;
  w: number;
  h: number;
  /** верх платформи кварталу — будинок стоїть на ній, не в ній */
  base: number;
  /** 0 — простий, 1 — з уступом, 2 — зі щоглою; стабільно з id */
  style: 0 | 1 | 2;
  floors: number;
  awaiting: boolean;
}

const MIN_H = 1.3;
const MAX_H = 6.4;

/** Рівномірна сітка всередині кварталу, з полями. */
function slot(q: Quarter, i: number, total: number): [number, number] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / cols));
  const col = i % cols;
  const row = Math.floor(i / cols);
  const padX = q.w * 0.22;
  const padZ = q.d * 0.24;
  const cw = (q.w - padX * 2) / cols;
  const cd = (q.d - padZ * 2) / rows;
  return [
    q.x - q.w / 2 + padX + cw * (col + 0.5),
    q.z - q.d / 2 + padZ + cd * (row + 0.5),
  ];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function towersFor(
  q: Quarter,
  missions: PolisMission[],
  gates: { mission_id: string }[],
): Tower[] {
  const mine = missions.filter((m) => m.domain === q.id);
  return mine.map((m, i) => {
    const [x, z] = slot(q, i, mine.length);
    const grow = Math.max(0.08, m.progress);
    const cell = Math.min(q.w, q.d) / Math.max(1, Math.ceil(Math.sqrt(mine.length)));
    return {
      id: m.id,
      title: m.title,
      domain: m.domain,
      status: m.status,
      progress: m.progress,
      x, z,
      w: Math.max(0.85, Math.min(2.1, cell * 0.62)),
      h: MIN_H + (MAX_H - MIN_H) * grow,
      base: q.lift - 0.1,
      style: (hash(m.id) % 3) as 0 | 1 | 2,
      floors: Math.max(2, Math.round(2 + grow * 6)),
      awaiting: gates.some((g) => g.mission_id === m.id),
    };
  });
}

/** Куди йде громадянин: до свого кварталу, у детерміновану точку. */
export function citizenTarget(c: PolisCitizen, index: number, total: number): [number, number] {
  const q = quarterOf(c.district);
  const ring = Math.max(1, total);
  const a = (index / ring) * Math.PI * 2;
  const rx = q.w * 0.32;
  const rz = q.d * 0.32;
  return [q.x + Math.cos(a) * rx, q.z + Math.sin(a) * rz];
}

export const PLAZA = quarterOf('plaza');
