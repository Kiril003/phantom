import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useSystemStore } from '../stores/systemStore';
import { SystemState } from '@shared/types';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
      aside: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <aside {...props}>{children}</aside>,
    },
  };
});

// Stub maplibre-gl — FocusLayout renders TacticalMap which instantiates it
vi.mock('maplibre-gl', () => {
  class FakeMap {
    on(evt: string, cb: () => void) {
      if (evt === 'load') setTimeout(cb, 0);
      return this;
    }
    off() {
      return this;
    }
    remove() {
      /* noop */
    }
    getBounds() {
      return {
        getSouth: () => 0,
        getWest: () => 0,
        getNorth: () => 1,
        getEast: () => 1,
      };
    }
    getCenter() {
      return { lat: 50.45, lng: 30.52 };
    }
    getZoom() {
      return 15;
    }
    setStyle() {
      /* noop */
    }
    flyTo() {
      /* noop */
    }
    fitBounds() {
      /* noop */
    }
    getSource() {
      return undefined;
    }
    addSource() {
      /* noop */
    }
    addLayer() {
      /* noop */
    }
    removeLayer() {
      /* noop */
    }
    removeSource() {
      /* noop */
    }
    getLayer() {
      return undefined;
    }
  }
  class FakeMarker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    setPopup() {
      return this;
    }
    remove() {
      /* noop */
    }
  }
  class FakePopup {
    setHTML() {
      return this;
    }
  }
  class FakeLngLatBounds {
    extend() {
      /* noop */
    }
  }
  return {
    default: { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, LngLatBounds: FakeLngLatBounds },
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    LngLatBounds: FakeLngLatBounds,
  };
});

function createMockContext(state: SystemState) {
  return {
    timestamp: Date.now(),
    who: { user_id: 'u1', username: 'test_user', confidence: 1, auth_method: 'pin' as const, role: 'ROOT' as const },
    where: { lat: 50.45, lon: 30.52, fix: true, satellites: 8, speed_kmh: 0, place_known: true, place_name: 'Home', first_visit: false },
    when: { time: '14:30', hour: 14, day_of_week: 'mon', date: '2026-04-16', work_hours: true, is_night: false },
    body: { breathing_bpm: 16, breathing_state: 'calm' as const, stress_level: 0.2, motion_energy: 30, static_energy: 50, user_distance_cm: 80 },
    env: { temp_c: 22.5, pressure_hpa: 1013, aqi: 42 },
    presence: { user_detected: true, user_distance_cm: 80, other_detected: false, other_distance_cm: null },
    history: { last_interaction_ago_s: 10, last_state_change_ago_s: 300, mood_trend: 'stable' as const, active_timers: 0, pending_events_1h: 0 },
    memory_hints: [],
    system: { state, uptime_s: 3600, cpu_percent: 25, ram_percent: 45, disk_percent: 60, wifi_connected: true, internet_available: true, ai_provider: 'gemini' as const, stt_engine: 'whisper' as const },
  };
}

function withRouter(ui: React.ReactElement) {
  return <BrowserRouter>{ui}</BrowserRouter>;
}

