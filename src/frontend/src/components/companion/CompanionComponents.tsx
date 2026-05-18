import React, { useState, useEffect } from 'react';
import { PhantomTheme } from './CompanionTheme';

// ─── GlassCard ──────────────────────────────────────────────
export interface GlassCardProps {
  level?: 'subtle' | 'panel' | 'card' | 'elevated';
  accentBorder?: boolean;
  accent?: string;
  theme: PhantomTheme;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function GlassCard({
  level = 'panel',
  accentBorder = false,
  accent,
  theme: t,
  style = {},
  children,
  onClick,
  className = '',
}: GlassCardProps) {
  const bg = {
    subtle:   t.glassPanel,
    panel:    t.glassPanel,
    card:     t.glassCard,
    elevated: t.glassElevated,
  }[level];
  const blur = {
    subtle: 12, panel: 12, card: 24, elevated: 32,
  }[level];

  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        position: 'relative',
        background: bg,
        backdropFilter: `blur(${blur}px) saturate(1.1)`,
        WebkitBackdropFilter: `blur(${blur}px) saturate(1.1)`,
        border: `1px solid ${t.glassBorder}`,
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: t.isDark
          ? `0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 ${t.glassHL}`
          : `0 8px 24px rgba(120,80,10,0.08), inset 0 1px 0 ${t.glassHL}`,
        ...style,
      }}
    >
      {accentBorder && (
        <div style={{
          position: 'absolute', top: 0, left: 12, right: 12, height: 1,
          background: `linear-gradient(90deg, transparent, ${accent || t.primary}, transparent)`,
        }} />
      )}
      {children}
    </div>
  );
}

// ─── OrbView ─────────────────────────────────────────────────
export interface OrbViewProps {
  accent: string;
  theme: PhantomTheme;
  motionScale?: number;
  audioLevel?: number;
  size?: number;
  ringCount?: number;
  intensity?: number;
}

