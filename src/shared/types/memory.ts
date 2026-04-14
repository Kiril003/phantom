import { SystemState } from './system';

export interface MemoryFact {
  id: string;
  user_id: string;
  layer: 'session' | 'tactical' | 'strategic' | 'archive';
  category:
    | 'fact'
    | 'preference'
    | 'event'
    | 'pattern'
    | 'decision'
    | 'emotion'
    | 'thought_stream';
  content: string;
  importance: number;
  embedding_id: string | null;
  source_session_id: string;
  created_at: string;
  accessed_at: string;
  access_count: number;
  is_sealed: boolean;
  decay_factor: number;
}

export interface TemporalAnchor {
  id: string;
  user_id: string;
  timestamp: string;
  lat: number | null;
  lon: number | null;
  place_name: string | null;
  activity_summary: string;
  state: SystemState;
  mood: string;
}
