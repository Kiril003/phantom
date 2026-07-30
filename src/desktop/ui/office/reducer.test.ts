import { describe, expect, it } from 'vitest';
import { HubEnvelope } from '../types';
import {
  Agent,
  OfficeState,
  emptyOffice,
  liveCount,
  onFloor,
  parseGoal,
  reduce,
  reduceAll,
  sweep,
} from './reducer';

let clock = 1_000;
const env = (type: string, data: Record<string, unknown>, channel = 'agent.stream'): HubEnvelope => ({
  channel,
  type,
  data,
  ts: (clock += 10),
});

const bg = (type: string, data: Record<string, unknown>): HubEnvelope =>
  env(type, data, 'background_events');

const run = (...envelopes: HubEnvelope[]): OfficeState => reduceAll(emptyOffice(), envelopes);
const who = (s: OfficeState, id: string): Agent => {
  const a = s.agents.get(id);
  if (!a) throw new Error(`no agent ${id}`);
  return a;
};

describe('parseGoal', () => {
  it('lifts the role prefix spawn.py writes onto a sub-agent goal', () => {
    expect(parseGoal('[role=senior_backend] полагодь міграцію')).toEqual({
      role: 'senior_backend',
      text: 'полагодь міграцію',
    });
  });

  it('drops the constraints prefix too', () => {
    expect(parseGoal('[role=osint] [constraints=no bash] знайди звіт')).toEqual({
      role: 'osint',
      text: 'знайди звіт',
    });
  });

  it('leaves an operator goal alone', () => {
    expect(parseGoal('перевір пошту')).toEqual({ role: null, text: 'перевір пошту' });
  });

  it('survives a missing goal', () => {
    expect(parseGoal(undefined)).toEqual({ role: null, text: '' });
  });
});

describe('reducer — who is on the floor', () => {
  it('starts empty', () => {
    const s = emptyOffice();
    expect(s.agents.size).toBe(0);
    expect(liveCount(s)).toBe(0);
  });

  it('ignores channels that are not the office feeds', () => {
    const s = emptyOffice();
    expect(reduce(s, env('task.started', { task_id: 't1' }, 'chat'))).toBe(s);
    expect(reduce(s, env('transition', { to: 'FOCUS' }, 'state'))).toBe(s);
  });

  it('seats an operator task in the lobby', () => {
    const s = run(env('task.started', { task_id: 't1', goal: 'перевір пошту', track: 'foreground' }));
    const a = who(s, 't1');
    expect(a.zone).toBe('lobby');
    expect(a.role).toBeNull();
    expect(a.goal).toBe('перевір пошту');
    expect(a.track).toBe('foreground');
    expect(a.posture).toBe('arriving');
    expect(liveCount(s)).toBe(1);
  });

  it('sends a spawned specialist to its own department', () => {
    const s = run(
      bg('task.started', {
        task_id: 't2',
        goal: '[role=senior_backend] полагодь міграцію',
        track: 'background',
      }),
    );
    const a = who(s, 't2');
    expect(a.zone).toBe('engineering');
    expect(a.role).toBe('senior_backend');
    expect(a.goal).toBe('полагодь міграцію');
    expect(a.track).toBe('background');
  });

  it('routes each department from the specialist catalog', () => {
    const cases: [string, string][] = [
      ['team_lead_qa', 'qa'],
      ['designer', 'product'],
      ['osint', 'research'],
      ['translator', 'operations'],
      ['senior_perf', 'engineering'],
    ];
    for (const [role, zone] of cases) {
      const s = run(bg('task.started', { task_id: role, goal: `[role=${role}] x`, track: 'background' }));
      expect(who(s, role).zone).toBe(zone);
    }
  });

  it('keeps a role it cannot source in the lobby rather than guessing', () => {
    const s = run(bg('task.started', { task_id: 't3', goal: '[role=reviewer] переглянь', track: 'background' }));
    const a = who(s, 't3');
    expect(a.role).toBe('reviewer');
    expect(a.zone).toBe('lobby');
  });

  it('births a mission agent, which never emits task.started', () => {
    const s = run(
      env('mission.started', {
        mission_id: 'm1',
        task_id: 't4',
        brief: 'підняти стенд',
        phase_count: 3,
      }),
    );
    const a = who(s, 't4');
    expect(a.missionId).toBe('m1');
    expect(a.goal).toBe('підняти стенд');
    expect(a.zone).toBe('lobby');
  });

  it('holds a promoted task in place and only flips its track', () => {
    const s = run(
      env('task.started', { task_id: 't5', goal: 'довга праця', track: 'foreground' }),
      env('task.promoted_to_background', { task_id: 't5', reason: 'user_left', goal: 'довга праця' }),
    );
    const a = who(s, 't5');
    expect(a.track).toBe('background');
    expect(a.zone).toBe('lobby');
  });
});