export function OrbView({
  accent,
  theme,
  motionScale = 1,
  audioLevel = 0,
  size = 240,
  ringCount = 1,
  intensity = 1,
}: OrbViewProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const loop = (t: number) => {
      setTick((t - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const period = 2 / motionScale;
  const breath = 1 + 0.05 * Math.sin((tick / period) * Math.PI * 2);
  const audioPulse = 1 + audioLevel * 0.18;

  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const [r,g,b] = hexToRgb(accent);

  const orbStyle: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%',
    transform: `scale(${breath * audioPulse})`,
    transition: 'transform 50ms linear',
    background: `
      radial-gradient(circle at 35% 30%, rgba(255,255,255,${theme.isDark ? 0.35 : 0.65}) 0%, rgba(255,255,255,0) 35%),
      radial-gradient(circle at 50% 55%, rgba(${r},${g},${b},0.95) 0%, rgba(${r},${g},${b},0.55) 35%, rgba(${r},${g},${b},0.18) 65%, rgba(${r},${g},${b},0.0) 80%)
    `,
    filter: `drop-shadow(0 0 ${30 * intensity}px rgba(${r},${g},${b},${theme.isDark ? 0.6 : 0.45}))`,
    position: 'relative',
  };
  const innerCore: React.CSSProperties = {
    position: 'absolute', inset: '20%',
    borderRadius: '50%',
    background: `radial-gradient(circle at 40% 35%, rgba(255,255,255,${theme.isDark ? 0.5 : 0.85}) 0%, rgba(${r},${g},${b},0.4) 40%, rgba(${r},${g},${b},0.0) 75%)`,
    mixBlendMode: theme.isDark ? 'screen' : 'normal',
  };

  return (
    <div style={{ position: 'relative', width: size, height: size, display:'flex', alignItems:'center', justifyContent:'center' }}>
      {Array.from({length: ringCount}).map((_,i) => {
        const phase = (tick / (1.2 / motionScale)) * Math.PI * 2 - i * 0.8;
        const ringScale = 1 + 0.15 * (0.5 + 0.5 * Math.sin(phase)) + audioLevel * 0.1;
        return (
          <div key={i} style={{
            position: 'absolute',
            width: size * 0.95, height: size * 0.95, borderRadius: '50%',
            border: `1px solid rgba(${r},${g},${b},${0.35 - i*0.1})`,
            transform: `scale(${ringScale})`,
            opacity: 1 - i * 0.3,
          }} />
        );
      })}
      <div style={orbStyle}>
        <div style={innerCore} />
      </div>
    </div>
  );
}

// ─── FamiliarCanvas ──────────────────────────────────────────
export type FamiliarPose = 'Idle' | 'Floating' | 'Pointing' | 'Peeking' | 'Sleeping' | 'Waving' | 'Vanishing';
export type FamiliarMood = 'Neutral' | 'Alert' | 'Happy';

export interface FamiliarCanvasProps {
  pose?: FamiliarPose;
  mood?: FamiliarMood;
  accent: string;
  theme: PhantomTheme;
  size?: number;
}

export function FamiliarCanvas({
  pose = 'Idle',
  mood = 'Neutral',
  accent,
  theme,
  size = 96,
}: FamiliarCanvasProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const loop = (t: number) => { setTick((t - start) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const float = Math.sin(tick * 1.0) * 4;
  const tilt = pose === 'Pointing' ? 12 : pose === 'Waving' ? -8 : Math.sin(tick * 0.7) * 3;
  const scale = (pose === 'Pointing' || pose === 'Waving') ? 1.3 : 1;
  const sleeping = pose === 'Sleeping';
  const opacity = pose === 'Vanishing' ? 0.4 : sleeping ? 0.7 : 1;

  const h = accent.replace('#','');
  const n = parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);
  const r = n>>16&255, g=n>>8&255, b=n&255;
  const w = size, ht = size * 1.375;

  return (
    <div style={{
      width: w * scale, height: ht * scale,
      transform: `translateY(${float}px) rotate(${tilt}deg)`,
      transition: 'transform 80ms linear',
      opacity,
      position: 'relative',
    }}>
      <svg width={w*scale} height={ht*scale} viewBox="0 0 96 132" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id={`fbody-${accent}`} cx="40%" cy="35%">
            <stop offset="0%" stopColor={`rgba(255,255,255,${theme.isDark?0.4:0.85})`} />
            <stop offset="40%" stopColor={`rgba(${r},${g},${b},0.8)`} />
            <stop offset="100%" stopColor={`rgba(${r},${g},${b},0.15)`} />
          </radialGradient>
          <filter id={`fglow-${accent}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <path
          d={`M 48 96 Q ${48 + Math.sin(tick*2)*10} 108 ${48 + Math.sin(tick*2.3)*16} 124`}
          stroke={`rgba(${r},${g},${b},0.5)`} strokeWidth="6" fill="none" strokeLinecap="round"
          filter={`url(#fglow-${accent})`}
        />
        <ellipse cx="48" cy="56" rx="32" ry="38" fill={`url(#fbody-${accent})`} filter={`url(#fglow-${accent})`} />
        <ellipse cx="48" cy="52" rx="20" ry="24" fill={`rgba(255,255,255,${theme.isDark?0.18:0.55})`} />
        {sleeping ? (
          <>
            <path d="M 38 54 Q 42 51 46 54" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M 50 54 Q 54 51 58 54" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="42" cy="52" rx="2.2" ry={pose==='Peeking'?1:2.6} fill={theme.ink} />
            <ellipse cx="54" cy="52" rx="2.2" ry={pose==='Peeking'?1:2.6} fill={theme.ink} />
          </>
        )}
        {mood === 'Alert' && <path d="M 42 64 Q 48 58 54 64" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />}
        {mood === 'Neutral' && <line x1="44" y1="62" x2="52" y2="62" stroke={theme.ink} strokeWidth="1.6" strokeLinecap="round" />}
        {mood === 'Happy' && <path d="M 42 60 Q 48 66 54 60" stroke={theme.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />}
        {pose === 'Pointing' && (
          <g transform="translate(70,60) rotate(20)">
            <rect x="0" y="-3" width="22" height="6" rx="3" fill={`rgba(${r},${g},${b},0.85)`} />
            <circle cx="22" cy="0" r="4" fill={`rgba(${r},${g},${b},0.95)`} />
          </g>
        )}
        {pose === 'Waving' && (
          <g transform={`translate(72,48) rotate(${-20 + Math.sin(tick*4)*30})`}>
            <rect x="0" y="-3" width="20" height="6" rx="3" fill={`rgba(${r},${g},${b},0.85)`} />
            <circle cx="20" cy="0" r="5" fill={`rgba(${r},${g},${b},0.95)`} />
          </g>
        )}
      </svg>
    </div>
  );
}

// ─── PttButton ───────────────────────────────────────────────
export function PttButton({ state = 'Idle', audioLevel = 0, accent, theme: t }: { state?: string, audioLevel?: number, accent: string, theme: PhantomTheme }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const loop = (t: number) => { setTick((t - start) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const h = accent.replace('#','');
  const n = parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);
  const r = n>>16&255, g=n>>8&255, b=n&255;
  const ringScale = state === 'Capturing' ? 1 + audioLevel * 0.4 : 1;
  const pulseAlpha = state === 'AwaitingFinal' ? 0.4 + 0.6 * (0.5 + 0.5*Math.sin(tick * (Math.PI*2/0.6))) : 1;
  const rotation = state === 'Speaking' ? (tick / 4) * 360 : 0;
  return (
    <div style={{ position: 'relative', width: 96, height: 96 }}>
      <div style={{
        position: 'absolute', inset: -8, borderRadius: '50%',
        border: `2px solid rgba(${r},${g},${b},0.35)`,
        transform: `scale(${ringScale})`,
        transition: 'transform 60ms linear',
      }} />
      <div style={{
        position: 'absolute', inset: -16, borderRadius: '50%',
        border: `1px dashed rgba(${r},${g},${b},0.25)`,
        transform: `rotate(${rotation}deg)`,
      }} />
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,${t.isDark?0.4:0.7}), rgba(${r},${g},${b},0.95) 60%, rgba(${r},${g},${b},0.7))`,
        boxShadow: `0 0 28px rgba(${r},${g},${b},0.55), inset 0 -8px 18px rgba(0,0,0,0.18)`,
        opacity: pulseAlpha,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: 4,
          background: t.isDark ? '#1c1408' : 'rgba(255,255,255,0.92)',
          boxShadow: `inset 0 0 4px rgba(0,0,0,0.2)`,
        }} />
      </div>
    </div>
  );
}

// ─── StatePill ──────────────────────────────────────────────
import { PHANTOM_STATES } from './CompanionTheme';

export function StatePill({ stateKey, accent, theme, sub, expanded = false, style = {} }: { stateKey: string, accent: string, theme: PhantomTheme, sub?: string, expanded?: boolean, style?: React.CSSProperties }) {
  const s = PHANTOM_STATES[stateKey];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: expanded ? '12px 16px' : '6px 12px',
      borderRadius: 999,
      background: theme.isDark ? 'rgba(244,175,37,0.08)' : 'rgba(176,122,16,0.06)',
      border: `1px solid ${accent}33`,
      ...style,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: accent,
        boxShadow: `0 0 8px ${accent}`,
      }} />
      <span style={{
        fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 600,
        letterSpacing: '0.18em', color: accent,
      }}>{s.label}</span>
      {sub && (
        <>
          <span style={{ color: theme.ink3, fontSize: 11 }}>·</span>
          <span style={{ fontSize: 12, color: theme.ink2, fontWeight: 500 }}>{sub}</span>
        </>
      )}
      {expanded && (
        <span style={{ marginLeft: 'auto', color: theme.ink2, fontSize: 12 }}>▾</span>
      )}
    </div>
  );
}

// ─── VitalsRow ──────────────────────────────────────────────
export function Sparkline({ data, color, w = 56, h = 18 }: { data: number[], color: string, w?: number, h?: number }) {
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h - v*h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

export function VitalsRow({ theme, accent }: { theme: PhantomTheme, accent: string }) {
  const bpmData = [0.4, 0.5, 0.42, 0.6, 0.55, 0.7, 0.65, 0.58, 0.62];
  const brData = [0.3, 0.35, 0.32, 0.38, 0.4, 0.36, 0.42];
  const stData = [0.5, 0.45, 0.4, 0.42, 0.38, 0.35, 0.32];
  const cellStyle: React.CSSProperties = {
    flex: 1,
    padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 4,
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.2em',
    textTransform: 'uppercase', color: theme.ink3, fontWeight: 600,
  };
  const valStyle = (size = 22): React.CSSProperties => ({
    fontFamily: 'JetBrains Mono', fontSize: size, fontWeight: 600,
    color: theme.ink, lineHeight: 1, letterSpacing: '-0.02em',
  });
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <GlassCard level="subtle" theme={theme} style={cellStyle}>
        <div style={labelStyle}>BPM</div>
        <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
          <span style={valStyle(24)}>72</span>
          <span style={{fontFamily:'JetBrains Mono', fontSize: 10, color: theme.ink3}}>↓ 4</span>
        </div>
        <Sparkline data={bpmData} color={accent} />
      </GlassCard>
      <GlassCard level="subtle" theme={theme} style={cellStyle}>
        <div style={labelStyle}>BREATH</div>
        <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
          <span style={valStyle(24)}>14</span>
          <span style={{fontFamily:'JetBrains Mono', fontSize: 10, color: theme.ink3}}>/min</span>
        </div>
        <Sparkline data={brData} color={accent} />
      </GlassCard>
      <GlassCard level="subtle" theme={theme} style={cellStyle}>
        <div style={labelStyle}>STRESS</div>
        <div style={{ display:'flex', alignItems:'baseline', gap: 6 }}>
          <span style={valStyle(24)}>.32</span>
          <span style={{fontFamily:'JetBrains Mono', fontSize: 10, color: '#16A34A'}}>calm</span>
        </div>
        <Sparkline data={stData} color={accent} />
      </GlassCard>
    </div>
  );
}

// ─── BottomNav ──────────────────────────────────────────────
export function BottomNav({ active, theme, accent }: { active: string, theme: PhantomTheme, accent: string }) {
  const tabs = [
    { id: 'pulse', label: 'Pulse', icon: '◉' },
    { id: 'voice', label: 'Voice', icon: '◐' },
    { id: 'map',   label: 'Map',   icon: '◇' },
    { id: 'comms', label: 'Comms', icon: '◔' },
    { id: 'vault', label: 'Vault', icon: '◈' },
  ];
  return (
    <div style={{ padding: '8px 12px 14px' }}>
      <GlassCard level="card" theme={theme} style={{
        display: 'flex', borderRadius: 28,
        padding: '8px 6px',
      }}>
        {tabs.map(t => {
          const isActive = t.id === active;
          return (
            <div key={t.id} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
              padding: '6px 0',
              position: 'relative',
            }}>
              {isActive && (
                <div style={{
                  position: 'absolute', top: 0, left: '20%', right: '20%', height: 2,
                  background: accent, borderRadius: 2,
                  boxShadow: `0 0 8px ${accent}`,
                }} />
              )}
              <div style={{
                fontSize: 16,
                color: isActive ? accent : theme.ink3,
                lineHeight: 1,
              }}>{t.icon}</div>
              <div style={{
                fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.15em',
                textTransform: 'uppercase', fontWeight: 600,
                color: isActive ? theme.ink : theme.ink3,
              }}>{t.label}</div>
            </div>
          );
        })}
      </GlassCard>
    </div>
  );
}

// ─── Phone shell ─────────────────────────────────────────────
export function PhoneShell({ theme, children, statusOverlay }: { theme: PhantomTheme, children: React.ReactNode, statusOverlay?: React.ReactNode }) {
  return (
    <div style={{
      width: 360, height: 740, borderRadius: 44,
      background: theme.isDark ? '#000' : '#1a1410',
      padding: 4,
      boxShadow: theme.isDark
        ? '0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(244,175,37,0.15), inset 0 0 0 2px #2a1f10'
        : '0 30px 80px rgba(120,80,10,0.25), 0 0 0 1px rgba(0,0,0,0.1), inset 0 0 0 2px #0a0604',
      position: 'relative',
    }}>
      <div style={{
        width: '100%', height: '100%',
        borderRadius: 40, overflow: 'hidden',
        background: theme.bgGradient,
        position: 'relative',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          height: 36, padding: '10px 22px 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'JetBrains Mono', fontSize: 12, fontWeight: 600,
          color: theme.ink, flexShrink: 0,
          position: 'relative', zIndex: 2,
        }}>
          <span>9:41</span>
          <div style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            width: 92, height: 26, borderRadius: 16,
            background: theme.isDark ? '#000' : '#1a1410',
          }} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <span style={{ opacity: 0.8 }}>5G</span>
            <span style={{ opacity: 0.8 }}>▮▮▮</span>
            <span style={{ opacity: 0.8 }}>87%</span>
          </div>
        </div>
        {statusOverlay}
        <div className="ph-scroll" style={{ flex: 1, overflow: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
