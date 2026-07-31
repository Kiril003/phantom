/** Envelopes in, office state out. Pure — no three, no DOM, no clock.
 *
 *  The one law lives here: every character in the returned state is backed by
 *  an event the kernel actually broadcast. Nothing in this file invents an
 *  agent, and nothing keeps one alive past its terminal event.
 *
 *  Payload field names are taken from the broadcast sites themselves:
 *  `agent/kernel/loop.py`, `agent/kernel/runtime.py`, `agent/kernel/audit.py`
 *  and `agent/kernel/rehydrate.py`. */

import { HubEnvelope } from '../types';
import { ZoneId, slotsOf } from './layout';
import { departmentOf, isDepartment, normaliseRole } from './roles';

export type Posture =
  | 'arriving'
  | 'working'
  | 'thinking'
  | 'reflecting'
  | 'blocked'
  | 'waiting_user'
  | 'failed'
  | 'leaving';

export type Track = 'foreground' | 'background';

export interface Agent {
  taskId: string;
  /** Specialist role, when the kernel gave us one. */
  role: string | null;
  zone: ZoneId;
  /** Desk index within the zone; stable for the agent's whole life. */
  slot: number;
  goal: string;
  track: Track;
  posture: Posture;
  /** What it is doing right now, in the kernel's own words. */
  detail: string;
  subGoal: string | null;
  step: number;
  parentTaskId: string | null;
  missionId: string | null;
  /** True when the Film joined mid-flight and never saw this task start. */
  unattributed: boolean;
  since: number;
  /** Set by the terminal event; the agent walks out after this. */
  leftAt: number | null;
  outcome: 'done' | 'failed' | 'stopped' | 'timeout' | null;
}

export interface Handover {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  sender: string;
  receiver: string;
  message: string;
  kind: string;
  at: number;
}

export interface PendingHandover {
  id: string;
  senderTaskId: string | null;
  receiverTaskId: string | null;
  sender: string;
  receiver: string;
  message: string;
  kind: string;
  at: number;
}

export interface OfficeState {
  agents: ReadonlyMap<string, Agent>;
  /** Newest last; both ends are on the floor. */
  handovers: readonly Handover[];
  /** Messages whose other end has not appeared yet. */
  pending: readonly PendingHandover[];
  /** Task ids that already reached a terminal event — never resurrected. */
  retired: ReadonlySet<string>;
  /** Bumps whenever anything at all changed. */
  revision: number;
}

const HANDOVER_LIMIT = 24;
const RETIRED_LIMIT = 256;
const PENDING_LIMIT = 16;
/** A delegate message beats its child's task.started; a child that never runs must not queue forever. */
const PENDING_TTL_MS = 30_000;

const OFFICE_CHANNELS = new Set(['agent.stream', 'background_events']);

export function emptyOffice(): OfficeState {
  return { agents: new Map(), handovers: [], pending: [], retired: new Set(), revision: 0 };
}

interface ParsedGoal {
  role: string | null;
  text: string;
}

/** `spawn.py:_build_subagent_goal` decorates a sub-agent's goal with
 *  `[role=…] [constraints=…]`. That prefix is the only place a specialist's
 *  department reaches the wire — `task.started` carries no role field. */
export function parseGoal(raw: unknown): ParsedGoal {
  if (typeof raw !== 'string') return { role: null, text: '' };
  let text = raw.trim();
  let role: string | null = null;
  const roleMatch = /^\[role=([^\]]*)\]\s*/.exec(text);
  if (roleMatch) {
    role = roleMatch[1].trim() || null;
    text = text.slice(roleMatch[0].length);
  }
  const consMatch = /^\[constraints=([^\]]*)\]\s*/.exec(text);
  if (consMatch) text = text.slice(consMatch[0].length);
  return { role, text: text.trim() };
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function trackOf(v: unknown): Track {
  return v === 'background' ? 'background' : 'foreground';
}

/** Lowest free desk in the zone. Deterministic, so a replayed event stream
 *  seats everyone identically. */
function freeSlot(agents: ReadonlyMap<string, Agent>, zone: ZoneId): number {
  const taken = new Set<number>();
  for (const a of agents.values()) if (a.zone === zone) taken.add(a.slot);
  const capacity = slotsOf(zone).length + taken.size + 1;
  for (let i = 0; i < capacity; i += 1) if (!taken.has(i)) return i;
  return taken.size;
}

interface Ctx {
  agents: Map<string, Agent>;
  handovers: Handover[];
  pending: PendingHandover[];
  retired: Set<string>;
  changed: boolean;
  at: number;
}

