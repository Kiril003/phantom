import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSystemStore } from '../stores/systemStore';
import { FAMILIAR_STATE_BEHAVIOR, SystemState } from '@shared/types';

describe('State transition sequences', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ));
    useSystemStore.setState({
      state: SystemState.SHADOW,
      previousState: null,
      stateHistory: [],
      context: null,
      authenticated: false,
      wsConnected: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('SHADOW → FOCUS → DIALOGUE → FOCUS → SHADOW', () => {
    const store = useSystemStore.getState;
    const set = useSystemStore.getState().setState;

    set(SystemState.FOCUS, { trigger: 'work_context_active', timestamp: 1000, auto: true });
    expect(store().state).toBe(SystemState.FOCUS);
    expect(store().previousState).toBe(SystemState.SHADOW);

    set(SystemState.DIALOGUE, { trigger: 'voice_input', timestamp: 2000, auto: false });
    expect(store().state).toBe(SystemState.DIALOGUE);
    expect(store().previousState).toBe(SystemState.FOCUS);

    set(SystemState.FOCUS, { trigger: 'conversation_ended_return_focus', timestamp: 3000, auto: true });
    expect(store().state).toBe(SystemState.FOCUS);

    set(SystemState.SHADOW, { trigger: 'no_interaction_timeout', timestamp: 4000, auto: true });
    expect(store().state).toBe(SystemState.SHADOW);

    expect(store().stateHistory).toHaveLength(4);
  });

  it('SHADOW → SENTINEL → SHADOW (threat cycle)', () => {
    const set = useSystemStore.getState().setState;

    set(SystemState.SENTINEL, { trigger: 'threat_detected', timestamp: 1000, auto: true });
    expect(useSystemStore.getState().state).toBe(SystemState.SENTINEL);

    set(SystemState.SHADOW, { trigger: 'threat_resolved', timestamp: 6000, auto: true });
    expect(useSystemStore.getState().state).toBe(SystemState.SHADOW);
  });

  it('ANY → GHOST toggle (priority 0)', () => {
    const set = useSystemStore.getState().setState;

    set(SystemState.FOCUS, { trigger: 'work_context_active', timestamp: 1000, auto: true });
    set(SystemState.GHOST, { trigger: 'ghost_toggle', timestamp: 2000, auto: false });
    expect(useSystemStore.getState().state).toBe(SystemState.GHOST);

    set(SystemState.SHADOW, { trigger: 'ghost_toggle', timestamp: 3000, auto: false });
    expect(useSystemStore.getState().state).toBe(SystemState.SHADOW);
  });

  it('SHADOW → DREAM → SHADOW (night cycle)', () => {
    const set = useSystemStore.getState().setState;

    set(SystemState.DREAM, { trigger: 'breathing_sleep_night', timestamp: 1000, auto: true });
    expect(useSystemStore.getState().state).toBe(SystemState.DREAM);

    set(SystemState.SHADOW, { trigger: 'woke_up', timestamp: 20000, auto: true });
    expect(useSystemStore.getState().state).toBe(SystemState.SHADOW);
  });

  it('transition records correct trigger', () => {
    useSystemStore.getState().setState(SystemState.SENTINEL, {
      trigger: 'other_detected_first_visit',
      timestamp: 5000,
      auto: true,
    });

    const history = useSystemStore.getState().stateHistory;
    expect(history[0].trigger).toBe('other_detected_first_visit');
    expect(history[0].auto).toBe(true);
    expect(history[0].timestamp).toBe(5000);
  });

  it('manual vs auto transitions tracked', () => {
    const set = useSystemStore.getState().setState;

    set(SystemState.DIALOGUE, { trigger: 'user_touch', timestamp: 1000, auto: false });
    set(SystemState.SHADOW, { trigger: 'timeout', timestamp: 2000, auto: true });

    const history = useSystemStore.getState().stateHistory;
    expect(history[0].auto).toBe(false);
    expect(history[1].auto).toBe(true);
  });
});

describe('SystemState enum completeness', () => {
  it('has exactly 7 states', () => {
    const states = Object.values(SystemState);
    expect(states).toHaveLength(7);
  });

  it('contains all required states', () => {
    expect(SystemState.SHADOW).toBe('SHADOW');
    expect(SystemState.FOCUS).toBe('FOCUS');
    expect(SystemState.DIALOGUE).toBe('DIALOGUE');
    expect(SystemState.SENTINEL).toBe('SENTINEL');
    expect(SystemState.GHOST).toBe('GHOST');
    expect(SystemState.DREAM).toBe('DREAM');
    expect(SystemState.OPERATOR).toBe('OPERATOR');
  });
});

describe('Familiar state language', () => {
  it('maps every system state to a Familiar pose and emotion', () => {
    for (const state of Object.values(SystemState)) {
      const behavior = FAMILIAR_STATE_BEHAVIOR[state];
      expect(behavior).toBeDefined();
      expect(behavior.pose).toBeTruthy();
      expect(behavior.emotion).toBeTruthy();
      expect(behavior.message.length).toBeGreaterThan(3);
    }
  });

  it('uses meaningful poses for core Sunrise states', () => {
    expect(FAMILIAR_STATE_BEHAVIOR[SystemState.SHADOW].pose).toBe('peeking');
    expect(FAMILIAR_STATE_BEHAVIOR[SystemState.FOCUS].pose).toBe('idle');
    expect(FAMILIAR_STATE_BEHAVIOR[SystemState.DIALOGUE].pose).toBe('waving');
    expect(FAMILIAR_STATE_BEHAVIOR[SystemState.SENTINEL].pose).toBe('pointing');
    expect(FAMILIAR_STATE_BEHAVIOR[SystemState.GHOST].pose).toBe('vanishing');
    expect(FAMILIAR_STATE_BEHAVIOR[SystemState.DREAM].pose).toBe('sleeping');
  });
});
