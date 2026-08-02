import { useOledStore } from '../../stores/oledStore';
import { useSystemStore } from '../../stores/systemStore';
import { SystemState } from '@shared/types';

/** Стан очей приходить службовим ключем; у підказці має бути слово. */
const EYE_UA: Record<string, string> = {
  idle: 'спокій',
  sleepy: 'дрімота',
  alert: 'насторожені',
  happy: 'радість',
  blink: 'кліпає',
  scan: 'роздивляється',
  focus: 'зосереджені',
  neutral: 'спокій',
};

/**
 * Tiny SVG mirror of the ESP32-side SH1106 OLED animator output.
 * Drives eye_l / eye_r from the `oled` WS channel. Rendered in the
 * StatusBar so operators can see the "face" PHANTOM is currently
 * showing — useful when tuning states or debugging transitions.
 */
export function OledEyePreview() {
  const frame = useOledStore((s) => s.frame);
  const systemState = useSystemStore((s) => s.state);

  // GHOST never shows eyes — privacy + matches the backend animator.
  if (systemState === SystemState.GHOST) return null;

  // Pre-boot fallback: a calm centered pair of dots so the StatusBar
  // slot is never empty on first mount.
  const defaultFrame = {
    eye_state: 'idle',
    eye_l: { cx: 28, cy: 28, rx: 12, ry: 12, opacity: 0.9 },
    eye_r: { cx: 72, cy: 28, rx: 12, ry: 12, opacity: 0.9 },
    brightness: 180,
    ts_ms: 0,
    system_state: 'SHADOW',
    mood: 'idle',
  };
  const f = frame ?? defaultFrame;

  const alpha = Math.max(0, Math.min(255, f.brightness)) / 255;

  return (
    <svg
      width="42"
      height="20"
      viewBox="0 0 100 56"
      aria-label={`Очі на екрані: ${EYE_UA[f.eye_state] ?? f.eye_state}`}
      style={{ display: 'block' }}
    >
      <title>{`Очі на екрані: ${EYE_UA[f.eye_state] ?? f.eye_state}`}</title>
      <rect
        x="0"
        y="0"
        width="100"
        height="56"
        rx="8"
        fill="color-mix(in srgb, var(--surface-deep) 80%, transparent)"
        stroke="color-mix(in srgb, var(--accent) 25%, transparent)"
        strokeWidth="1"
      />
      <ellipse
        cx={f.eye_l.cx}
        cy={f.eye_l.cy}
        rx={f.eye_l.rx}
        ry={f.eye_l.ry}
        fill="var(--accent)"
        opacity={alpha * f.eye_l.opacity}
        style={{
          filter: 'drop-shadow(0 0 6px var(--accent-glow))',
          transition: 'rx 120ms ease, ry 120ms ease, cx 60ms linear, cy 60ms linear',
        }}
      />
      <ellipse
        cx={f.eye_r.cx}
        cy={f.eye_r.cy}
        rx={f.eye_r.rx}
        ry={f.eye_r.ry}
        fill="var(--accent)"
        opacity={alpha * f.eye_r.opacity}
        style={{
          filter: 'drop-shadow(0 0 6px var(--accent-glow))',
          transition: 'rx 120ms ease, ry 120ms ease, cx 60ms linear, cy 60ms linear',
        }}
      />
    </svg>
  );
}