function patch(ctx: Ctx, taskId: string, next: Partial<Agent>): void {
  const cur = ctx.agents.get(taskId);
  if (!cur) return;
  let differs = false;
  for (const k of Object.keys(next) as (keyof Agent)[]) {
    if (cur[k] !== next[k]) {
      differs = true;
      break;
    }
  }
  if (!differs) return;
  const merged: Agent = { ...cur, ...next };
  if (next.posture !== undefined && next.posture !== cur.posture) merged.since = ctx.at;
  ctx.agents.set(taskId, merged);
  ctx.changed = true;
}

interface BirthOptions {
  role?: string | null;
  goal?: string;
  track?: Track;
  parentTaskId?: string | null;
  missionId?: string | null;
  unattributed?: boolean;
}

/**
 * Materialise a character for a task the kernel is talking about.
 *
 * An event carrying a task_id is proof that task is alive, so a character is
 * owed even when the Film connected mid-flight and never saw `task.started` —
 * that character is marked `unattributed` and works in the lobby, because a
 * department we cannot source would be an invention.
 */
function ensure(ctx: Ctx, taskId: string, opts: BirthOptions = {}): Agent | null {
  const existing = ctx.agents.get(taskId);
  if (existing) return existing;
  if (ctx.retired.has(taskId)) return null;

  const role = opts.role ?? null;
  const zone: ZoneId = departmentOf(role) ?? 'lobby';
  const agent: Agent = {
    taskId,
    role,
    zone,
    slot: freeSlot(ctx.agents, zone),
    goal: opts.goal ?? '',
    track: opts.track ?? 'foreground',
    posture: 'arriving',
    detail: '',
    subGoal: null,
    step: 0,
    parentTaskId: opts.parentTaskId ?? null,
    missionId: opts.missionId ?? null,
    unattributed: opts.unattributed ?? false,
    since: ctx.at,
    leftAt: null,
    outcome: null,
  };
  ctx.agents.set(taskId, agent);
  ctx.changed = true;
  return agent;
}

function retire(ctx: Ctx, taskId: string, outcome: Agent['outcome']): void {
  const agent = ctx.agents.get(taskId);
  if (!agent || agent.leftAt !== null) return;
  patch(ctx, taskId, {
    posture: outcome === 'done' ? 'leaving' : 'failed',
    leftAt: ctx.at,
    outcome,
  });
  ctx.retired.add(taskId);
  while (ctx.retired.size > RETIRED_LIMIT) {
    const oldest = ctx.retired.values().next().value as string | undefined;
    if (oldest === undefined) break;
    ctx.retired.delete(oldest);
  }
  ctx.changed = true;
}

function uniqueBy(ctx: Ctx, match: (a: Agent) => boolean): string | null {
  let found: string | null = null;
  for (const a of ctx.agents.values()) {
    if (!match(a)) continue;
    if (found !== null) return null;
    found = a.taskId;
  }
  return found;
}

/** The task id is exact; a role name is a guess that two twins can both answer to. */
function resolveParty(ctx: Ctx, name: string, taskId: string | null): string | null {
  if (taskId !== null && ctx.agents.has(taskId)) return taskId;
  if (!name) return null;
  const key = normaliseRole(name);
  const byRole = uniqueBy(ctx, (a) => a.role !== null && normaliseRole(a.role) === key);
  if (byRole !== null) return byRole;
  if (isDepartment(key)) return uniqueBy(ctx, (a) => a.zone === key);
  return null;
}

// spawn.py sends task_id as the receiver and parent_task_id as the sender, both directions.
function applyTeamMessage(ctx: Ctx, data: Record<string, unknown>): void {
  const receiverTaskId = str(data.task_id);
  const senderTaskId = str(data.parent_task_id);
  if (senderTaskId !== null && senderTaskId === receiverTaskId) return;
  ctx.pending.push({
    id: str(data.id) ?? `${senderTaskId ?? '?'}>${receiverTaskId ?? '?'}@${ctx.at}`,
    senderTaskId,
    receiverTaskId,
    sender: str(data.sender) ?? '',
    receiver: str(data.receiver) ?? '',
    message: str(data.message) ?? '',
    kind: str(data.message_type) ?? 'text',
    at: ctx.at,
  });
  while (ctx.pending.length > PENDING_LIMIT) ctx.pending.shift();
  ctx.changed = true;
}

function bind(ctx: Ctx, p: PendingHandover): Handover | null {
  const from = resolveParty(ctx, p.sender, p.senderTaskId);
  const to = resolveParty(ctx, p.receiver, p.receiverTaskId);
  if (from === null || to === null || from === to) return null;
  return {
    id: p.id,
    fromTaskId: from,
    toTaskId: to,
    sender: p.sender,
    receiver: p.receiver,
    message: p.message,
    kind: p.kind,
    at: p.at,
  };
}

