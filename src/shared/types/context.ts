import { SystemState } from './system';

export interface ContextSnapshot {
  timestamp: number;

  who: {
    user_id: string | null;
    username: string | null;
    confidence: number;
    auth_method: 'rfid' | 'pin' | 'auto' | 'breathing' | null;
    role: 'ROOT' | 'OPERATOR' | 'GUEST' | null;
  };

  where: {
    lat: number | null;
    lon: number | null;
    fix: boolean;
    satellites: number;
    speed_kmh: number;
    place_known: boolean;
    place_name: string | null;
    first_visit: boolean;
    /**
     * Phase 9.4b — provenance of the current position. Emitted by the
     * backend LocalizationResolver. Optional for backward compatibility
     * with older snapshots / test fixtures.
     */
    source?: 'gps_hardware' | 'browser_geolocation' | 'ip_estimate' | 'user_stated' | 'none';
    confidence?: number;
    accuracy_m?: number | null;
  };

  when: {
    time: string;
    hour: number;
    day_of_week: string;
    date: string;
    work_hours: boolean;
    is_night: boolean;
  };

  body: {
    breathing_bpm: number | null;
    breathing_state: 'sleep' | 'calm' | 'normal' | 'elevated' | 'stressed' | null;
    stress_level: number | null;
    motion_energy: number | null;
    static_energy: number | null;
    user_distance_cm: number | null;
  };

  env: {
    temp_c: number | null;
    pressure_hpa: number | null;
    aqi: number | null;
  };

  presence: {
    user_detected: boolean;
    user_distance_cm: number | null;
    other_detected: boolean;
    other_distance_cm: number | null;
  };

  history: {
    last_interaction_ago_s: number;
    last_state_change_ago_s: number;
    mood_trend: 'improving' | 'stable' | 'declining';
    active_timers: number;
    pending_events_1h: number;
  };

  memory_hints: string[];

  system: {
    state: SystemState;
    uptime_s: number;
    cpu_percent: number;
    ram_percent: number;
    disk_percent: number;
    wifi_connected: boolean;
    internet_available: boolean;
    ai_provider: 'gemini' | 'ollama';
    stt_engine: 'whisper' | 'vosk';
  };
}