describe('reducer — what a character is doing', () => {
  const started = env('task.started', { task_id: 't1', goal: 'мета', track: 'foreground' });

  it('follows the planner into thinking and back out', () => {
    let s = run(started, env('thinking.started', { task_id: 't1', planner: 'tactical', step_idx: 4 }));
    expect(who(s, 't1').posture).toBe('thinking');
    expect(who(s, 't1').step).toBe(4);
    s = reduce(s, env('thinking.completed', { task_id: 't1', planner: 'tactical', step_idx: 4 }));
    expect(who(s, 't1').posture).toBe('working');
  });

  it('names the running action', () => {
    const s = run(started, env('action.started', { task_id: 't1', step_idx: 7, action: 'bash.run' }));
    expect(who(s, 't1').detail).toBe('bash.run');
    expect(who(s, 't1').step).toBe(7);
  });

  it('carries the active sub-goal and clears it when done', () => {
    let s = run(started, env('sub_goal.started', { task_id: 't1', sub_goal_id: 'sg1', description: 'зібрати' }));
    expect(who(s, 't1').subGoal).toBe('зібрати');
    s = reduce(s, env('sub_goal.done', { task_id: 't1', sub_goal_id: 'sg1', summary: 'готово' }));
    expect(who(s, 't1').subGoal).toBeNull();
  });

  it('shows a quota block and the operator wait', () => {
    let s = run(started, env('task.blocked_quota', { task_id: 't1', reason: 'gemini_429', probe_interval_s: 30 }));
    expect(who(s, 't1').posture).toBe('blocked');
    expect(who(s, 't1').detail).toBe('gemini_429');
    s = reduce(s, env('task.waiting_user', { task_id: 't1', prompt_to_user: 'який шлях?' }));
    expect(who(s, 't1').posture).toBe('waiting_user');
    expect(who(s, 't1').detail).toBe('який шлях?');
  });

  it('reads substate.changed as a posture', () => {
    const s = run(started, env('substate.changed', { task_id: 't1', substate: 'paused' }));
    expect(who(s, 't1').posture).toBe('blocked');
  });

  it('stamps `since` only when the posture actually moves', () => {
    const s1 = run(started, env('reflection.started', { task_id: 't1', reason: 'streak' }));
    const at = who(s1, 't1').since;
    const s2 = reduce(s1, env('tool.selected', { task_id: 't1', action: 'fs.read', step_idx: 1 }));
    expect(who(s2, 't1').posture).toBe('reflecting');
    expect(who(s2, 't1').since).toBe(at);
  });

  it('returns the same state when nothing changed', () => {
    const s = run(started, env('action.started', { task_id: 't1', step_idx: 1, action: 'fs.read' }));
    const again = reduce(s, env('action.started', { task_id: 't1', step_idx: 1, action: 'fs.read' }));
    expect(again).toBe(s);
  });
});

describe('reducer — leaving the floor', () => {
  const started = env('task.started', { task_id: 't1', goal: 'мета', track: 'foreground' });

  it('walks a finished task out and then forgets it', () => {
    let s = run(started, env('task.completed', { task_id: 't1', track: 'foreground', summary: 'ok' }));
    const a = who(s, 't1');
    expect(a.posture).toBe('leaving');
    expect(a.outcome).toBe('done');
    expect(a.leftAt).not.toBeNull();
    expect(liveCount(s)).toBe(0);

    expect(sweep(s, a.leftAt! + 100, 4_000)).toBe(s);
    s = sweep(s, a.leftAt! + 4_000, 4_000);
    expect(s.agents.size).toBe(0);
  });

  it('marks a failure on the body before it goes', () => {
    for (const [type, outcome] of [
      ['task.failed', 'failed'],
      ['task.stopped', 'stopped'],
      ['task.timeout', 'timeout'],
    ] as const) {
      const s = run(
        env('task.started', { task_id: 'x', goal: 'мета', track: 'foreground' }),
        env(type, { task_id: 'x', track: 'foreground', error: 'boom' }),
      );
      expect(who(s, 'x').posture).toBe('failed');
      expect(who(s, 'x').outcome).toBe(outcome);
    }
  });

  it('ignores a second terminal event for the same task', () => {
    const s1 = run(started, env('task.completed', { task_id: 't1' }));
    const s2 = reduce(s1, env('task.failed', { task_id: 't1' }));
    expect(s2).toBe(s1);
    expect(who(s2, 't1').outcome).toBe('done');
  });
});

