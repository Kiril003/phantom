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

const DEFAULT_FONT_SIZE = 14; // matches config.ui_font_size default

export async function bootstrapSettings(): Promise<void> {
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