function settle(ctx: Ctx): void {
  if (ctx.pending.length === 0) return;
  const held: PendingHandover[] = [];
  for (const p of ctx.pending) {
    const bound = bind(ctx, p);
    if (bound) {
      ctx.handovers.push(bound);
      while (ctx.handovers.length > HANDOVER_LIMIT) ctx.handovers.shift();
      ctx.changed = true;
    } else if (ctx.at - p.at < PENDING_TTL_MS) {
      held.push(p);
    } else {
      ctx.changed = true;
    }
  }
  if (held.length !== ctx.pending.length) ctx.pending = held;
}

const SUBSTATE_POSTURE: Readonly<Record<string, Posture>> = {
  thinking: 'thinking',
  reflecting: 'reflecting',
  paused: 'blocked',
  blocked_quota: 'blocked',
  waiting_user: 'waiting_user',
  awaiting_user: 'waiting_user',
  acting: 'working',
  running: 'working',
};

function apply(ctx: Ctx, type: string, data: Record<string, unknown>): void {
  const taskId = str(data.task_id);

  switch (type) {
    case 'task.started': {
      if (!taskId) return;
      const parsed = parseGoal(data.goal);
      const born = ensure(ctx, taskId, {
        role: str(data.subagent_role) ?? parsed.role,
        goal: parsed.text,
        track: trackOf(data.track),
        parentTaskId: str(data.parent_task_id),
      });
      if (!born) return;
      patch(ctx, taskId, {
        goal: parsed.text || born.goal,
        track: trackOf(data.track),
        posture: 'arriving',
      });
      return;
    }

    // Missions never emit `task.started` — `run_task_loop` hands straight to
    // `run_mission_loop`, so this is the mission agent's only birth event.
    case 'mission.started': {
      if (!taskId) return;
      const born = ensure(ctx, taskId, {
        goal: str(data.brief) ?? '',
        missionId: str(data.mission_id),
      });
      if (!born) return;
      patch(ctx, taskId, { detail: str(data.brief) ?? '', posture: 'arriving' });
      return;
    }

    case 'task.resumed_from_crash': {
      if (!taskId) return;
      if (!ensure(ctx, taskId, { track: trackOf(data.track), missionId: str(data.mission_id) })) return;
      patch(ctx, taskId, { posture: 'arriving', step: num(data.step_idx) ?? 0 });
      return;
    }

    case 'task.completed':
      retire(ctx, taskId ?? '', 'done');
      return;
    case 'task.failed':
      retire(ctx, taskId ?? '', 'failed');
      return;
    case 'task.stopped':
      retire(ctx, taskId ?? '', 'stopped');
      return;
    case 'task.timeout':
      retire(ctx, taskId ?? '', 'timeout');
      return;

    // Always trails a terminal event, so it can only ever speak about a
    // character already on the floor.
    case 'task.report_ready':
      if (taskId) patch(ctx, taskId, { detail: 'звіт готовий' });
      return;

    case 'team.message':
      applyTeamMessage(ctx, data);
      return;
  }

  if (!taskId) return;
  // Beyond birth and death, an event only ever speaks about a character that
  // is already on the floor — or one the kernel is proving alive right now.
  if (!ensure(ctx, taskId, { unattributed: true })) return;

  switch (type) {
    case 'task.promoted_to_background':
      patch(ctx, taskId, { track: 'background' });
      break;

    case 'task.paused':
      patch(ctx, taskId, { posture: 'blocked', detail: str(data.reason) ?? 'пауза' });
      break;
    case 'task.blocked_quota':
    case 'task.blocked_quota_backoff':
      patch(ctx, taskId, { posture: 'blocked', detail: str(data.reason) ?? 'квота' });
      break;
    case 'task.waiting_user':
      patch(ctx, taskId, {
        posture: 'waiting_user',
        detail: str(data.prompt_to_user) ?? 'чекає на оператора',
      });
      break;
    case 'task.resumed':
    case 'agent.resumed_with_caveat':
      patch(ctx, taskId, { posture: 'working', detail: str(data.reason) ?? '' });
      break;
    case 'task.intervention_received':
      patch(ctx, taskId, {
        posture: 'working',
        detail: str(data.instruction_summary) ?? 'втручання оператора',
      });
      break;
    case 'substate.changed': {
      const sub = str(data.substate);
      const posture = sub ? SUBSTATE_POSTURE[sub] : undefined;
      if (posture) patch(ctx, taskId, { posture });
      break;
    }

    case 'thinking.started':
      patch(ctx, taskId, { posture: 'thinking', step: num(data.step_idx) ?? 0 });
      break;
    case 'thinking.completed':
      patch(ctx, taskId, { posture: 'working' });
      break;
    case 'reflection.started':
      patch(ctx, taskId, { posture: 'reflecting', detail: str(data.reason) ?? '' });
      break;
    case 'reflection.completed':
      patch(ctx, taskId, { posture: 'working', detail: str(data.verdict) ?? '' });
      break;

    case 'action.started':
      patch(ctx, taskId, {
        posture: 'working',
        detail: str(data.action) ?? '',
        step: num(data.step_idx) ?? 0,
      });
      break;
    case 'tool.selected':
      patch(ctx, taskId, { detail: str(data.action) ?? '' });
      break;

    case 'sub_goal.started':
      patch(ctx, taskId, { posture: 'working', subGoal: str(data.description) });
      break;
    case 'sub_goal.done':
      patch(ctx, taskId, { subGoal: null, detail: str(data.summary) ?? '' });
      break;
    case 'sub_goal.abandoned':
      patch(ctx, taskId, { subGoal: null, detail: str(data.reason) ?? 'покинуто' });
      break;

    case 'strategic_plan.created':
      patch(ctx, taskId, { posture: 'working' });
      break;
    case 'plan.step_created': {
      const step = data.step as Record<string, unknown> | undefined;
      patch(ctx, taskId, {
        detail: (step && str(step.action)) ?? '',
        step: (step && num(step.step_idx)) ?? 0,
      });
      break;
    }
    case 'plan.architectural_decision':
      patch(ctx, taskId, { detail: str(data.rationale) ?? '' });
      break;

    case 'mission.phase_started':
      patch(ctx, taskId, { posture: 'working', subGoal: str(data.description) });
      break;
    case 'mission.phase_completed':
      patch(ctx, taskId, { subGoal: null });
      break;
    case 'mission.completed':
      patch(ctx, taskId, { detail: 'місію виконано' });
      break;
    case 'mission.failed':
      patch(ctx, taskId, { posture: 'failed', detail: str(data.reason) ?? '' });
      break;

    case 'warning.issued':
      patch(ctx, taskId, { detail: str(data.message) ?? str(data.category) ?? '' });
      break;
    case 'agent.budget.warning':
      patch(ctx, taskId, { detail: `бюджет: ${num(data.llm_calls_used) ?? 0}/${num(data.cap_at) ?? 0}` });
      break;
    case 'system.install_dependency':
      patch(ctx, taskId, { detail: `встановлює ${str(data.dependency) ?? ''}`.trim() });
      break;
    case 'system.memory_compressed':
      patch(ctx, taskId, { detail: str(data.summary_excerpt) ?? 'стиснуто пам’ять' });
      break;
    case 'checkpoint.created':
      patch(ctx, taskId, { detail: `чекпоінт: ${str(data.reason) ?? ''}`.trim() });
      break;

    default:
      break;
  }
}

