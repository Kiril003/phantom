/** Інтер'єр району — чиста похідна від стану. Поверх = місія, стіл = вузол,
 * мешканець = громадянин на своєму вузлі. Жодної декорації: якщо щось видно,
 * воно щось означає. */
import type {
  PolisMission,
  PolisCitizen,
  PolisNode,
  PolisNodeStatus,
  PolisGate,
  PolisDomain,
} from '@shared/types';

export const FLOOR_H = 3.4;
export const HALF_W = 11;
export const HALF_D = 7.5;
export const MAX_FLOORS = 8;
export const DESKS_PER_ROW = 4;

export type DeskState = PolisNodeStatus;

export interface DeskSpec {
  nodeId: string;
  label: string;
  state: DeskState;
  x: number;
  z: number;
  ry: number;
  /** громадянин за цим столом, якщо призначений */
  citizenId?: string;
  citizenName?: string;
  activity?: PolisCitizen['activity'];
  /** скільки файлів вузол уже видав — стос на столі */
  artifacts: number;
}

/** Залежність між вузлами — видно, звідки куди тече робота. */
export interface LinkSpec {
  from: [number, number];
  to: [number, number];
  critical: boolean;
  live: boolean;
}

export interface FloorSpec {
  index: number;
  y: number;
  missionId: string;
  title: string;
  status: PolisMission['status'];
  progress: number;
  domain: PolisDomain;
  desks: DeskSpec[];
  links: LinkSpec[];
  awaitingGate: boolean;
}

/** Ратуша: те, що піднесли особисто тобі. Питання на постаменті — рішення,
 * якого чекають; здана місія — результат, який приніс район. */
export interface PlinthSpec {
  id: string;
  kind: 'gate' | 'delivered';
  title: string;
  detail: string;
  domain: PolisDomain;
  x: number;
  z: number;
}

export interface BuildingSpec {
  districtId: string;
  label: string;
  domain: PolisDomain | 'plaza' | 'townhall' | 'power';
  floors: FloorSpec[];
  /** громадяни району без активного вузла — вони внизу, у вестибюлі */
  lobby: { id: string; name: string; role: string; activity: PolisCitizen['activity'] }[];
  gates: PolisGate[];
  /** лише для ратуші */
  plinths: PlinthSpec[];
  isHall: boolean;
  height: number;
}

export const MAX_PLINTHS = 12;

/** Постаменти двома рядами перед столом оператора. */
function plinthSlot(i: number): { x: number; z: number } {
  return { x: -6.5 + (i % 6) * 2.6, z: 1.4 + Math.floor(i / 6) * 4.0 };
}

function buildHall(
  label: string,
  missions: PolisMission[],
  gates: PolisGate[],
): BuildingSpec {
  const byId = new Map(missions.map((m) => [m.id, m]));
  const plinths: PlinthSpec[] = [];

  // спершу те, що блокує тебе
  for (const g of gates) {
    if (plinths.length >= MAX_PLINTHS) break;
    const m = byId.get(g.mission_id);
    const slot = plinthSlot(plinths.length);
    plinths.push({
      id: g.id,
      kind: 'gate',
      title: m?.title ?? g.mission_id,
      detail: g.question,
      domain: m?.domain ?? 'generic',
      x: slot.x,
      z: slot.z,
    });
  }

  // далі — здане, найсвіжіше першим
  const done = missions
    .filter((m) => m.status === 'done')
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  for (const m of done) {
    if (plinths.length >= MAX_PLINTHS) break;
    const slot = plinthSlot(plinths.length);
    plinths.push({
      id: m.id,
      kind: 'delivered',
      title: m.title,
      detail: m.brief || 'готово',
      domain: m.domain,
      x: slot.x,
      z: slot.z,
    });
  }

  return {
    districtId: 'townhall',
    label,
    domain: 'townhall',
    floors: [],
    lobby: [],
    gates,
    plinths,
    isHall: true,
    height: FLOOR_H * 2,
  };
}

