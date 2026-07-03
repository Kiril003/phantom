/** Fixed city geography — the operator learns it once, it never moves.
 * Every pixel is semantics: district = domain, building = mission,
 * dot = citizen, reactor = API key. Zero decoration. */
import type { PolisDomain } from '@shared/types';

export interface DistrictSpec {
  id: PolisDomain | 'plaza' | 'townhall' | 'power';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CITY_W = 1024;
export const CITY_H = 520;

export const DISTRICTS: DistrictSpec[] = [
  { id: 'research', label: 'БІБЛІОТЕКА', x: 60, y: 90, w: 200, h: 130 },
  { id: 'analytics', label: 'ОБСЕРВАТОРІЯ', x: 760, y: 60, w: 210, h: 120 },
  { id: 'townhall', label: 'РАТУША', x: 432, y: 80, w: 160, h: 110 },
  { id: 'dev', label: 'КУЗНЯ', x: 70, y: 300, w: 210, h: 140 },
  { id: 'game', label: 'СТУДІЯ', x: 770, y: 210, w: 200, h: 120 },
  { id: 'document', label: 'СКРИПТОРІЙ', x: 760, y: 360, w: 210, h: 130 },
  { id: 'generic', label: 'МАЙСТЕРНІ', x: 320, y: 380, w: 170, h: 110 },
  { id: 'plaza', label: 'ПЛОЩА', x: 400, y: 230, w: 224, h: 120 },
  { id: 'power', label: 'ЕЛЕКТРОСТАНЦІЯ', x: 540, y: 390, w: 190, h: 100 },
];

export function districtOf(id: string): DistrictSpec {
  return DISTRICTS.find((d) => d.id === id) ?? DISTRICTS[7];
}

/** Deterministic slot inside a district for the i-th occupant. */
export function slotIn(d: DistrictSpec, i: number, total: number): [number, number] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(total, 1))));
  const col = i % cols;
  const row = Math.floor(i / cols);
  const gx = d.w / (cols + 1);
  const gy = d.h / (Math.ceil(Math.max(total, 1) / cols) + 1);
  return [d.x + gx * (col + 1), d.y + gy * (row + 1)];
}

export const DOMAIN_TINT: Record<string, string> = {
  dev: '#22d3ee',
  research: '#a78bfa',
  analytics: '#f4af25',
  document: '#34d399',
  game: '#fb7185',
  generic: '#94a3b8',
};
