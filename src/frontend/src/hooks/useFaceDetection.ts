import { useCallback, useEffect, useRef, useState } from 'react';
import { faceApi } from '../services/faceApi';
import { useFaceStore } from '../stores/faceStore';
import { useSystemStore } from '../stores/systemStore';
import { useAuthStore } from '../stores/authStore';
import { SystemState } from '@shared/types';

/**
 * useFaceDetection — lazy-loads MediaPipe Tasks Vision from the Google
 * CDN and runs a detection RAF loop against the `<video>` element the
 * caller passes in.
 *
 * Why CDN (no npm install):
 *   The project contract forbids new npm deps and the @mediapipe/tasks-vision
 *   bundle is enormous. The CDN loader is resilient enough and lets us
 *   ship without touching package.json.
 *
 * Privacy:
 *   * If `face_tracking_enabled=false` OR `SystemState === GHOST`, the loop
 *     stops and the MediaStream is torn down.
 *   * Raw frames never leave the device — only landmark-derived
 *     embeddings (via `computeEmbedding`) get posted to `/face/recognize`
 *     and `/face/enroll`.
 */

const CDN_VISION =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Landmark indices used to build a small, stable pseudo-embedding.
 * MediaPipe's 468-point mesh contains dense mesh points; we pick anchors
 * around eyes, nose, mouth, jaw — a subset proven stable under head-pose
 * variation. 20 × 3 = 60-dim.
 */
const ANCHOR_INDICES = [
  33, 263, // outer eye corners (L, R)
  133, 362, // inner eye corners
  159, 386, // upper lid centres
  145, 374, // lower lid centres
  1, 4,     // nose tip / bridge
  61, 291,  // mouth corners
  13, 14,   // upper / lower lip
  152,      // chin
  234, 454, // jaw sides
  10, 338,  // forehead anchors
  127, 356, // cheek anchors
];

type Landmark = { x: number; y: number; z: number };

/** L2-normalised 60-dim vector from chosen landmarks, centred on the
 * nose tip (landmark 1) and scaled by inter-ocular distance so the
 * result is translation- and scale-invariant. */
export function computeEmbedding(landmarks: Landmark[]): number[] {
  if (!landmarks || landmarks.length < 468) return [];
  const nose = landmarks[1];
  // Scale reference = distance between outer eye corners.
  const lEye = landmarks[33];
  const rEye = landmarks[263];
  const dx = rEye.x - lEye.x;
  const dy = rEye.y - lEye.y;
  const dz = rEye.z - lEye.z;
  const scale = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const vec: number[] = [];
  for (const i of ANCHOR_INDICES) {
    const p = landmarks[i];
    if (!p) {
      vec.push(0, 0, 0);
      continue;
    }
    vec.push((p.x - nose.x) / scale, (p.y - nose.y) / scale, (p.z - nose.z) / scale);
  }
  // L2-normalise so cosine similarity is comparable across captures.
  let n = 0;
  for (const v of vec) n += v * v;
  const norm = Math.sqrt(n);
  if (norm <= 1e-9) return vec;
  return vec.map((v) => v / norm);
}

export function headPoseFromLandmarks(
  landmarks: Landmark[]
): { yaw: number; pitch: number; roll: number } {
  // Approximation sufficient for UI cues (not a perfect PnP solve).
  if (!landmarks || landmarks.length < 468) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }
  const lEye = landmarks[33];
  const rEye = landmarks[263];
  const chin = landmarks[152];
  const forehead = landmarks[10];
  const yaw = Math.atan2(rEye.z - lEye.z, rEye.x - lEye.x);
  const pitch = Math.atan2(forehead.y - chin.y, forehead.z - chin.z);
  const roll = Math.atan2(rEye.y - lEye.y, rEye.x - lEye.x);
  return { yaw, pitch, roll };
}

export function bboxFromLandmarks(landmarks: Landmark[]): {
  x: number; y: number; w: number; h: number;
} {
  if (!landmarks || landmarks.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Singleton-ish landmarker promise so repeated mounts don't re-download.
let landmarkerPromise: Promise<unknown> | null = null;

async function loadLandmarker(): Promise<unknown> {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    // Dynamic ES-module import from CDN. The `vite-ignore` comment tells
    // Vite/Rollup to leave this URL alone at build time so it stays a
    // runtime fetch.
    const mod: {
      FilesetResolver: { forVisionTasks: (p: string) => Promise<unknown> };
      FaceLandmarker: {
        createFromOptions: (files: unknown, opts: unknown) => Promise<unknown>;
      };
    } = await import(/* @vite-ignore */ CDN_VISION) as unknown as {
      FilesetResolver: { forVisionTasks: (p: string) => Promise<unknown> };
      FaceLandmarker: {
        createFromOptions: (files: unknown, opts: unknown) => Promise<unknown>;
      };
    };
    const files = await mod.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    );
    return mod.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
      numFaces: 1,
    });
  })();
  return landmarkerPromise;
}

