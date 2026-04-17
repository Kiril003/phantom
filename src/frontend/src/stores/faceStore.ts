import { create } from 'zustand';

/**
 * faceStore — browser-side face detection state.
 *
 * Populated by useFaceDetection (MediaPipe loop) and consumed by
 * CameraOverlay, StatusBar's face chip, and the OLED eye renderer.
 *
 * Embeddings live here only transiently during enrollment — nothing is
 * persisted in localStorage. The backend owns the template.
 */

export interface FaceBox {
  x: number;     // 0..1 (normalised to video width)
  y: number;
  w: number;
  h: number;
}

export interface FaceDetection {
  box: FaceBox;
  landmarks: { x: number; y: number; z: number }[];
  headPose: { yaw: number; pitch: number; roll: number };
  /** Derived pseudo-embedding (L2-normalised, fixed dim) for recognition. */
  embedding: number[];
  capturedAt: number; // Date.now()
}

export interface RecognizedUser {
  userId: string;
  username: string;
  role: string | null;
  confidence: number;
  at: number;
}

type EnrollStatus = 'idle' | 'collecting' | 'sending' | 'done' | 'error';

interface FaceState {
  enabled: boolean;
  /** Is the detector loop currently running? */
  running: boolean;
  /** Model asset loaded & ready to detect. */
  ready: boolean;
  /** Last detection (cleared after 2s of no face). */
  lastDetection: FaceDetection | null;
  /** Actively recognized user (cleared after face disappears). */
  recognized: RecognizedUser | null;
  /** When a face appears that DOESN'T match any profile. */
  unknownSince: number | null;
  /** Buffer being filled by enrollment capture. */
  enrollSamples: number[][];
  enrollStatus: EnrollStatus;
  enrollError: string | null;
  /** Human-readable error from the detection pipeline (camera permission, etc). */
  cameraError: string | null;
  /** Set from /face/status on boot and whenever settings change. */
  threshold: number;
  privacyMode: 'off' | 'landmarks' | 'full';

  setEnabled: (v: boolean) => void;
  setRunning: (v: boolean) => void;
  setReady: (v: boolean) => void;
  setDetection: (d: FaceDetection | null) => void;
  setRecognized: (r: RecognizedUser | null) => void;
  setUnknownSince: (ts: number | null) => void;
  startEnrollment: () => void;
  pushEnrollmentSample: (emb: number[]) => void;
  setEnrollStatus: (s: EnrollStatus, err?: string | null) => void;
  resetEnrollment: () => void;
  setCameraError: (e: string | null) => void;
  setThreshold: (t: number) => void;
  setPrivacyMode: (m: 'off' | 'landmarks' | 'full') => void;
}

export const useFaceStore = create<FaceState>((set) => ({
  enabled: true,
  running: false,
  ready: false,
  lastDetection: null,
  recognized: null,
  unknownSince: null,
  enrollSamples: [],
  enrollStatus: 'idle',
  enrollError: null,
  cameraError: null,
  threshold: 0.75,
  privacyMode: 'landmarks',

  setEnabled: (v) => set({ enabled: v }),
  setRunning: (v) => set({ running: v }),
  setReady: (v) => set({ ready: v }),
  setDetection: (d) => set({ lastDetection: d }),
  setRecognized: (r) => set({ recognized: r }),
  setUnknownSince: (ts) => set({ unknownSince: ts }),
  startEnrollment: () =>
    set({ enrollSamples: [], enrollStatus: 'collecting', enrollError: null }),
  pushEnrollmentSample: (emb) =>
    set((s) => ({ enrollSamples: [...s.enrollSamples, emb] })),
  setEnrollStatus: (s, err = null) => set({ enrollStatus: s, enrollError: err }),
  resetEnrollment: () =>
    set({ enrollSamples: [], enrollStatus: 'idle', enrollError: null }),
  setCameraError: (e) => set({ cameraError: e }),
  setThreshold: (t) => set({ threshold: t }),
  setPrivacyMode: (m) => set({ privacyMode: m }),
}));
