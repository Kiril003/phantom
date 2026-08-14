/** Місія одним поглядом: хід (що сталось) і план (з чого складається).
 * Чисті похідні від стану — жодних запитів, жодного часу «зараз» усередині,
 * тому все це можна перевірити тестом. */
import type {
  PolisMission,
  PolisNode,
  PolisChatMessage,
  PolisArtifactMeta,
  PolisCitizen,
} from '@shared/types';

/* ── хід місії ────────────────────────────────────────────────────────── */

export type ThreadKind = 'operator' | 'phantom' | 'ok' | 'fail' | 'forge' | 'note';

export interface ThreadEntry {
  id: string;
  kind: ThreadKind;
  text: string;
  /** вузол, якого стосується запис — саме ним хід зшито з планом */
  nodeId: string | null;
  /** зміни, які Фантом застосував до графа */
  applied: string[];
  /** файли, названі у записі */
  files: string[];
}

/** Системні рядки приходять із маркером-гліфом на початку. Гліф несе тип,
 * але у стрічці ми малюємо власну крапку, тому текст від нього чистимо. */
const MARKERS: { glyph: RegExp; kind: ThreadKind }[] = [
  { glyph: /^✓/u, kind: 'ok' },
  { glyph: /^✗/u, kind: 'fail' },
  { glyph: /^[⚒⚙]/u, kind: 'forge' },
  { glyph: /^🌐/u, kind: 'note' },
];

function classify(text: string): ThreadKind {
  for (const m of MARKERS) if (m.glyph.test(text)) return m.kind;
  return 'note';
}

const STRIP = /^[✓✗⚒⚙🌐]\s*/u;

/** Файли з рядка «…викувала 3 файли: a.ts, b.ts». Вживається лише як запасний
 * шлях: коли запис прив'язано до вузла, правда береться з `artifact_paths`. */
function filesFromText(text: string): string[] {
  const at = text.indexOf(':');
  if (at < 0) return [];
  return text
    .slice(at + 1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.includes(' '));
}

export function buildThread(
  chat: PolisChatMessage[],
  mission: PolisMission | undefined,
): ThreadEntry[] {
  const byId = new Map((mission?.nodes ?? []).map((n) => [n.id, n]));

  return chat.map((m, i) => {
    const id = `${i}:${m.ts ?? ''}`;
    if (m.role === 'operator') {
      return { id, kind: 'operator' as const, text: m.text, nodeId: null, applied: [], files: [] };
    }
    if (m.role === 'phantom') {
      return {
        id,
        kind: 'phantom' as const,
        text: m.text,
        nodeId: m.node_id ?? null,
        applied: m.applied ?? [],
        files: [],
      };
    }
    const kind = classify(m.text);
    const nodeId = m.node_id ?? null;
    const node = nodeId ? byId.get(nodeId) : undefined;
    return {
      id,
      kind,
      text: m.text.replace(STRIP, ''),
      nodeId,
      applied: [],
      // вузол знає свої файли точно — але ПОРОЖНІЙ список не має глушити текст:
      // подія про кування вже названа, а вузол міг ще не долити artifact_paths
      files: kind === 'forge'
        ? (node?.artifact_paths?.length ? node.artifact_paths : filesFromText(m.text))
        : [],
    };
  });
}

/* ── план місії ───────────────────────────────────────────────────────── */

export interface PlanRow {
  node: PolisNode;
  index: number;
  /** вузол лежить на критичному шляху — затримка тут зсуває всю місію */
  critical: boolean;
  /** 0..1: done = 1, у роботі — частка витраченого бюджету, решта = 0 */
  progress: number;
  crew: string;
  artifacts: PolisArtifactMeta[];
  /** скільки хвилин вузол уже йде або йшов */
  minutes: number | null;
  /** назви незавершених залежностей — це і є відповідь «чому стоїть» */
  waitingFor: string[];
  citizen?: PolisCitizen;
}

const LIVE = new Set(['running', 'review']);

