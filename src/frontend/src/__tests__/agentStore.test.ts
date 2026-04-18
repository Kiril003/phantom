import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore } from '../stores/agentStore';
import type { AgentEvent } from '@shared/types';

function ev<T extends AgentEvent['type']>(type: T, payload: Record<string, unknown> = {}): AgentEvent {
  return { type, ts: Date.now(), payload };
}

describe('agentStore.handleEvent', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('boots a task on task.started with a SelfModel payload', () => {
    const handle = useAgentStore.getState().handleEvent;
    handle(ev('task.started', {
      task_id: 'T1',
      goal: 'explore etc',
      self_model: { capabilities: ['fs.read'], risk_tolerance: 5 },
    }));
    const s = useAgentStore.getState();
    expect(s.currentTask?.task.goal).toBe('explore etc');
    expect(s.status).toBe('running');
    expect(s.connectionStatus).toBe('running');
  });

  it('tracks sub-goal status transitions', () => {
    const handle = useAgentStore.getState().handleEvent;
    handle(ev('strategic_plan.created', {
      task_id: 'T1',
      sub_goals: [
        { id: 'sg1', description: 'a', status: 'pending', actions_used: 0, expected_actions: 2, rationale: '', acceptance_criteria: '' },
        { id: 'sg2', description: 'b', status: 'pending', actions_used: 0, expected_actions: 1, rationale: '', acceptance_criteria: '' },
      ],
      estimated_total_actions: 3,
    }));
    handle(ev('sub_goal.started', { task_id: 'T1', sub_goal_id: 'sg1' }));
    const sAfterStart = useAgentStore.getState();
    expect(sAfterStart.subGoals.find((x) => x.id === 'sg1')?.status).toBe('active');
    handle(ev('sub_goal.done', { task_id: 'T1', sub_goal_id: 'sg1' }));
    expect(useAgentStore.getState().subGoals.find((x) => x.id === 'sg1')?.status).toBe('done');
  });

  it('caps events at 500 entries', () => {
    const handle = useAgentStore.getState().handleEvent;
    for (let i = 0; i < 520; i++) {
      handle(ev('observation.added', { task_id: 'T', observation: {
        step_idx: i, type: 'result', source: 's', content: `${i}`, confidence: 1, entities: [],
        ts: new Date().toISOString(),
      } }));
    }
    expect(useAgentStore.getState().events.length).toBe(500);
  });

  it('updates substate on substate.changed', () => {
    const handle = useAgentStore.getState().handleEvent;
    handle(ev('substate.changed', { task_id: 'T', substate: 'thinking' }));
    expect(useAgentStore.getState().substate).toBe('thinking');
    handle(ev('substate.changed', { task_id: 'T', substate: 'acting' }));
    expect(useAgentStore.getState().substate).toBe('acting');
  });

  it('sets promptToUser on task.waiting_user, clears on intervention', () => {
    const handle = useAgentStore.getState().handleEvent;
    handle(ev('task.waiting_user', { task_id: 'T', prompt_to_user: 'approve please?' }));
    expect(useAgentStore.getState().promptToUser).toBe('approve please?');
    handle(ev('task.intervention_received', { task_id: 'T', instruction_summary: 'approve' }));
    expect(useAgentStore.getState().promptToUser).toBeNull();
  });

  it('pauseTask calls API with current task id', async () => {
    vi.resetModules();
    const pause = vi.fn().mockResolvedValue({ paused: true });
    vi.doMock('../services/agentApi', () => ({
      agentApi: {
        pause,
        startTask: vi.fn(),
        resume: vi.fn(),
        intervene: vi.fn(),
        cancelStep: vi.fn(),
        stop: vi.fn(),
        checkpoint: vi.fn(),
        resumeFromCheckpoint: vi.fn(),
        listTasks: vi.fn(),
        getTask: vi.fn(),
        audit: vi.fn(),
        selfModel: vi.fn(),
        feedback: vi.fn(),
      },
    }));
    const mod = await import('../stores/agentStore');
    mod.useAgentStore.getState().reset();
    mod.useAgentStore.getState().handleEvent(ev('task.started', { task_id: 'T9', goal: 'g', self_model: {} }));
    await mod.useAgentStore.getState().pauseTask();
    expect(pause).toHaveBeenCalledWith('T9');
  });
});
