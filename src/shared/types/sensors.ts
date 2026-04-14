export interface SensorBatch {
  v: number;
  ts: number;
  type: 'sensor_batch';

  radar: {
    present: boolean;
    motion_energy: number;
    static_energy: number;
    distance_cm: number;
    breath_bpm: number | null;
  } | null;

  gps: {
    lat: number;
    lon: number;
    fix: boolean;
    satellites: number;
    speed_kmh: number;
    altitude_m: number;
    hdop: number;
  } | null;

  env: {
    temp_c: number;
    pressure_hpa: number;
    aqi: number;
  } | null;

  rfid: {
    uid: string | null;
    new_read: boolean;
  } | null;

  encoder: {
    position: number;
    delta: number;
    button: boolean;
    long_press: boolean;
  } | null;

  buttons: {
    rgb_states: [boolean, boolean, boolean];
    any_pressed: boolean;
  } | null;

  wifi_nets: Array<{
    mac: string;
    ssid: string;
    rssi: number;
    encryption: number;
    channel: number;
  }> | null;
}

export interface SensorError {
  v: number;
  ts: number;
  type: 'error';
  sensor: string;
  msg: string;
  code: number;
}

export interface SensorHeartbeat {
  v: number;
  ts: number;
  type: 'heartbeat';
  uptime_ms: number;
  free_heap: number;
  wifi_rssi: number;
}

export type ESP32Message = SensorBatch | SensorError | SensorHeartbeat;
