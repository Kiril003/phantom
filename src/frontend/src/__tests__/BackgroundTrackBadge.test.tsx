/**
 * Phase 9.4a — StatusBar background-track badge derivation.
 *
 * Uses the pure helper so we can test the "visible iff there's activity"
 * rule, color+title variations, and the idle → hidden default without
 * mounting the full StatusBar.
 */
import { describe, it, expect } from 'vitest';
import { deriveBackgroundTrackView } from '../components/core/StatusBar';
import type { AgentStatusSnapshot } from '../services/agentApi';

const idleSnap: AgentStatusSnapshot = {
  foreground: { active: false, task_id: null, substate: 'idle', goal: null, origin: null, queue_size: 0 },
  background: { active: false, task_id: null, substate: 'idle', goal: null, origin: null, queue_size: 0 },
};

describe('deriveBackgroundTrackView', () => {
  it('is hidden when snap is null (not loaded yet)', () => {
    const v = deriveBackgroundTrackView(null);
    expect(v.visible).toBe(false);
    expect(v.total).toBe(0);
  });

  it('is hidden when both tracks idle + queue empty', () => {
    const v = deriveBackgroundTrackView(idleSnap);
    expect(v.visible).toBe(false);
  });

  it('is visible and green when background task is active', () => {
    const snap: AgentStatusSnapshot = {
      ...idleSnap,
      background: {
        active: true, task_id: 'bg-1', substate: 'acting',
        goal: 'disk check', origin: 'standing_order', queue_size: 0,
      },
    };
    const v = deriveBackgroundTrackView(snap);
    expect(v.visible).toBe(true);
    expect(v.total).toBe(1);
    expect(v.color).toBe('var(--signal-ok)');
    expect(v.title).toContain('standing_order');
    expect(v.title).toContain('acting');
  });

  it('shows active+queued count when both have entries', () => {
    const snap: AgentStatusSnapshot = {
      ...idleSnap,
      background: {
        active: true, task_id: 'bg-1', substate: 'thinking',
        goal: 'x', origin: 'proactive_auto', queue_size: 3,
      },
    };
    const v = deriveBackgroundTrackView(snap);
    expect(v.total).toBe(4);
    expect(v.title).toContain('1 в роботі');
    expect(v.title).toContain('3 у черзі');
  });

  it('shows muted color when only queued and no active', () => {
    const snap: AgentStatusSnapshot = {
      ...idleSnap,
      background: {
        active: false, task_id: null, substate: 'idle',
        goal: null, origin: null, queue_size: 2,
      },
    };
    const v = deriveBackgroundTrackView(snap);
    expect(v.visible).toBe(true);
    expect(v.total).toBe(2);
    expect(v.color).toBe('var(--ink-muted)');
    expect(v.title).toContain('2 у черзі');
  });
});