describe('reducer — out of order and orphan events', () => {
  it('never resurrects a task whose end already arrived', () => {
    const s = run(
      env('task.started', { task_id: 't1', goal: 'мета' }),
      env('task.completed', { task_id: 't1' }),
      env('task.started', { task_id: 't1', goal: 'мета' }),
    );
    const swept = sweep(s, 1e12, 1_000);
    expect(swept.agents.size).toBe(0);
  });

  it('materialises a task the Film joined mid-flight, unattributed and in view', () => {
    const s = run(env('action.started', { task_id: 'ghost', step_idx: 12, action: 'web.search' }));
    const a = who(s, 'ghost');
    expect(a.unattributed).toBe(true);
    expect(a.zone).toBe('lobby');
    expect(a.detail).toBe('web.search');
  });

  it('never conjures a character out of a terminal event alone', () => {
    const s = run(
      env('task.completed', { task_id: 'unseen', summary: 'ok' }),
      env('task.failed', { task_id: 'unseen2' }),
      env('task.report_ready', { task_id: 'unseen3', report: {} }),
    );
    expect(s.agents.size).toBe(0);
  });

  it('drops events with no task at all', () => {
    const s = emptyOffice();
    expect(reduce(s, env('thinking.started', { planner: 'tactical' }))).toBe(s);
    expect(reduce(s, env('substate.changed', { task_id: null, substate: 'thinking' }))).toBe(s);
  });

  it('ignores an event type it has no mapping for', () => {
    const s1 = run(env('task.started', { task_id: 't1', goal: 'мета' }));
    const s2 = reduce(s1, env('task.safety_changed', { task_id: 't1', unsafe_mode: true }));
    expect(s2).toBe(s1);
  });
});

describe('reducer — desks', () => {
  it('seats agents of one department at distinct desks', () => {
    const s = run(
      bg('task.started', { task_id: 'a', goal: '[role=senior_backend] x', track: 'background' }),
      bg('task.started', { task_id: 'b', goal: '[role=senior_frontend] y', track: 'background' }),
      bg('task.started', { task_id: 'c', goal: '[role=senior_perf] z', track: 'background' }),
    );
    const slots = onFloor(s)
      .filter((a) => a.zone === 'engineering')
      .map((a) => a.slot);
    expect(slots).toEqual([0, 1, 2]);
  });

  it('holds a desk while the character walks out, then hands it on', () => {
    let s = run(
      bg('task.started', { task_id: 'a', goal: '[role=senior_backend] x', track: 'background' }),
      bg('task.completed', { task_id: 'a' }),
    );
    s = reduce(s, bg('task.started', { task_id: 'b', goal: '[role=senior_devops] y', track: 'background' }));
    expect(who(s, 'b').slot).toBe(1);
    s = sweep(s, 1e12, 1_000);
    s = reduce(s, bg('task.started', { task_id: 'c', goal: '[role=senior_security] z', track: 'background' }));
    expect(who(s, 'c').slot).toBe(0);
  });
});

describe('reducer — handovers', () => {
  const twoAgents = [
    bg('task.started', { task_id: 'pm', goal: '[role=product_manager] x', track: 'background' }),
    bg('task.started', { task_id: 'qa', goal: '[role=senior_test] y', track: 'background' }),
  ];

  it('ties a team message to the two characters it names', () => {
    const s = run(
      ...twoAgents,
      env('team.message', {
        id: 'm1',
        task_id: 'qa',
        parent_task_id: 'pm',
        sender: 'Product Manager',
        receiver: 'senior_test',
        message: 'почни тестування',
        message_type: 'delegate',
      }),
    );
    expect(s.handovers).toHaveLength(1);
    expect(s.handovers[0]).toMatchObject({
      id: 'm1',
      fromTaskId: 'pm',
      toTaskId: 'qa',
      kind: 'delegate',
    });
  });

  it('resolves a department name when exactly one character is there', () => {
    const s = run(
      ...twoAgents,
      env('team.message', {
        task_id: 'qa',
        parent_task_id: 'pm',
        sender: 'product',
        receiver: 'qa',
        message: 'go',
      }),
    );
    expect(s.handovers[0]).toMatchObject({ fromTaskId: 'pm', toTaskId: 'qa' });
  });

  it('leaves an end null when it names nobody on the floor', () => {
    const s = run(
      ...twoAgents,
      env('team.message', {
        task_id: 'nope',
        parent_task_id: 'also-nope',
        sender: 'ghost_role',
        receiver: 'other_ghost',
        message: 'hello',
      }),
    );
    expect(s.handovers[0]).toMatchObject({ fromTaskId: null, toTaskId: null });
  });

  it('records no handover from a character to itself', () => {
    const s = run(
      ...twoAgents,
      env('team.message', {
        task_id: 'pm',
        parent_task_id: 'pm',
        sender: 'product_manager',
        receiver: 'product_manager',
        message: 'нотатка',
      }),
    );
    expect(s.handovers).toHaveLength(0);
  });

  it('bounds the handover log', () => {
    let s = run(...twoAgents);
    for (let i = 0; i < 40; i += 1) {
      s = reduce(
        s,
        env('team.message', {
          id: `m${i}`,
          task_id: 'qa',
          parent_task_id: 'pm',
          sender: 'product_manager',
          receiver: 'senior_test',
          message: `n${i}`,
        }),
      );
    }
    expect(s.handovers.length).toBeLessThanOrEqual(24);
    expect(s.handovers[s.handovers.length - 1].id).toBe('m39');
  });
});