function nodeProgress(n: PolisNode): number {
  if (n.status === 'done' || n.status === 'skipped') return 1;
  if (!LIVE.has(n.status)) return 0;
  const { spent_tokens, max_tokens } = n.budget;
  if (!max_tokens) return 0.5;
  // бюджет — єдина чесна міра поступу всередині вузла; вище 95% не малюємо,
  // бо «майже готово» роками не завершується
  return Math.min(0.95, spent_tokens / max_tokens);
}

function minutesBetween(from?: string, to?: string): number | null {
  if (!from) return null;
  const a = Date.parse(from);
  const b = to ? Date.parse(to) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 60000));
}

export function buildPlan(
  mission: PolisMission | undefined,
  artifacts: PolisArtifactMeta[],
  citizens: PolisCitizen[],
  now?: number,
): PlanRow[] {
  if (!mission) return [];
  const critical = new Set(mission.critical_path);
  const byId = new Map(mission.nodes.map((n) => [n.id, n]));
  const filesByNode = new Map<string, PolisArtifactMeta[]>();
  for (const a of artifacts) {
    if (!a.node_id) continue;
    const list = filesByNode.get(a.node_id);
    if (list) list.push(a);
    else filesByNode.set(a.node_id, [a]);
  }

  return mission.nodes.map((n, index) => {
    const waitingFor = n.depends_on
      .map((d) => byId.get(d))
      .filter((d): d is PolisNode => !!d && d.status !== 'done' && d.status !== 'skipped')
      .map((d) => d.title);

    // вузол, що досі біжить, міряємо від старту до «зараз»
    const until = n.finished_at ?? (now !== undefined ? new Date(now).toISOString() : undefined);

    return {
      node: n,
      index,
      critical: critical.has(n.id),
      progress: nodeProgress(n),
      crew: n.crew?.lead ?? n.crew?.roles?.[0] ?? '',
      artifacts: filesByNode.get(n.id) ?? [],
      minutes: minutesBetween(n.started_at, until),
      waitingFor,
      citizen: citizens.find((c) => c.mission_id === mission.id && c.node_id === n.id),
    };
  });
}

/* ── показники місії ──────────────────────────────────────────────────── */

export interface MissionVitals {
  progress: number;
  /** 0..1 — скільки бюджета токенів з'їдено */
  pressure: number;
  spentCalls: number;
  maxCalls: number;
  running: number;
  queued: number;
  failed: number;
  files: number;
  /** хвилин від створення місії */
  elapsed: number | null;
}

export function missionVitals(
  mission: PolisMission | undefined,
  artifacts: PolisArtifactMeta[],
  now?: number,
): MissionVitals | null {
  if (!mission) return null;
  const { budget, nodes } = mission;
  return {
    progress: mission.progress,
    pressure: budget.max_tokens ? budget.spent_tokens / budget.max_tokens : 0,
    spentCalls: budget.spent_llm_calls,
    maxCalls: budget.max_llm_calls,
    running: nodes.filter((n) => LIVE.has(n.status)).length,
    queued: nodes.filter((n) => n.status === 'pending' || n.status === 'ready').length,
    failed: nodes.filter((n) => n.status === 'failed').length,
    files: artifacts.length,
    elapsed: minutesBetween(
      mission.created_at,
      now !== undefined ? new Date(now).toISOString() : undefined,
    ),
  };
}

/** «3 хв», «2 год 10 хв» — час читається без перерахунку в голові. */
export function humanMinutes(min: number | null): string {
  if (min === null) return '';
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} год ${m} хв` : `${h} год`;
}

export const NODE_LABEL: Record<PolisNode['status'], string> = {
  pending: 'черга',
  ready: 'готовий',
  running: 'у роботі',
  blocked: 'стоїть',
  review: 'рев’ю',
  done: 'здано',
  failed: 'зрив',
  skipped: 'пропущено',
};

export const NODE_VAR: Record<PolisNode['status'], string> = {
  running: '--accent',
  review: '--signal-warn',
  done: '--signal-ok',
  failed: '--signal-alert',
  blocked: '--signal-alert',
  ready: '--ink-secondary',
  pending: '--ink-muted',
  skipped: '--ink-faint',
};