export function reduce(state: OfficeState, env: HubEnvelope): OfficeState {
  if (!OFFICE_CHANNELS.has(env.channel)) return state;
  const ctx: Ctx = {
    agents: new Map(state.agents),
    handovers: [...state.handovers],
    pending: [...state.pending],
    retired: new Set(state.retired),
    changed: false,
    at: typeof env.ts === 'number' && env.ts > 0 ? env.ts : Date.now(),
  };
  apply(ctx, env.type, env.data ?? {});
  settle(ctx);
  if (!ctx.changed) return state;
  return {
    agents: ctx.agents,
    handovers: ctx.handovers,
    pending: ctx.pending,
    retired: ctx.retired,
    revision: state.revision + 1,
  };
}

export function reduceAll(state: OfficeState, envelopes: readonly HubEnvelope[]): OfficeState {
  return envelopes.reduce(reduce, state);
}

/** Drop characters that finished walking out. Pure; the clock is the caller's. */
export function sweep(state: OfficeState, now: number, lingerMs: number): OfficeState {
  let agents: Map<string, Agent> | null = null;
  for (const a of state.agents.values()) {
    if (a.leftAt !== null && now - a.leftAt >= lingerMs) {
      if (!agents) agents = new Map(state.agents);
      agents.delete(a.taskId);
    }
  }
  if (!agents) return state;
  return { ...state, agents, revision: state.revision + 1 };
}

export function onFloor(state: OfficeState): Agent[] {
  return [...state.agents.values()];
}

export function liveCount(state: OfficeState): number {
  let n = 0;
  for (const a of state.agents.values()) if (a.leftAt === null) n += 1;
  return n;
}
