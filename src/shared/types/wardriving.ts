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

/** OSM `natural=cliff|scree|bare_rock` — baked, not live-polled (see cliff_scree.yaml). */
export type CliffScreeKind = 'cliff' | 'scree' | 'bare_rock';

/** Register per `recovered/map-register-schema.md` §1 — always `'measured'` for this
 * layer (the OSM tag is the fact), but the field always travels with the feature. */
export type FeatureRegister = 'measured' | 'derived' | 'guessed' | 'remembered';

export interface CliffScreeFeature {
  type: 'Feature';
  id: string;
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'Polygon'; coordinates: [number, number][][] };
  properties: {
    osm_type: 'node' | 'way';
    osm_id: number;
    kind: CliffScreeKind;
    name: string | null;
    reg: FeatureRegister;
    fresh: string;
  };
}
