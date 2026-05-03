import { UserRole } from './user';

export interface SettingsCategory {
  id: string;
  label: string;
  icon: string;
  settings: SettingDefinition[];
}

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'range' | 'color' | 'text' | 'password';
  default: unknown;
  value: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  requires_restart: boolean;
  category: string;
  visible_to: UserRole[];
  /**
   * Phase 22 — Basic / Advanced split. The settings panel hides
   * `advanced` entries by default; the operator flips the
   * "Показати розширені" toggle in the sticky category header to
   * reveal expert tuning. Defaults to 'basic' on legacy responses.
   */
  tier?: 'basic' | 'advanced';
  /** Owning subsystem hasn't shipped — render a "скоро" badge. */
  unimplemented?: boolean;
  /** Backend hint that the FE has a custom auto-detect editor. */
  auto_detect?: boolean;
  /** Explicit editor component name to dispatch (e.g. `OllamaModelEditor`). */
  editor?: string | null;
}

/* phase-5-R0-3-THEME-NIGHT — Theme picker contract.
 *
 * Three named themes ship with the sunrise redesign and the operator
 * flips between them from Settings › Theme. The active id is mirrored
 * onto `<html data-theme="…">` so every component-level CSS variable
 * (defined in `tokens.css`) follows without a single call-site change.
 *
 * `"auto"` is reserved for the bootstrap fallback only — it never
 * lands in storage; the bootstrap resolves it to `sunrise-warm` during
 * the day (06:00–21:00) or `amber-night` otherwise based on the local
 * clock + `prefers-color-scheme`. Once the operator picks a theme
 * explicitly the explicit choice always wins.
 */
export type ThemeId = 'sunrise-warm' | 'amber-night' | 'cyberdeck-cold';

export interface ThemeSettings {
  active: ThemeId;
}

export const THEME_IDS: ReadonlyArray<ThemeId> = [
  'sunrise-warm',
  'amber-night',
  'cyberdeck-cold',
];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    value === 'sunrise-warm' ||
    value === 'amber-night' ||
    value === 'cyberdeck-cold'
  );
}