describe('ShadowLayout', () => {
  beforeEach(() => {
    useSystemStore.setState({
      state: SystemState.SHADOW,
      previousState: null,
      context: createMockContext(SystemState.SHADOW),
      authenticated: true,
      wsConnected: true,
      stateHistory: [],
    });
  });

  it('renders with time display', async () => {
    const ShadowLayout = (await import('../layouts/ShadowLayout')).default;
    render(withRouter(<ShadowLayout />));
    expect(screen.getByText('14:30')).toBeDefined();
  });

  it('renders temperature', async () => {
    const ShadowLayout = (await import('../layouts/ShadowLayout')).default;
    render(withRouter(<ShadowLayout />));
    expect(screen.getAllByText(/22\.5/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('FocusLayout', () => {
  beforeEach(() => {
    useSystemStore.setState({
      state: SystemState.FOCUS,
      previousState: SystemState.SHADOW,
      context: createMockContext(SystemState.FOCUS),
      authenticated: true,
      wsConnected: true,
      stateHistory: [],
    });
  });

  it('renders sidebar context cards', async () => {
    const FocusLayout = (await import('../layouts/FocusLayout')).default;
    render(withRouter(<FocusLayout />));
    expect(screen.getAllByText('16 bpm').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/22\.5/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders FOCUS MODE label', async () => {
    const FocusLayout = (await import('../layouts/FocusLayout')).default;
    render(withRouter(<FocusLayout />));
    expect(screen.getByText('FOCUS MODE')).toBeDefined();
  });

  it('renders resource bars', async () => {
    const FocusLayout = (await import('../layouts/FocusLayout')).default;
    render(withRouter(<FocusLayout />));
    expect(screen.getByText('CPU')).toBeDefined();
    expect(screen.getByText('RAM')).toBeDefined();
    expect(screen.getByText('Disk')).toBeDefined();
  });
});

describe('GhostLayout', () => {
  beforeEach(() => {
    useSystemStore.setState({
      state: SystemState.GHOST,
      previousState: SystemState.SHADOW,
      context: createMockContext(SystemState.GHOST),
      authenticated: true,
      wsConnected: true,
      stateHistory: [],
    });
  });

  it('renders without StatusBar', async () => {
    const GhostLayout = (await import('../layouts/GhostLayout')).default;
    render(withRouter(<GhostLayout />));
    expect(screen.queryByText('GHOST')).toBeNull();
  });

  it('renders uptime counter', async () => {
    const GhostLayout = (await import('../layouts/GhostLayout')).default;
    render(withRouter(<GhostLayout />));
    expect(screen.getByText('01:00:00')).toBeDefined();
  });
});

describe('DreamLayout', () => {
  beforeEach(() => {
    useSystemStore.setState({
      state: SystemState.DREAM,
      previousState: SystemState.SHADOW,
      context: createMockContext(SystemState.DREAM),
      authenticated: true,
      wsConnected: true,
      stateHistory: [],
    });
  });

  it('renders time display', async () => {
    const DreamLayout = (await import('../layouts/DreamLayout')).default;
    render(withRouter(<DreamLayout />));
    expect(screen.getByText('14:30')).toBeDefined();
  });

  it('renders breathing BPM', async () => {
    const DreamLayout = (await import('../layouts/DreamLayout')).default;
    render(withRouter(<DreamLayout />));
    expect(screen.getByText(/16 bpm/)).toBeDefined();
  });
});

describe('SentinelLayout', () => {
  beforeEach(() => {
    useSystemStore.setState({
      state: SystemState.SENTINEL,
      previousState: SystemState.SHADOW,
      context: {
        ...createMockContext(SystemState.SENTINEL),
        presence: {
          user_detected: true,
          user_distance_cm: 80,
          other_detected: true,
          other_distance_cm: 200,
        },
        where: {
          lat: 50.45,
          lon: 30.52,
          fix: true,
          satellites: 8,
          speed_kmh: 0,
          place_known: false,
          place_name: null,
          first_visit: true,
        },
        when: {
          time: '02:30',
          hour: 2,
          day_of_week: 'wed',
          date: '2026-04-16',
          work_hours: false,
          is_night: true,
        },
      },
      authenticated: true,
      wsConnected: true,
      stateHistory: [],
    });
  });

  it('renders THREAT DETECTED header', async () => {
    const SentinelLayout = (await import('../layouts/SentinelLayout')).default;
    render(withRouter(<SentinelLayout />));
    expect(screen.getByText('THREAT DETECTED')).toBeDefined();
  });

  it('shows other presence distance', async () => {
    const SentinelLayout = (await import('../layouts/SentinelLayout')).default;
    render(withRouter(<SentinelLayout />));
    expect(screen.getByText('200 cm')).toBeDefined();
  });

  it('shows first visit warning', async () => {
    const SentinelLayout = (await import('../layouts/SentinelLayout')).default;
    render(withRouter(<SentinelLayout />));
    expect(screen.getByText('First visit to this location')).toBeDefined();
  });

  it('shows night time warning', async () => {
    const SentinelLayout = (await import('../layouts/SentinelLayout')).default;
    render(withRouter(<SentinelLayout />));
    expect(screen.getByText('Night time')).toBeDefined();
  });
});

describe('StatusBar visibility', () => {
  it('StatusBar hidden in GHOST mode', async () => {
    useSystemStore.setState({
      state: SystemState.GHOST,
      context: createMockContext(SystemState.GHOST),
      authenticated: true,
      wsConnected: true,
      previousState: null,
      stateHistory: [],
    });

    const { StatusBar } = await import('../components/core/StatusBar');
    const { container } = render(withRouter(<StatusBar />));
    expect(container.innerHTML).toBe('');
  });

  it('StatusBar hidden in DREAM mode', async () => {
    useSystemStore.setState({
      state: SystemState.DREAM,
      context: createMockContext(SystemState.DREAM),
      authenticated: true,
      wsConnected: true,
      previousState: null,
      stateHistory: [],
    });

    const { StatusBar } = await import('../components/core/StatusBar');
    const { container } = render(withRouter(<StatusBar />));
    expect(container.innerHTML).toBe('');
  });

  it('StatusBar visible in FOCUS mode', async () => {
    useSystemStore.setState({
      state: SystemState.FOCUS,
      context: createMockContext(SystemState.FOCUS),
      authenticated: true,
      wsConnected: true,
      previousState: null,
      stateHistory: [],
    });

    const { StatusBar } = await import('../components/core/StatusBar');
    const { container } = render(withRouter(<StatusBar />));
    expect(container.innerHTML).not.toBe('');
  });
});
