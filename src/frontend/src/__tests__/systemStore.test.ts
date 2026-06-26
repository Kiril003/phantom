import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

vi.mock('../services/api', () => ({
  contextApi: {
    setState: vi.fn().mockResolvedValue({}),
  },
}));

describe('systemStore', () => {
  beforeEach(() => {
    useSystemStore.setState({
      state: SystemState.SHADOW,
      previousState: null,
      stateHistory: [],
      context: null,
      authenticated: false,
      wsConnected: false,
    });
  });

  it('starts in SHADOW state', () => {
    const { state } = useSystemStore.getState();
    expect(state).toBe(SystemState.SHADOW);
  });

  it('transitions to new state', () => {
    useSystemStore.getState().setState(SystemState.FOCUS, {
      trigger: 'work_context_active',
      timestamp: 1000,
      auto: true,
    });

    const { state, previousState } = useSystemStore.getState();
    expect(state).toBe(SystemState.FOCUS);
    expect(previousState).toBe(SystemState.SHADOW);
  });

  it('records state history', () => {
    useSystemStore.getState().setState(SystemState.FOCUS, { trigger: 'test', timestamp: 1000, auto: true });
    useSystemStore.getState().setState(SystemState.DIALOGUE, { trigger: 'voice_input', timestamp: 2000, auto: false });

    const { stateHistory } = useSystemStore.getState();
    expect(stateHistory).toHaveLength(2);
    expect(stateHistory[0].from).toBe(SystemState.SHADOW);
    expect(stateHistory[0].to).toBe(SystemState.FOCUS);
    expect(stateHistory[1].from).toBe(SystemState.FOCUS);
    expect(stateHistory[1].to).toBe(SystemState.DIALOGUE);
  });

  it('does not transition to same state', () => {
    useSystemStore.getState().setState(SystemState.SHADOW, { trigger: 'test', timestamp: 1000, auto: true });

    const { stateHistory, previousState } = useSystemStore.getState();
    expect(stateHistory).toHaveLength(0);
    expect(previousState).toBeNull();
  });

  it('limits history to 100 entries', () => {
    for (let i = 0; i < 150; i++) {
      const to = i % 2 === 0 ? SystemState.FOCUS : SystemState.SHADOW;
      useSystemStore.getState().setState(to, { trigger: `test_${i}`, timestamp: i * 1000, auto: true });
    }

    const { stateHistory } = useSystemStore.getState();
    expect(stateHistory.length).toBeLessThanOrEqual(100);
  });

  it('sets authenticated state', () => {
    useSystemStore.getState().setAuthenticated(true);
    expect(useSystemStore.getState().authenticated).toBe(true);
  });

  it('sets ws connected state', () => {
    useSystemStore.getState().setWsConnected(true);
    expect(useSystemStore.getState().wsConnected).toBe(true);
  });

  it('sets context snapshot', () => {
    const mockContext = createMockContext(SystemState.FOCUS);
    useSystemStore.getState().setContext(mockContext);

    const { context } = useSystemStore.getState();
    expect(context).not.toBeNull();
    expect(context!.system.state).toBe(SystemState.FOCUS);
    expect(context!.who.username).toBe('test_user');
  });

  it('transitions through all valid states', () => {
    const states = [
      SystemState.FOCUS,
      SystemState.DIALOGUE,
      SystemState.SENTINEL,
      SystemState.GHOST,
      SystemState.DREAM,
      SystemState.SHADOW,
    ];

    for (const s of states) {
      useSystemStore.getState().setState(s, { trigger: 'test', timestamp: Date.now(), auto: true });
      expect(useSystemStore.getState().state).toBe(s);
    }

    expect(useSystemStore.getState().stateHistory).toHaveLength(states.length);
  });
});

function createMockContext(state: SystemState) {
  return {
    timestamp: Date.now(),
    who: {
      user_id: 'u1',
      username: 'test_user',
      confidence: 1,
      auth_method: 'pin' as const,
      role: 'ROOT' as const,
    },
    where: {
      lat: 50.45,
      lon: 30.52,
      fix: true,
      satellites: 8,
      speed_kmh: 0,
      place_known: true,
      place_name: 'Home',
      first_visit: false,
    },
    when: {
      time: '14:30',
      hour: 14,
      day_of_week: 'mon',
      date: '2026-04-16',
      work_hours: true,
      is_night: false,
    },
    body: {
      breathing_bpm: 16,
      breathing_state: 'calm' as const,
      stress_level: 0.2,
      motion_energy: 30,
      static_energy: 50,
      user_distance_cm: 80,
    },
    env: {
      temp_c: 22.5,
      pressure_hpa: 1013,
      aqi: 42,
    },
    presence: {
      user_detected: true,
      user_distance_cm: 80,
      other_detected: false,
      other_distance_cm: null,
    },
    history: {
      last_interaction_ago_s: 10,
      last_state_change_ago_s: 300,
      mood_trend: 'stable' as const,
      active_timers: 0,
      pending_events_1h: 0,
    },
    memory_hints: ['User prefers short answers'],
    system: {
      state,
      uptime_s: 3600,
      cpu_percent: 25,
      ram_percent: 45,
      disk_percent: 60,
      wifi_connected: true,
      internet_available: true,
      ai_provider: 'gemini' as const,
      stt_engine: 'whisper' as const,
    },
  };
}
