import { SystemState } from '@shared/types';
import { useSystemStore } from '../../stores/systemStore';

export type OrbSize = 'sm' | 'md' | 'lg' | 'xl';

interface OrbProps {
  size?: OrbSize;
  state?: SystemState;
  /** Show voice-reactive pulse-music scaling. */
  pulsing?: boolean;
  /** Additional classes for positioning. */
  className?: string;
}

const SIZE_MAP: Record<OrbSize, { container: number; core: number; ringOuter: number; ringInner: number }> = {
  sm: { container: 132, core: 88,  ringOuter: 150, ringInner: 130 },
  md: { container: 200, core: 140, ringOuter: 224, ringInner: 200 },
  lg: { container: 260, core: 180, ringOuter: 300, ringInner: 272 },
  xl: { container: 320, core: 220, ringOuter: 360, ringInner: 328 },
};

/**
 * Orb — central AI presence indicator.
 * Composite of: morphing gradient core, outer glow halo, two orbital rings (fwd + reverse),
 * ambient-pulse ring, two random ping sparks. Reacts to SystemState via accent tokens.
 */
export function Orb({ size = 'md', pulsing = false, className = '' }: OrbProps) {
  const s = SIZE_MAP[size];

  // Voice amplitude [0, 1] from the mic recorder — drives a subtle scale
  // and brightness pulse so the orb visibly reacts while the operator speaks.
  // Falls back to 0 when no voice session is active.
  const voiceAmp = useSystemStore((st) => st.voiceAmplitude ?? 0);
  const voicePulse = 1 + voiceAmp * 0.12;
  const voiceGlow = 1 + voiceAmp * 1.2;

  return (
    <div
      className={`relative flex items-center justify-center animate-float ${className}`}
      style={{ width: s.container, height: s.container }}
      aria-hidden
    >
      {/* Outer glow halo */}
      <div
        className={`absolute inset-0 rounded-full ${pulsing ? 'animate-pulse-music' : 'animate-pulse-slow'}`}
        style={{
          background: 'var(--accent-glow)',
          filter: `blur(48px) brightness(${voiceGlow})`,
          transform: `scale(${voicePulse})`,
          transition: 'transform 80ms linear, filter 80ms linear',
        }}
      />

      {/* Orbital ring outer — slow forward */}
      <div
        className="absolute rounded-full"
        style={{
          width: s.ringOuter,
          height: s.ringOuter,
          border: '1px solid var(--glass-border-hover)',
          opacity: 0.55,
          animation: `phantom-radar calc(20s / var(--motion-scale, 1)) linear infinite`,
        }}
      />

      {/* Orbital ring inner — faster, dashed, reverse, 45deg tilt */}
      <div
        className="absolute rounded-full"
        style={{
          width: s.ringInner,
          height: s.ringInner,
          border: '1px dashed color-mix(in srgb, var(--accent) 55%, transparent)',
          opacity: 0.6,
          transform: 'rotate(45deg)',
          animation: `phantom-radar calc(15s / var(--motion-scale, 1)) linear infinite reverse`,
        }}
      />

      {/* Ambient pulse ring — breathing */}
      <div
        className="absolute rounded-full animate-pulse-slow"
        style={{
          width: s.container,
          height: s.container,
          border: '1px solid var(--glass-border)',
          opacity: 0.35,
        }}
      />

      {/* Ядро. mixBlendMode: screen тут гасив сферу на кремовому тлі —
          лишалась безформна пляма, тому форму тримають градієнт із бліком
          і чіткий край, а розмиття пішло у зовнішнє сяйво. */}
      <div
        className="absolute rounded-full animate-breathe"
        style={{
          width: s.core,
          height: s.core,
          background: 'var(--accent-radial)',
          boxShadow:
            '0 0 60px var(--accent-glow), inset -8% -12% 40px rgba(176,122,16,0.30), inset 12% 14% 30px rgba(255,255,255,0.45)',
          opacity: 0.96,
        }}
      />

      {/* Специфічний блік — читається як об'єм, а не як плоске коло. */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: s.core * 0.32,
          height: s.core * 0.24,
          transform: `translate(-${s.core * 0.18}px, -${s.core * 0.24}px) rotate(-18deg)`,
          background:
            'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.85), rgba(255,255,255,0) 70%)',
          filter: 'blur(4px)',
        }}
      />

      {/* Sparks */}
      <span
        className="absolute rounded-full animate-ping"
        style={{
          top: '12%',
          right: '18%',
          width: 6,
          height: 6,
          background: 'var(--ink-primary)',
          animationDuration: '3s',
          opacity: 0.75,
        }}
      />
      <span
        className="absolute rounded-full animate-ping"
        style={{
          bottom: '18%',
          left: '14%',
          width: 4,
          height: 4,
          background: 'var(--accent)',
          animationDuration: '4s',
          opacity: 0.8,
        }}
      />
    </div>
  );
}
