export type UserRole = 'ROOT' | 'OPERATOR' | 'GUEST';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  rfid_uid_hash: string | null;
  pin_hash: string | null;
  avatar_url: string | null;
  created_at: string;
  last_seen_at: string;
  preferences: UserPreferences;
  behavioral_model: BehavioralModel;
}

export interface UserPreferences {
  language: 'uk' | 'en' | 'ru';
  tts_voice: string;
  tts_speed: number;
  tts_enabled: boolean;
  stt_enabled: boolean;
  wake_word: string;
  theme: 'auto' | 'dark' | 'light';
  ui_density: 'compact' | 'normal' | 'comfortable';
  notification_sound: boolean;
  haptic_feedback: boolean;
  map_default_zoom: number;
  calendar_first_day: 'mon' | 'sun';
  work_hours_start: string;
  work_hours_end: string;
  null_space_trigger: string;
}

export interface BehavioralModel {
  response_preference: string;
  stress_patterns: string;
  vocabulary: string[];
  decision_style: string;
  trust_level: number;
  honest_gap: number;
  preferred_topics: string[];
  avoid_topics: string[];
  interaction_count: number;
  days_active: number;
  breathing_signature: number[] | null;
  language_stats: Record<string, number>;
}