const STATUS_RANK: Record<string, number> = {
  awaiting_gate: 0,
  running: 1,
  planning: 2,
  paused: 3,
  failed: 4,
  done: 5,
  killed: 6,
};

const deskState = (node: PolisNode): DeskState => node.status;

/** Розкладка столів: два ряди обабіч центрального проходу. */
function deskSlot(i: number): { x: number; z: number; ry: number } {
  const row = Math.floor(i / DESKS_PER_ROW);
  const col = i % DESKS_PER_ROW;
  const front = row % 2 === 0;
  const bank = Math.floor(row / 2);
  const x = -6.6 + col * 4.4;
  const z = (front ? 1.6 : -1.6) + bank * 4.6;
  return { x, z, ry: front ? 0 : Math.PI };
}

export function buildSpec(
  districtId: string,
  label: string,
  missions: PolisMission[],
  citizens: PolisCitizen[],
  gates: PolisGate[],
): BuildingSpec {
  if (districtId === 'townhall') return buildHall(label, missions, gates);

  const mine = missions
    .filter((m) => m.domain === districtId)
    .sort((a, b) => {
      const r = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      return r !== 0 ? r : b.progress - a.progress;
    })
    .slice(0, MAX_FLOORS);

  const locals = citizens.filter((c) => c.district === districtId);
  const busy = new Set<string>();

  const floors: FloorSpec[] = mine.map((m, fi) => {
    const openGate = gates.some((g) => g.mission_id === m.id);
    const desks: DeskSpec[] = m.nodes.slice(0, DESKS_PER_ROW * 4).map((n, i) => {
      const slot = deskSlot(i);
      const who = locals.find(
        (c) => c.mission_id === m.id && c.node_id === n.id && !busy.has(c.id),
      );
      if (who) busy.add(who.id);
      return {
        nodeId: n.id,
        label: n.title,
        artifacts: n.artifact_paths.length,
        state: deskState(n),
        x: slot.x,
        z: slot.z,
        ry: slot.ry,
        citizenId: who?.id,
        citizenName: who?.name,
        activity: who?.activity,
      };
    });
    const at = new Map(desks.map((d) => [d.nodeId, d]));
    const critical = new Set(m.critical_path);
    const links: LinkSpec[] = [];
    for (const n of m.nodes) {
      const to = at.get(n.id);
      if (!to) continue;
      for (const dep of n.depends_on) {
        const from = at.get(dep);
        if (!from) continue;
        links.push({
          from: [from.x, from.z],
          to: [to.x, to.z],
          critical: critical.has(n.id) && critical.has(dep),
          // ребро «живе», коли робота саме через нього зараз тече
          live: from.state === 'done' && (to.state === 'running' || to.state === 'review'),
        });
      }
    }

    return {
      index: fi,
      y: (fi + 1) * FLOOR_H,
      missionId: m.id,
      title: m.title,
      status: m.status,
      progress: m.progress,
      domain: m.domain,
      desks,
      links,
      awaitingGate: openGate,
    };
  });

  const lobby = locals
    .filter((c) => !busy.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, role: c.role, activity: c.activity }));

  const districtGates = gates.filter((g) =>
    mine.some((m) => m.id === g.mission_id),
  );

  return {
    districtId,
    label,
    domain: districtId as BuildingSpec['domain'],
    floors,
    lobby,
    gates: districtGates,
    plinths: [],
    isHall: false,
    height: (floors.length + 1) * FLOOR_H,
  };
}

export const DESK_STATE_VAR: Record<DeskState, string> = {
  running: '--accent',
  review: '--signal-warn',
  done: '--signal-ok',
  failed: '--signal-alert',
  blocked: '--signal-alert',
  ready: '--ink-secondary',
  pending: '--ink-muted',
  skipped: '--ink-faint',
};

/** Стіл світиться лише коли на ньому щось відбувається. */
export const DESK_LIT: Record<DeskState, number> = {
  running: 1.0,
  review: 0.8,
  blocked: 0.55,
  failed: 0.55,
  done: 0.28,
  ready: 0.2,
  pending: 0.08,
  skipped: 0.04,
};