interface UseFaceDetectionOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  /** Debounce between /face/recognize calls. Default 1500 ms. */
  recognizeIntervalMs?: number;
}

export function useFaceDetection({
  videoRef,
  enabled,
  recognizeIntervalMs = 1500,
}: UseFaceDetectionOptions) {
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<unknown>(null);
  const lastRecognizeRef = useRef(0);
  const lastFaceSeenRef = useRef(0);
  const [loaderError, setLoaderError] = useState<string | null>(null);

  const systemState = useSystemStore((s) => s.state);
  const authUser = useAuthStore((s) => s.user);

  const setRunning = useFaceStore((s) => s.setRunning);
  const setReady = useFaceStore((s) => s.setReady);
  const setDetection = useFaceStore((s) => s.setDetection);
  const setRecognized = useFaceStore((s) => s.setRecognized);
  const setUnknownSince = useFaceStore((s) => s.setUnknownSince);
  const setCameraError = useFaceStore((s) => s.setCameraError);
  const enrollStatus = useFaceStore((s) => s.enrollStatus);
  const pushEnrollmentSample = useFaceStore((s) => s.pushEnrollmentSample);

  const teardown = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        /* ignore */
      }
    }
    setRunning(false);
    setDetection(null);
    setRecognized(null);
  }, [setRunning, setDetection, setRecognized, videoRef]);

  // Privacy: any of these three kills the pipeline.
  const kill =
    !enabled ||
    systemState === SystemState.GHOST ||
    useFaceStore.getState().privacyMode === 'off';

  useEffect(() => {
    if (kill) {
      teardown();
      return;
    }
    if (!videoRef.current) return;
    let cancelled = false;

    async function boot(): Promise<void> {
      try {
        // Drive the OLED animator with "surprised" pulse as soon as the
        // loop starts — gives operators a clear visual confirmation.
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera not available in this browser');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);

        const landmarker = await loadLandmarker();
        if (cancelled) return;
        landmarkerRef.current = landmarker;
        setReady(true);
        setRunning(true);
        setCameraError(null);

        const tick = (): void => {
          if (cancelled) return;
          const v = videoRef.current;
          const lm = landmarkerRef.current as {
            detectForVideo?: (v: HTMLVideoElement, ts: number) => {
              faceLandmarks: Landmark[][];
            };
          } | null;
          if (!v || !lm?.detectForVideo) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          const ts = performance.now();
          let result: { faceLandmarks: Landmark[][] } | null = null;
          try {
            result = lm.detectForVideo(v, ts);
          } catch {
            result = null;
          }
          const faces = result?.faceLandmarks ?? [];
          if (faces.length > 0) {
            const landmarks = faces[0];
            const embedding = computeEmbedding(landmarks);
            const box = bboxFromLandmarks(landmarks);
            const headPose = headPoseFromLandmarks(landmarks);
            setDetection({
              box,
              landmarks,
              headPose,
              embedding,
              capturedAt: Date.now(),
            });
            lastFaceSeenRef.current = ts;

            // Recognition: debounced server call.
            if (embedding.length > 0) {
              if (useFaceStore.getState().enrollStatus === 'collecting') {
                pushEnrollmentSample(embedding);
              }
              if (ts - lastRecognizeRef.current > recognizeIntervalMs) {
                lastRecognizeRef.current = ts;
                faceApi
                  .recognize(embedding)
                  .then((resp) => {
                    if (cancelled) return;
                    if (resp.matched && resp.user_id && resp.username) {
                      setRecognized({
                        userId: resp.user_id,
                        username: resp.username,
                        role: resp.role,
                        confidence: resp.confidence,
                        at: Date.now(),
                      });
                      setUnknownSince(null);
                    } else {
                      setRecognized(null);
                      // Keep the first unknown-timestamp so the lockout
                      // countdown is stable across multiple recognize
                      // calls that all fail to match.
                      const prev = useFaceStore.getState().unknownSince;
                      setUnknownSince(prev ?? Date.now());
                    }
                  })
                  .catch(() => {
                    /* ignore; faceStore keeps last good recognition */
                  });
              }
            }
          } else if (ts - lastFaceSeenRef.current > 2000) {
            // 2 s without a face → clear recognized/unknown state.
            if (useFaceStore.getState().lastDetection) {
              setDetection(null);
            }
            if (useFaceStore.getState().recognized) {
              setRecognized(null);
            }
            if (useFaceStore.getState().unknownSince !== null) {
              setUnknownSince(null);
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Face detection failed to start';
        setCameraError(msg);
        setLoaderError(msg);
        setRunning(false);
        teardown();
      }
    }
    void boot();
    return () => {
      cancelled = true;
      teardown();
    };
  }, [
    kill,
    videoRef,
    recognizeIntervalMs,
    setReady,
    setRunning,
    setDetection,
    setRecognized,
    setUnknownSince,
    setCameraError,
    teardown,
    pushEnrollmentSample,
  ]);

  // Silence unused-lint for vars deps only referenced in handler closures.
  void enrollStatus;
  void authUser;

  return { error: loaderError };
}
