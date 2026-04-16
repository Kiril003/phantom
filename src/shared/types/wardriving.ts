export interface WardrivingRecord {
  id: number;
  mac: string;
  ssid: string;
  rssi: number;
  encryption: string;
  channel: number;
  lat: number;
  lon: number;
  first_seen: string;
  last_seen: string;
  seen_count: number;
}

export interface MapPOI {
  id: string;
  user_id: string;
  lat: number;
  lon: number;
  name: string;
  category: 'intel' | 'threat' | 'saved' | 'home' | 'work' | 'custom';
  notes: string;
  icon: string;
  is_secret: boolean;
  created_at: string;
}

export interface HeatmapPoint {
  lat: number;
  lon: number;
  weight: number;
  network_count?: number;
  strongest_rssi?: number;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  ts: string;
  speed: number;
}
