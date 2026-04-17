import { create } from 'zustand';

export interface OledEyeShape {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity: number;
}

export interface OledFrame {
  eye_state: string;
  eye_l: OledEyeShape;
  eye_r: OledEyeShape;
  brightness: number;
  ts_ms: number;
  system_state: string;
  mood: string;
}

interface OledState {
  frame: OledFrame | null;
  setFrame: (f: OledFrame) => void;
}

export const useOledStore = create<OledState>((set) => ({
  frame: null,
  setFrame: (f) => set({ frame: f }),
}));
