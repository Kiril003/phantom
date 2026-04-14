export type ActuatorCommand =
  | { type: 'servo'; pan_delta: number; tilt_delta: number }
  | {
      type: 'haptic';
      pattern: 'single' | 'double' | 'long' | 'sos';
      duration_ms: number;
    }
  | {
      type: 'oled';
      mode: 'clear' | 'text' | 'menu' | 'status' | 'animation';
      lines?: string[];
      menu_idx?: number;
      animation_id?: string;
    }
  | {
      type: 'rgb';
      id: number;
      color: string;
      mode: 'solid' | 'pulse' | 'breathe' | 'off';
      speed_ms?: number;
    }
  | {
      type: 'buzzer';
      freq_hz: number;
      duration_ms: number;
      pattern?: 'single' | 'double' | 'melody';
    }
  | { type: 'config'; key: string; value: string | number };
