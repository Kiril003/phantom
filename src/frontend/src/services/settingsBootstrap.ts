/**
 * Settings bootstrap — pulls persisted config at app mount and translates
 * every UI-affecting field into a DOM attribute / CSS variable so the
 * design tokens pick it up before the first paint.
 *
 * Called once from providers.tsx. Also exposed as `applyUISettings` so the
 * Settings screen can re-apply after a save without a reload.
 */
import { settingsApi } from './api';
import { useSettingsStore } from '../stores/settingsStore';
import { useFaceStore } from '../stores/faceStore';

const DEFAULT_FONT_SIZE = 14; // matches config.ui_font_size default

let inFlight: Promise<void> | null = null;
let lastBootstrapAt = 0;
// Dedupe window for rapid-fire calls (React StrictMode double-effect,
// providers + post-login retrigger landing in the same tick, etc).
const DEDUPE_WINDOW_MS = 1000;

export async function bootstrapSettings(): Promise<void> {
  // Audit D-H6 — don't fire `/settings` before auth. The endpoint requires
  // a session, so a pre-login mount used to produce four chained 401s in
  // the console (StrictMode + providers + autoLogin retries). After
  // successful auth, `authStore.setUser` / `authStore.autoLogin` call
  // this again, so the gate is "skip if no token *yet*", not "skip
  // forever".
  if (typeof localStorage !== 'undefined' && !localStorage.getItem('phantom_token')) {
    return;
  }
  if (inFlight) return inFlight;
  if (Date.now() - lastBootstrapAt < DEDUPE_WINDOW_MS) return;
  inFlight = (async () => {
    try {
      await _runBootstrap();
    } finally {
      lastBootstrapAt = Date.now();
      inFlight = null;
    }
  })();
  return inFlight;
}

async function _runBootstrap(): Promise<void> {
  const data = await settingsApi.getAll();
  const values: Record<string, unknown> = {};
  for (const cat of data.categories) {
    for (const def of cat.settings) {
      values[def.key] = def.value;
    }
  }
  applyUISettings(values);
  // Seed the store so other components (MapLayout → initialZoom, etc.)
  // can read fresh values without another round-trip.
  useSettingsStore.getState().setCategories(data.categories);

  // Mirror Phase-08 face/privacy values into the faceStore so the detector
  // hook can gate without reading the settings category tree.
  const faceEnabled = values.face_tracking_enabled;
  if (typeof faceEnabled === 'boolean') {
    useFaceStore.getState().setEnabled(faceEnabled);
  }
  const privacy = values.face_tracking_privacy_mode;
  if (privacy === 'off' || privacy === 'landmarks' || privacy === 'full') {
    useFaceStore.getState().setPrivacyMode(privacy);
  }
  const threshold = values.face_recognition_threshold;
  if (typeof threshold === 'number' && Number.isFinite(threshold)) {
    useFaceStore.getState().setThreshold(threshold);
  }
}

export function applyUISettings(values: Record<string, unknown>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const theme = values.ui_theme;
  if (typeof theme === 'string' && theme) {
    root.setAttribute('data-theme', theme);
  }

  const density = values.ui_density;
  if (typeof density === 'string' && density) {
    root.setAttribute('data-density', density);
  }

  // Day-4 W-5 (audit U2-ANIM-C2 + U8-PERF) — hardware tier gate. CSS
  // matches `[data-tier="low"] .glass-panel { backdrop-filter: none }`
  // etc. so weaker GPUs (Adreno on cheap Win mini-PCs, integrated
  // Intel) don't burn frame budget on stacked filters. Closed enum
  // (low | mid | high); defaults to mid when unset/garbage so a
  // missing config never strips chrome.
  const tier = values.ui_hardware_tier;
  if (tier === 'low' || tier === 'mid' || tier === 'high') {
    root.setAttribute('data-tier', tier);
  } else {
    root.setAttribute('data-tier', 'mid');
  }

  const speed = values.ui_animation_speed;
  if (typeof speed === 'number' && Number.isFinite(speed) && speed > 0) {
    root.style.setProperty('--motion-scale-user', String(speed));
  }

  const fontSize = values.ui_font_size;
  if (typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0) {
    root.style.setProperty('--fs-scale', String(fontSize / DEFAULT_FONT_SIZE));
  }

  // Accent overrides — default preserved as hex fallback inside tokens.css so
  // an empty / unset value reverts the state palette to its designed tone.
  setColorOverride(root, '--accent-override-focus', values.ui_color_cyan);
  setColorOverride(root, '--accent-override-dream', values.ui_color_warning);
  setColorOverride(root, '--accent-override-ghost', values.ui_color_success);
  setColorOverride(root, '--accent-override-sentinel', values.ui_color_danger);
  setColorOverride(root, '--accent-override-dream-tint', values.ui_color_dream);
}

function setColorOverride(root: HTMLElement, cssVar: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    root.style.setProperty(cssVar, value.trim());
  } else {
    root.style.removeProperty(cssVar);
  }
}
